// Gemeinsame Bausteine der Planer-Ansichten (Auto-Steuerung › Plan und › Verlauf) – 12.11.2026.
// Aus PlanerView.tsx herausgelöst, damit beide Ansichten gleich aussehen (Uli: „die Art und Weise des Planers verwenden“).
export const TZ = 'Europe/Vienna';
export const hm = (ms: number) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const num = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const tagKurz = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
// Farben (geprüft mit dataviz/validate_palette, hell und dunkel, inkl. Farbenblindheit):
//   PV #c77a05 / #c47f0e · Heizung #3c83f6 / #4a8ef0 · Netz #df3a3a / #e45050
export const FARBEN = '[--c-pv:#c77a05] [--c-heiz:#3c83f6] [--c-netz:#df3a3a] [--c-rest:#9b59d0] [--c-ki:#7c3aed] dark:[--c-pv:#c47f0e] dark:[--c-heiz:#4a8ef0] dark:[--c-netz:#e45050] dark:[--c-rest:#b57ee6] dark:[--c-ki:#a78bfa]';
export const TIP = { contentStyle: { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 } };
export const ACHSE = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

export function Kachel({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-xl font-bold font-mono">{v}</div>
      {s && <div className="text-xs text-muted-foreground">{s}</div>}
    </div>
  );
}
