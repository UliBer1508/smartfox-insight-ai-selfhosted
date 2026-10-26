// Wartungsfunktionen für alle 12 Thermostate – im Abschnitt "Betrieb" der Einstellungen.
// Ersetzt die Knöpfe "Alle pushen" und "Sync" der früheren Karte "Thermostat-Steuerung"
// (Tab Heizung & KI, entfernt am 26.10.2026). Beide Steuerwege bleiben vollständig erhalten:
//
//   Alle Sollwerte erneut senden
//     Lokal: je Raum ein set_temp-Befehl in thermostat_commands → lokaler Dienst (LAN)
//     Cloud: tuya-control/push-all-temps (Tuya-Kontingent wird geprüft, Rest übersprungen)
//
//   Werte aus der Tuya Cloud lesen (nur im Cloud-Modus sichtbar)
//     tuya-control/sync-all?force=1 – umgeht nur die 60-Min-Sperre, nie die Kontingent-
//     Prüfung. Im Lokal-Modus überflüssig: der Dienst liest die Thermostate selbst laufend.
//
// Normalerweise ist beides nicht nötig: pv-automation vergleicht den Sollwert in der DB mit
// dem vom Thermostat gemeldeten und korrigiert Abweichungen selbst.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Send, CloudDownload } from 'lucide-react';
import { usePushAllTemps } from '@/hooks/usePushAllTemps';
import { useTuyaControl } from '@/hooks/useTuyaControl';
import { ControlMode } from '@/hooks/useControlMode';

export function ThermostatMaintenance({ mode, onDone }: { mode: ControlMode; onDone?: () => void }) {
  const { pushAllTemps, isPushing } = usePushAllTemps();
  const { syncAllStatus, isSyncing } = useTuyaControl();
  const [confirmPush, setConfirmPush] = useState(false);
  const isCloud = mode === 'cloud';

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div>
        <div className="text-sm font-medium">Thermostate</div>
        <div className="text-xs text-muted-foreground">
          Nur bei Bedarf, z. B. nach Stromausfall oder Neustart eines Thermostats. Im Normalbetrieb
          gleicht die Automatik Abweichungen selbst aus.
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setConfirmPush(true)} disabled={isPushing || isSyncing}>
          {isPushing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
          Alle Sollwerte erneut senden
        </Button>

        {isCloud && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { await syncAllStatus({ force: true }); onDone?.(); }}
            disabled={isPushing || isSyncing}
          >
            {isSyncing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CloudDownload className="w-4 h-4 mr-1.5" />}
            Werte aus der Tuya Cloud lesen
          </Button>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        {isCloud
          ? 'Cloud: Senden kostet je Raum einen Tuya-Aufruf, Lesen zwei Aufrufe für alle Räume. Beides beachtet das Tageskontingent.'
          : 'Lokal: Die Befehle gehen an den Thermostat-Dienst auf dem PC in Österreich. Die Ist-Werte liest der Dienst selbst laufend.'}
      </div>

      <AlertDialog open={confirmPush} onOpenChange={setConfirmPush}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alle Sollwerte erneut senden?</AlertDialogTitle>
            <AlertDialogDescription>
              Jeder Raum bekommt den Sollwert, der gerade in der App steht, noch einmal ans Thermostat
              geschickt{isCloud ? ' – über die Tuya Cloud, je Raum ein Aufruf vom Tageskontingent' : ' – über den lokalen Dienst'}.
              Manuell übersteuerte Räume behalten ihren Wert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { await pushAllTemps(); onDone?.(); }}>Senden</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
