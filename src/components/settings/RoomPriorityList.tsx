// Einstellungen › Räume: Heiz-Reihenfolge (Priorität 1–12) per ▲▼ (Stand 26.10.2026).
// Vorher nur als Zahlenfeld in der Raum-Übersicht (Heizung & KI), das belegte Nummern ablehnte.
//
// rooms.priority ist UNIQUE und 1..12 (NULL erlaubt). Tauschen daher in drei Schritten:
//   A → NULL, B → alte Nummer von A, A → alte Nummer von B.
// Vorher wird geprüft, ob beide Räume noch die angezeigte Nummer haben (sonst neu laden).
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Room } from '@/types/room';

export function RoomPriorityList({ rooms, onChanged }: { rooms: Room[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = [...rooms].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  const swap = async (a: Room, b: Room) => {
    if (!a.id || !b.id || a.priority == null || b.priority == null) return;
    setBusy(a.id);
    try {
      const { data: fresh, error: fe } = await supabase.from('rooms').select('id, priority').in('id', [a.id, b.id]);
      if (fe) throw fe;
      const pa = fresh?.find(r => r.id === a.id)?.priority;
      const pb = fresh?.find(r => r.id === b.id)?.priority;
      if (pa !== a.priority || pb !== b.priority) {
        toast.error('Reihenfolge wurde inzwischen geändert – neu geladen.');
        return;
      }
      const s1 = await supabase.from('rooms').update({ priority: null }).eq('id', a.id);
      if (s1.error) throw s1.error;
      const s2 = await supabase.from('rooms').update({ priority: pa }).eq('id', b.id);
      if (s2.error) { await supabase.from('rooms').update({ priority: pa }).eq('id', a.id); throw s2.error; }
      const s3 = await supabase.from('rooms').update({ priority: pb }).eq('id', a.id);
      if (s3.error) throw s3.error;
      toast.success(`${a.name} jetzt P${pb}, ${b.name} jetzt P${pa}`);
    } catch (e) {
      toast.error(`Tausch fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Bei knappem Überschuss heizt die Automatik zuerst P1, dann P2 … Mit ▲▼ zwei benachbarte Räume tauschen.
      </p>
      <ol className="divide-y rounded-lg border">
        {sorted.map((r, i) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2">
            <span className="w-9 text-sm font-semibold tabular-nums">P{r.priority ?? '–'}</span>
            <span className="flex-1 min-w-0 truncate text-sm">{r.name}</span>
            {busy === r.id && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label={`${r.name} nach oben`}
              disabled={i === 0 || !!busy} onClick={() => swap(r, sorted[i - 1])}><ArrowUp className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label={`${r.name} nach unten`}
              disabled={i === sorted.length - 1 || !!busy} onClick={() => swap(r, sorted[i + 1])}><ArrowDown className="w-4 h-4" /></Button>
          </li>
        ))}
      </ol>
    </div>
  );
}
