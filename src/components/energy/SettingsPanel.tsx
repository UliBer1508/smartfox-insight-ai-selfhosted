import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Server, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface SettingsPanelProps {
  isConnected: boolean;
  lastUpdate?: string;
}

export function SettingsPanel({ isConnected, lastUpdate }: SettingsPanelProps) {
  const getTimeSinceUpdate = () => {
    if (!lastUpdate) return null;
    const diff = Date.now() - new Date(lastUpdate).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes < 1) return `vor ${seconds} Sekunden`;
    if (minutes < 60) return `vor ${minutes} Minuten`;
    return `vor mehr als einer Stunde`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Collector-Status
          </CardTitle>
          <CardDescription>
            Die Daten werden von einem lokalen Collector gesammelt und in die Datenbank geschrieben.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant={isConnected ? "default" : "destructive"}>
            {isConnected ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertTitle>
              {isConnected ? 'Collector aktiv' : 'Keine aktuellen Daten'}
            </AlertTitle>
            <AlertDescription>
              {isConnected 
                ? `Daten werden empfangen (${getTimeSinceUpdate()})`
                : 'Der Collector sendet keine Daten. Überprüfen Sie den lokalen Collector.'
              }
            </AlertDescription>
          </Alert>

          <div className="p-4 rounded-lg bg-muted/50 border border-dashed space-y-3">
            <p className="text-sm font-medium">So funktioniert es:</p>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Der <strong>Node.js Collector</strong> läuft auf einem lokalen PC im selben Netzwerk wie Smartfox/Fronius</li>
              <li>Er liest Daten von den Geräten und speichert sie in der Cloud-Datenbank</li>
              <li>Diese PWA zeigt die Daten in Echtzeit an (Realtime-Updates)</li>
            </ol>
          </div>

          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
            <p className="text-sm">
              <strong>Collector-Dokumentation:</strong> Die Einrichtung des lokalen Collectors finden Sie im 
              <code className="mx-1 px-1 py-0.5 rounded bg-muted font-mono text-xs">local-collector/</code> 
              Ordner des Projekts.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Architektur</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm font-mono bg-muted p-4 rounded-lg overflow-x-auto">
            <pre className="text-muted-foreground">{`
┌─────────────────┐     ┌─────────────────┐
│  Smartfox       │     │  Fronius        │
│  (Energiedaten) │     │  (Battery SOC)  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │   Node.js Collector │
         │   (läuft lokal)     │
         └──────────┬──────────┘
                    │ (HTTPS)
                    ▼
         ┌─────────────────────┐
         │   Cloud Datenbank   │
         │   (Supabase)        │
         └──────────┬──────────┘
                    │ (Realtime)
                    ▼
         ┌─────────────────────┐
         │   Diese PWA         │
         │   (überall nutzbar) │
         └─────────────────────┘
            `}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
