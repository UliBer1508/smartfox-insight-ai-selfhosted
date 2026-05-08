import { AlertTriangle, RefreshCw, X, WifiOff, Key, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useApiErrors, ApiError } from '@/hooks/useApiErrors';
import { useControlMode } from '@/hooks/useControlMode';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState } from 'react';

interface ApiErrorBannerProps {
  onRetry?: () => void;
  className?: string;
  /** Only show critical errors (quota_exhausted, token_expired) — useful for global placement */
  criticalOnly?: boolean;
}

function formatErrorTime(createdAt: string): string {
  try {
    return formatDistanceToNow(new Date(createdAt), { 
      addSuffix: true,
      locale: de 
    });
  } catch {
    return 'vor kurzem';
  }
}

export function ApiErrorBanner({ onRetry, className, criticalOnly = false }: ApiErrorBannerProps) {
  const { errors: rawErrors, acknowledgeError, refetch } = useApiErrors();
  const { mode } = useControlMode();
  const [isRetrying, setIsRetrying] = useState(false);

  // Im Lokal-Modus: Cloud-spezifische Fehler ausblenden (Quota, Token, No-Channel)
  const cloudOnlyTypes = new Set(['quota_exhausted', 'token_expired', 'no_control_channel']);
  const errors = mode === 'local'
    ? rawErrors.filter(e => !cloudOnlyTypes.has(e.error_type))
    : rawErrors;

  if (errors.length === 0) return null;

  // Group errors by type
  const tokenErrors = errors.filter(e => e.error_type === 'token_expired');
  const offlineErrors = errors.filter(e => e.error_type === 'device_offline');
  const quotaErrors = errors.filter(e => e.error_type === 'quota_exhausted');
  const noChannelErrors = errors.filter(e => e.error_type === 'no_control_channel');
  const nightFailedErrors = errors.filter(e => e.error_type === 'night_frost_failed');
  const otherErrors = errors.filter(e => !['token_expired', 'device_offline', 'quota_exhausted', 'no_control_channel', 'night_frost_failed'].includes(e.error_type));

  const isTokenError = tokenErrors.length > 0;
  const isQuotaError = quotaErrors.length > 0;
  const isNoChannelError = noChannelErrors.length > 0;
  const hasNightFailed = nightFailedErrors.length > 0;
  const totalErrors = errors.length;

  // In criticalOnly mode, only show quota, token, no-channel and night-failed errors
  if (criticalOnly && !isQuotaError && !isTokenError && !isNoChannelError && !hasNightFailed) return null;

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await supabase.functions.invoke('pv-automation/check', {
        body: {}
      });
      toast.success('Verbindungsversuch gestartet');
      setTimeout(() => refetch(), 3000);
    } catch (error) {
      console.error('Retry failed:', error);
      toast.error('Verbindungsversuch fehlgeschlagen');
    } finally {
      setIsRetrying(false);
    }

    if (onRetry) onRetry();
  };

  const handleDismissAll = () => {
    errors.forEach(e => acknowledgeError(e.id));
  };

  // Quota errors get a prominent pulsing style — also covers no-control-channel & night-failed
  if (isQuotaError || isNoChannelError || hasNightFailed) {
    const headline = isNoChannelError
      ? '🚨 Kein Steuerkanal verfügbar — Thermostate nicht erreichbar!'
      : isQuotaError
      ? '🚨 Tuya API-Quota erschöpft — Thermostate nicht steuerbar!'
      : '⚠️ Nacht-Rückstellung konnte nicht zugestellt werden';
    return (
      <Alert 
        variant="destructive" 
        className={cn(
          "border-2 border-red-500 bg-red-50 dark:bg-red-950/60 animate-pulse",
          className
        )}
      >
        <AlertTriangle className="h-5 w-5 text-red-600" />
        <AlertTitle className="flex items-center justify-between text-base font-bold text-red-700 dark:text-red-300">
          <span>{headline}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRetry}
            disabled={isRetrying}
            className="h-7 px-2 text-xs"
          >
            <RefreshCw className={cn("h-3 w-3 mr-1", isRetrying && "animate-spin")} />
            {isRetrying ? 'Wird versucht...' : 'Erneut prüfen'}
          </Button>
        </AlertTitle>
        <AlertDescription className="mt-2 space-y-2">
          {isQuotaError && (
            <div className="text-sm font-medium text-red-700 dark:text-red-300">
              Das Tages- oder Monatslimit der Tuya Cloud API wurde erreicht.
            </div>
          )}
          {isNoChannelError && (
            <div className="text-sm font-medium text-red-700 dark:text-red-300">
              Cloud-Quota ist erschöpft <strong>und</strong> der lokale Service ist nicht aktiv.
              Es konnte kein Befehl an die Thermostate zugestellt werden.
            </div>
          )}
          {hasNightFailed && !isNoChannelError && (
            <div className="text-sm font-medium text-red-700 dark:text-red-300">
              Die Rückstellung auf <strong>Nacht/Frostschutz</strong> konnte nicht physisch zugestellt werden.
              Die Thermostate halten möglicherweise noch ihren letzten Sollwert.
            </div>
          )}
          <div className="text-sm text-red-600 dark:text-red-400 space-y-1">
            <p>👉 Bitte Thermostate <strong>manuell am Gerät</strong> oder über die <strong>Tuya App</strong> auf Frostschutz/Nacht stellen.</p>
            {isQuotaError && (
              <p>⏰ Das <strong>Tageslimit</strong> wird um Mitternacht zurückgesetzt. Das <strong>Monatslimit</strong> am Monatsersten.</p>
            )}
          </div>
          {(quotaErrors[0]?.error_message || noChannelErrors[0]?.error_message || nightFailedErrors[0]?.error_message) && (
            <div className="text-xs text-red-500 dark:text-red-400 mt-1 font-mono">
              {(quotaErrors[0] || noChannelErrors[0] || nightFailedErrors[0])?.error_message}
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert 
      variant="destructive" 
      className={cn(
        "border-2",
        isTokenError
          ? "bg-red-50 dark:bg-red-950/50 border-red-500" 
          : "bg-amber-50 dark:bg-amber-950/50 border-amber-500",
        className
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        <span>
          {isTokenError 
            ? 'Tuya-Zugangsdaten prüfen' 
            : `Thermostat-Verbindungsfehler (${totalErrors})`
          }
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRetry}
            disabled={isRetrying}
            className="h-7 px-2 text-xs"
          >
            <RefreshCw className={cn("h-3 w-3 mr-1", isRetrying && "animate-spin")} />
            {isRetrying ? 'Wird versucht...' : 'Erneut versuchen'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismissAll}
            className="h-7 w-7"
            title="Alle bestätigen"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-1">
        {isTokenError && (
          <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
            <Key className="h-4 w-4" />
            Tuya Cloud Token abgelaufen - bitte API-Zugangsdaten in Einstellungen prüfen
          </div>
        )}
        
        {!criticalOnly && offlineErrors.length > 0 && (
          <div className="space-y-1">
            {offlineErrors.slice(0, 3).map((error) => (
              <div key={error.id} className="flex items-center gap-2 text-sm">
                <WifiOff className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium">{error.room_name || 'Unbekannt'}:</span>
                <span className="text-muted-foreground">Gerät offline</span>
                <span className="text-xs text-muted-foreground">
                  ({formatErrorTime(error.created_at)})
                </span>
              </div>
            ))}
            {offlineErrors.length > 3 && (
              <div className="text-xs text-muted-foreground">
                ... und {offlineErrors.length - 3} weitere offline
              </div>
            )}
          </div>
        )}

        {!criticalOnly && otherErrors.length > 0 && (
          <div className="space-y-1">
            {otherErrors.slice(0, 2).map((error) => (
              <div key={error.id} className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium">{error.room_name || 'System'}:</span>
                <span className="text-muted-foreground truncate max-w-[300px]">
                  {error.error_message || 'Unbekannter Fehler'}
                </span>
              </div>
            ))}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
