import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Server, CheckCircle, AlertCircle, Settings, Home, Database, Plug, Cloud, MonitorSmartphone } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DataRetentionSettings } from './DataRetentionSettings';
import { TariffHistoryPanel } from './TariffHistoryPanel';
import { HeatingSettingsForm } from "@/components/heating/HeatingSettingsForm";
import { RoomManager } from "@/components/heating/RoomManager";
import { useHeatingSettings } from "@/hooks/useHeatingSettings";
import { useRooms } from "@/hooks/useRooms";
import { TuyaSubscriptionAlert } from "@/components/settings/TuyaSubscriptionAlert";
import { TuyaConnectionTest } from "@/components/settings/TuyaConnectionTest";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useControlMode } from "@/hooks/useControlMode";

interface SettingsPanelProps {
  isConnected: boolean;
  lastUpdate?: string;
}

export function SettingsPanel({ isConnected, lastUpdate }: SettingsPanelProps) {
  const { settings, saveSettings, isLoading: isHeatingLoading } = useHeatingSettings();
  const { rooms, saveRoom, deleteRoom, isLoading: isRoomsLoading } = useRooms();
  const { mode, setMode, isLoading: isModeLoading } = useControlMode();

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
            <div className="flex items-center gap-2 flex-1">
              <Plug className="h-5 w-5 text-primary" />
              <span className="font-semibold">Tuya API-Verbindung</span>
              <span
                className={`ml-auto mr-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                  mode === 'local'
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-muted text-muted-foreground border-border'
                }`}
              >
                {mode === 'local' ? <MonitorSmartphone className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                {mode === 'local' ? 'Lokal aktiv' : 'Cloud aktiv'}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4 space-y-4">
            {/* Steuerungsmodus */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Steuerungsmodus</Label>
              <RadioGroup
                value={mode}
                onValueChange={(val) => setMode(val as 'cloud' | 'local')}
                disabled={isModeLoading}
                className="grid grid-cols-1 gap-3"
              >
                <label
                  htmlFor="mode-cloud"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    mode === 'cloud' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <RadioGroupItem value="cloud" id="mode-cloud" className="mt-0.5" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Cloud className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">Cloud API</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Thermostate werden direkt über die Tuya Cloud API gesteuert. Erfordert aktives Tuya IoT-Abo.
                    </p>
                  </div>
                </label>
                <label
                  htmlFor="mode-local"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    mode === 'local' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <RadioGroupItem value="local" id="mode-local" className="mt-0.5" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <MonitorSmartphone className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">Lokaler Service</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Befehle werden an den lokalen Thermostat-Service gesendet (LAN-Steuerung). Kein Cloud-API-Verbrauch.
                    </p>
                  </div>
                </label>
              </RadioGroup>
              {mode === 'local' && (
                <Alert>
                  <MonitorSmartphone className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Im lokalen Modus werden alle Thermostat-Befehle über den lokalen Thermostat-Service ausgeführt. 
                    Die Tuya Cloud API wird <strong>nicht</strong> verwendet.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <TuyaConnectionTest />
            {mode === 'cloud' && <TuyaSubscriptionAlert />}
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
            <p className="text-xs text-muted-foreground">
              Diese Werte werden von der KI verwendet um PV-Überschuss zu berechnen und Heizentscheidungen zu optimieren. Gib deine tatsächlichen Anlagenwerte ein — je genauer, desto besser lernt die KI.
            </p>
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

        {/* Tarife & Preisverlauf */}
        <AccordionItem value="tarife" className="border rounded-lg overflow-hidden">
          <AccordionTrigger className="px-4 py-3 bg-muted/50 hover:bg-muted">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <span className="font-semibold">Tarife & Preisverlauf</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4">
            <TariffHistoryPanel />
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
    </div>
  );
}
