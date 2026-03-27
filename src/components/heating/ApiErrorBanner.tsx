import { AlertTriangle, RefreshCw, X, WifiOff, Key, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useApiErrors, ApiError } from '@/hooks/useApiErrors';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState } from 'react';

interface ApiErrorBannerProps {
  onRetry?: () => void;
  className?: string;
}

function getErrorIcon(errorType: string) {
  switch (errorType) {
    case 'device_offline':
      return <WifiOff className="h-4 w-4" />;
    case 'token_expired':
      return <Key className="h-4 w-4" />;
    default:
      return <AlertCircle className="h-4 w-4" />;
  }
}

function getErrorLabel(errorType: string): string {
  switch (errorType) {
    case 'device_offline':
      return 'Gerät offline';
    case 'token_expired':
      return 'Token abgelaufen';
    default:
      return 'API-Fehler';
  }
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

export function ApiErrorBanner({ onRetry, className }: ApiErrorBannerProps) {
  const { errors, acknowledgeError, hasErrors, refetch } = useApiErrors();
  const [isRetrying, setIsRetrying] = useState(false);

  if (!hasErrors) return null;

  // Group errors by type for summary
  const tokenErrors = errors.filter(e => e.error_type === 'token_expired');
  const offlineErrors = errors.filter(e => e.error_type === 'device_offline');
  const quotaErrors = errors.filter(e => e.error_type === 'quota_exhausted');
  const otherErrors = errors.filter(e => !['token_expired', 'device_offline', 'quota_exhausted'].includes(e.error_type));

  const isTokenError = tokenErrors.length > 0;
  const isQuotaError = quotaErrors.length > 0;
  const totalErrors = errors.length;

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      // Trigger PV-Automation check which will attempt to reconnect
      await supabase.functions.invoke('pv-automation/check', {
        body: {}
      });
      toast.success('Verbindungsversuch gestartet');
      // Refresh errors after a short delay
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

  return (
    <Alert 
      variant="destructive" 
      className={cn(
        "border-2",
        isTokenError || isQuotaError
          ? "bg-red-50 dark:bg-red-950/50 border-red-500" 
          : "bg-amber-50 dark:bg-amber-950/50 border-amber-500",
        className
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        <span>
          {isQuotaError
            ? '⚠️ Tuya API-Quota erschöpft'
            : isTokenError 
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
        {isQuotaError && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4" />
              Tuya API-Tageslimit erreicht — Thermostate können nicht mehr ferngesteuert werden!
            </div>
            <div className="text-sm text-red-600 dark:text-red-400">
              👉 Bitte Thermostate <strong>manuell am Gerät</strong> oder über die <strong>Tuya App</strong> auf Frostschutz stellen, bis das Limit um Mitternacht zurückgesetzt wird.
            </div>
          </div>
        )}
        {isTokenError && (
          <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
            <Key className="h-4 w-4" />
            Tuya Cloud Token abgelaufen - bitte API-Zugangsdaten in Einstellungen prüfen
          </div>
        )}
        
        {offlineErrors.length > 0 && (
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

        {otherErrors.length > 0 && (
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
