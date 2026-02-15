import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Server, CheckCircle, AlertCircle, Settings, Home, Database, Plug } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DataRetentionSettings } from './DataRetentionSettings';
import { HeatingSettingsForm } from "@/components/heating/HeatingSettingsForm";
import { RoomManager } from "@/components/heating/RoomManager";
import { useHeatingSettings } from "@/hooks/useHeatingSettings";
import { useRooms } from "@/hooks/useRooms";
import { TuyaSubscriptionAlert } from "@/components/settings/TuyaSubscriptionAlert";
import { TuyaConnectionTest } from "@/components/settings/TuyaConnectionTest";
import { TuyaControlModeSwitch } from "@/components/settings/TuyaControlModeSwitch";

interface SettingsPanelProps {
  isConnected: boolean;
  lastUpdate?: string;
}

export function SettingsPanel({ isConnected, lastUpdate }: SettingsPanelProps) {
  const { settings, saveSettings, isLoading: isHeatingLoading } = useHeatingSettings();
  const { rooms, saveRoom, deleteRoom, isLoading: isRoomsLoading } = useRooms();

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
      <Accordion type="multiple" defaultValue={["tuya", "anlage", "raeume", "daten"]} className="space-y-4">
        {/* Tuya API-Verbindung */}
        <AccordionItem value="tuya" className="border rounded-lg overflow-hidden">
          <AccordionTrigger className="px-4 py-3 bg-muted/50 hover:bg-muted">
            <div className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-primary" />
              <span className="font-semibold">Tuya API-Verbindung</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4 space-y-4">
            <TuyaControlModeSwitch />
            <TuyaConnectionTest />
            <TuyaSubscriptionAlert />
          </AccordionContent>
        </AccordionItem>

        {/* Anlagen-Konfiguration */}
        <AccordionItem value="anlage" className="border rounded-lg overflow-hidden">
          <AccordionTrigger className="px-4 py-3 bg-muted/50 hover:bg-muted">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <span className="font-semibold">Anlagen-Konfiguration</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4 space-y-4">
            <HeatingSettingsForm
              settings={settings}
              onSave={saveSettings}
              isLoading={isHeatingLoading}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Räume verwalten */}
        <AccordionItem value="raeume" className="border rounded-lg overflow-hidden">
          <AccordionTrigger className="px-4 py-3 bg-muted/50 hover:bg-muted">
            <div className="flex items-center gap-2">
              <Home className="h-5 w-5 text-primary" />
              <span className="font-semibold">Räume verwalten</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <RoomManager
              rooms={rooms}
              onSave={saveRoom}
              onDelete={deleteRoom}
              isLoading={isRoomsLoading}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Datenspeicherung */}
        <AccordionItem value="daten" className="border rounded-lg overflow-hidden">
          <AccordionTrigger className="px-4 py-3 bg-muted/50 hover:bg-muted">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <span className="font-semibold">Datenspeicherung</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4">
            <DataRetentionSettings />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Collector Status */}
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
              <li>Der <strong>Node.js Collector</strong> läuft auf einem lokalen PC im selben Netzwerk wie der Fronius-Wechselrichter</li>
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
         ┌─────────────────────┐
         │   Fronius           │
         │   (Energiedaten +   │
         │    Battery SOC)     │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │   Node.js Collector │
         │   (läuft lokal)     │
         └──────────┬──────────┘
                    │ (HTTPS)
                    ▼
         ┌─────────────────────┐
         │   Cloud Datenbank   │
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
