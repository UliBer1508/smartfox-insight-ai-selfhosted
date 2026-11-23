// Karte „Sicherungen“ im Systemstatus-Fenster (23.11.2026, Uli: „unter Alles läuft eine Karte
// Sicherungen“). Je Datenbank eine Zeile: zuletzt gesichert, von welchem PC, Ersatz übersprungen.
// Rechnung: sicherungKurz() in lib/backupStatus.ts. GLEICHE Datei in Hausverwaltung und Heizung
// (src/components/layout/SystemBackupsCard.tsx) – Änderungen in beiden Repos gleich halten.
import { DatabaseBackup } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SicherungKurz } from '@/lib/backupStatus';

const DOT: Record<SicherungKurz['tone'], string> = {
  ok: 'bg-green-500', bad: 'bg-red-500', warn: 'bg-amber-500', off: 'bg-muted-foreground/40',
};

export function SystemBackupsCard({ items }: { items: SicherungKurz[] }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 font-medium text-sm">
        <DatabaseBackup className="w-4 h-4" />Sicherungen
        <span className="ml-auto text-xs text-muted-foreground">jede Nacht · München, Österreich als Ersatz</span>
      </div>
      <div className="divide-y border-t">
        {items.map((s) => (
          <div key={s.label} className="flex items-center gap-2.5 px-3 py-2 text-sm">
            <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', DOT[s.tone])} />
            <div className="flex-1 min-w-0">
              <div className="truncate">{s.label}</div>
              <div className={cn('text-xs', s.tone === 'bad' ? 'text-red-600' : 'text-muted-foreground')}>{s.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
