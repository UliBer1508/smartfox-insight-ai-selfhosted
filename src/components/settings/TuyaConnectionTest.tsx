import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useTuyaConnectionTest } from '@/hooks/useTuyaConnectionTest';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Loader2, 
  ExternalLink,
  RefreshCw,
  Key,
  Wifi,
  Server
} from 'lucide-react';

interface TestStepProps {
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error' | 'warning';
  detail?: string;
  icon: React.ReactNode;
}

function TestStep({ label, status, detail, icon }: TestStepProps) {
  const statusColors = {
    pending: 'text-muted-foreground',
    loading: 'text-primary',
    success: 'text-green-600',
    error: 'text-destructive',
    warning: 'text-yellow-600',
  };

  const StatusIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'success':
        return <CheckCircle className="h-4 w-4" />;
      case 'error':
        return <XCircle className="h-4 w-4" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />;
    }
  };

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${
      status === 'error' ? 'border-destructive/50 bg-destructive/5' : 
      status === 'success' ? 'border-green-500/50 bg-green-500/5' :
      status === 'warning' ? 'border-yellow-500/50 bg-yellow-500/5' :
      'border-border'
    }`}>
      <div className={statusColors[status]}>
        {icon}
      </div>
      <div className="flex-1">
        <div className={`font-medium ${statusColors[status]}`}>
          {label}
        </div>
        {detail && (
          <div className="text-sm text-muted-foreground mt-0.5">
            {detail}
          </div>
        )}
      </div>
      <div className={statusColors[status]}>
        <StatusIcon />
      </div>
    </div>
  );
}

export function TuyaConnectionTest() {
  const { result, isLoading, error, runTest, getTimeSinceTest } = useTuyaConnectionTest();

  // Auto-run test on mount
  useEffect(() => {
    runTest();
  }, [runTest]);

  const getCredentialsStatus = (): TestStepProps['status'] => {
    if (isLoading && !result) return 'loading';
    if (!result) return 'pending';
    return result.credentials_configured ? 'success' : 'error';
  };

  const getTokenStatus = (): TestStepProps['status'] => {
    if (isLoading && !result) return 'pending';
    if (!result) return 'pending';
    if (!result.credentials_configured) return 'pending';
    if (isLoading) return 'loading';
    return result.token_valid ? 'success' : 'error';
  };

  const getApiStatus = (): TestStepProps['status'] => {
    if (isLoading && !result) return 'pending';
    if (!result) return 'pending';
    if (!result.token_valid) return 'pending';
    if (isLoading) return 'loading';
    if (result.quota_exhausted) return 'error';
    if (result.devices_count === 0) return 'warning';
    return result.api_accessible ? 'success' : 'error';
  };

  const getApiDetail = () => {
    if (!result) return undefined;
    if (result.quota_exhausted) return 'Kontingent erschöpft (Code: 28841004)';
    if (result.error_code === '1004') return 'Ungültige Signatur';
    if (result.error_code === '2017') return 'Gerät offline';
    if (result.devices_count === 0) return 'Keine Geräte konfiguriert';
    if (result.api_accessible) return `${result.devices_count} Gerät(e) erreichbar`;
    if (result.api_error) return result.api_error.substring(0, 60);
    return undefined;
  };

  const overallStatus = result?.api_accessible ? 'success' : 
    (result?.quota_exhausted ? 'quota_exhausted' : 
    (result?.token_valid === false ? 'token_error' : 
    (error ? 'error' : 'unknown')));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            API-Verbindungstest
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={runTest}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Testen</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Test Steps */}
        <div className="space-y-2">
          <TestStep
            label="Zugangsdaten"
            status={getCredentialsStatus()}
            detail={result?.credentials_configured ? 'Konfiguriert' : 'Nicht konfiguriert'}
            icon={<Key className="h-4 w-4" />}
          />
          <TestStep
            label="Token-Abruf"
            status={getTokenStatus()}
            detail={result?.token_valid ? 'Erfolgreich' : result?.token_error?.substring(0, 50)}
            icon={<Server className="h-4 w-4" />}
          />
          <TestStep
            label="API-Zugriff"
            status={getApiStatus()}
            detail={getApiDetail()}
            icon={<Wifi className="h-4 w-4" />}
          />
        </div>

        {/* Error Details */}
        {result?.quota_exhausted && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>IoT Core Trial Edition aufgebraucht</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                Das kostenlose API-Kontingent ist erschöpft (Fehlercode: 28841004).
                Die Thermostat-Steuerung ist nicht verfügbar, bis Sie das Kontingent verlängern.
              </p>
              <div className="text-sm text-muted-foreground">
                <strong>Lösung:</strong> Verlängern Sie den "IoT Core Service" im Tuya IoT Portal unter:
                <br />
                Cloud → My Services → IoT Core → Extend Trial
              </div>
            </AlertDescription>
          </Alert>
        )}

        {result && !result.credentials_configured && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Zugangsdaten fehlen</AlertTitle>
            <AlertDescription>
              Die Tuya API-Zugangsdaten (TUYA_ACCESS_ID und TUYA_ACCESS_SECRET) 
              sind nicht konfiguriert.
            </AlertDescription>
          </Alert>
        )}

        {result?.devices_count === 0 && result.token_valid && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Keine Geräte konfiguriert</AlertTitle>
            <AlertDescription>
              Es sind noch keine Tuya Device IDs in den Räumen hinterlegt.
              Bitte tragen Sie die Device IDs unter "Räume verwalten" ein.
            </AlertDescription>
          </Alert>
        )}

        {/* Connection Error */}
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Verbindungsfehler</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Status Summary */}
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2 border-t">
          <div className="flex items-center gap-2">
            {result && (
              <Badge 
                variant="outline" 
                className={
                  overallStatus === 'success' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                  overallStatus === 'quota_exhausted' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                  'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
                }
              >
                {overallStatus === 'success' ? 'Verbunden' : 
                 overallStatus === 'quota_exhausted' ? 'Kontingent erschöpft' : 
                 'Verbindungsproblem'}
              </Badge>
            )}
          </div>
          <div>
            {result && (
              <span>Letzter Test: {getTimeSinceTest()}</span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => window.open('https://iot.tuya.com/cloud/basic?id=p1749665382628edohm&tab=1', '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            IoT Core Service
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => window.open('https://iot.tuya.com/cloud/', '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Tuya IoT Portal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
