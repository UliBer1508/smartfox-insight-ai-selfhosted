// Einstellungsseite der Heizung Venediger – Aufbau wie in der Heizung München (Stand 23.10.2026):
//   1. Betrieb   – Steuerungsmodus
//   2. Haus      – Werte für alle Räume, in Gruppen, ein Speichern-Knopf
//   3. Räume     – eine Karte pro Raum, Solltemperaturen direkt editierbar
//   4. System    – eingeklappt: Tuya Cloud, Datenspeicherung, Datensicherung, Tarife, Collector
// Gespeichert werden überall nur geänderte Felder (siehe src/lib/safeSave.ts).
import { useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Server, CheckCircle, AlertCircle, Database, DatabaseBackup, Plug, Cloud, MonitorSmartphone, Euro, Power, Wrench } from 'lucide-react';
import { DataRetentionSettings } from './DataRetentionSettings';
import { TariffHistoryPanel } from './TariffHistoryPanel';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useRooms } from '@/hooks/useRooms';
import { TuyaSubscriptionAlert } from '@/components/settings/TuyaSubscriptionAlert';
import { TuyaConnectionTest } from '@/components/settings/TuyaConnectionTest';
import { useControlMode } from '@/hooks/useControlMode';
import { BackupSettingsSection } from '@/components/settings/BackupSettingsSection';
import { HouseSettingsCard } from '@/components/settings/HouseSettingsCard';
import { RoomsSection } from '@/components/settings/RoomsSection';
import { SectionCard } from '@/components/settings/SettingsBits';

interface SettingsPanelProps {
  isConnected: boolean;
  lastUpdate?: string;
}

function ModeButton({ active, onClick, icon, title, text }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-muted/50'
      }`}
    >
      <span className={`mt-0.5 ${active ? 'text-primary' : 'text-muted-foreground'}`}>{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}{active && <span className="ml-2 text-xs text-primary">aktiv</span>}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}

export function SettingsPanel({ isConnected, lastUpdate }: SettingsPanelProps) {
  const { settings, saveSettings, isLoading: isHeatingLoading } = useHeatingSettings();
  const { rooms, saveRoom, updateRoomFields, deleteRoom, loadRooms, isLoading: isRoomsLoading } = useRooms();
  const { mode, setMode, isLoading: isModeLoading } = useControlMode();
  const [confirmCloud, setConfirmCloud] = useState(false);

  const minutesSinceUpdate = lastUpdate ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000) : null;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* 1. Betrieb */}
      <SectionCard
        title="Betrieb"
        icon={<Power className="w-5 h-5 text-primary" />}
        description="Wie die Befehle zu den 12 Thermostaten kommen."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <ModeButton
            active={mode === 'local'}
            onClick={() => mode !== 'local' && !isModeLoading && setMode('local')}
            icon={<MonitorSmartphone className="w-4 h-4" />}
            title="Lokaler Service (LAN)"
            text="Befehle gehen über den Thermostat-Dienst auf dem PC in Österreich. Kein Cloud-Kontingent."
          />
          <ModeButton
            active={mode === 'cloud'}
            onClick={() => mode !== 'cloud' && !isModeLoading && setConfirmCloud(true)}
            icon={<Cloud className="w-4 h-4" />}
            title="Tuya Cloud"
            text="Nur mit gültigem Tuya-IoT-Abo. Die Lizenzen sind derzeit nicht verlängert."
          />
        </div>
        <AlertDialog open={confirmCloud} onOpenChange={setConfirmCloud}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Auf Tuya Cloud umschalten?</AlertDialogTitle>
              <AlertDialogDescription>
                Ohne gültige Tuya-Cloud-Zugangsdaten erreicht danach <strong>kein Befehl</strong> mehr die
                Thermostate – die Automatik steuert dann ins Leere. Nur umschalten, wenn das Cloud-Abo aktiv ist.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Lokal bleiben</AlertDialogCancel>
              <AlertDialogAction onClick={() => setMode('cloud')}>Trotzdem umschalten</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SectionCard>

      {/* 2. Haus */}
      <HouseSettingsCard settings={settings} onSave={saveSettings} isLoading={isHeatingLoading} />

      {/* 3. Räume */}
      <RoomsSection
        rooms={rooms}
        isLoading={isRoomsLoading}
        onSave={updateRoomFields}
        onCreate={(room) => saveRoom(room)}
        onDelete={deleteRoom}
        onReload={loadRooms}
      />

      {/* 4. System */}
      <SectionCard title="System" icon={<Wrench className="w-5 h-5 text-muted-foreground" />} description="Selten benötigt – deshalb eingeklappt.">
        <Accordion type="multiple" className="space-y-2">
          <AccordionItem value="collector" className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Server className="h-4 w-4 text-primary" />Datensammler (Fronius)
                <span className={`ml-2 inline-flex items-center gap-1 text-xs ${isConnected ? 'text-success' : 'text-destructive'}`}>
                  {isConnected ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {isConnected ? 'aktiv' : 'keine Daten'}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
              <p>
                {isConnected
                  ? `Letzte Messung vor ${minutesSinceUpdate ?? 0} Minuten.`
                  : 'Seit längerem keine Messwerte. Dienst „SmartfoxFronius“ auf dem PC in Österreich prüfen.'}
              </p>
              <p>
                Der Datensammler läuft als Windows-Dienst im LAN, liest den Fronius-Wechselrichter und schreibt
                die Werte in die Datenbank. Die App fragt sie regelmäßig ab. Einrichtung: Ordner
                {' '}<code className="px-1 rounded bg-muted font-mono text-xs">local-collector/</code> im Repo.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="tuya" className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex items-center gap-2 text-sm font-medium"><Plug className="h-4 w-4 text-primary" />Tuya Cloud (Verbindungstest & Abo)</span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-4">
              <TuyaConnectionTest />
              {mode === 'cloud' && <TuyaSubscriptionAlert />}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="daten" className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex items-center gap-2 text-sm font-medium"><Database className="h-4 w-4 text-primary" />Datenspeicherung</span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4"><DataRetentionSettings /></AccordionContent>
          </AccordionItem>

          <AccordionItem value="sicherung" className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex items-center gap-2 text-sm font-medium"><DatabaseBackup className="h-4 w-4 text-primary" />Datensicherung</span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4"><BackupSettingsSection /></AccordionContent>
          </AccordionItem>

          <AccordionItem value="tarife" className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex items-center gap-2 text-sm font-medium"><Euro className="h-4 w-4 text-primary" />Tarife & Preisverlauf</span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4"><TariffHistoryPanel /></AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}
