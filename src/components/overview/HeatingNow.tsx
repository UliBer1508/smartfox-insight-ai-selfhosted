// „Heizung jetzt“ (06.11.2026, doc/FIX-HEIZLEISTUNG-2026-11-06.md).
// Uli: „wir brauchen mehr Kontrolle und klare Aussagen, ob geheizt wird und wieviel“.
//
// Zwei Zahlen nebeneinander:
//   gemessen          = Hausverbrauch (Fronius) − Grundlast (aus der Leistungsmessung, sonst 240 W)
//   laut Thermostaten = Summe der Raumleistungen aller Räume, deren Thermostat „heizt“ meldet
// Weichen sie um mehr als 500 W voneinander ab, sagt die Karte, was das bedeuten kann.
// Dazu: Leistungsgrenze der Automatik (Tag/Nacht), heizende Räume mit „seit“ und kWh heute.
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';
import { Room } from '@/types/room';
import { AlertTriangle, Flame, CheckCircle2 } from 'lucide-react';

const TZ = 'Europe/Vienna';
const db = supabase as any; // neue Tabellen/Funktionen (SQL 24) noch nicht in types.ts
const GRUNDLAST_STANDARD_W = 240;
const ABWEICHUNG_HINWEIS_W = 500;

export const roomPowerW = (r: Room) => Number(r.calculated_power_w) || Number(r.heating_power_w) || 800;
const fmtKW = (w: number) => `${(w / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`;
const fmtKWh = (k: number) => `${k.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '–';

export type RaumHeute = { room_id: string; heizt_seit: string | null; heiz_min: number; kwh: number };

/** Heizung heute je Raum (SQL raum_heizung_heute) + letzte gemessene Grundlast. Lädt jede Minute neu. */
export function useHeizungHeute() {
  const [heute, setHeute] = useState<Map<string, RaumHeute>>(new Map());
  const [grundlast, setGrundlast] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [h, g] = await Promise.all([
        db.rpc('raum_heizung_heute'),
        db.from('raum_leistung_messung').select('watt, gemessen_at').eq('raum', 'Grundlast').order('gemessen_at', { ascending: false }).limit(1),
      ]);
      if (!alive) return;
      if (!h.error) setHeute(new Map(((h.data ?? []) as RaumHeute[]).map(r => [r.room_id, { ...r, kwh: Number(r.kwh) }])));
      const w = Number(g.data?.[0]?.watt);
      setGrundlast(Number.isFinite(w) && w > 0 ? w : null);
    };
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return { heute, grundlast };
}

type Grenze = { used: number; cap: number; text: string } | null;

/** Leistungsgrenze der Automatik: tagsüber heating_day_mode, nachts heating_night_mode (nur frische Werte). */
function useGrenze(night: boolean): Grenze {
  const [g, setG] = useState<Grenze>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const key = night ? 'heating_night_mode' : 'heating_day_mode';
      const { data } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
      const v = data?.value as { computed_at?: string; used_w?: number; cap_w?: number; grid_used_w?: number; grid_cap_w?: number; mode?: string } | undefined;
      const fresh = v?.computed_at && Date.now() - new Date(v.computed_at).getTime() < 20 * 60_000;
      if (!alive) return;
      if (!fresh) { setG(null); return; }
      const used = Number(night ? v?.used_w : v?.grid_used_w) || 0;
      const cap = Number(night ? v?.cap_w : v?.grid_cap_w) || 0;
      const text = night ? 'Nacht' : v?.mode === 'battery_gate' ? 'Batterie-Schutz' : v?.mode === 'evening' ? 'Abend' : v?.mode === 'wait' ? 'Wartetag' : 'ohne PV';
      setG({ used, cap, text });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [night]);
  return g;
}

export function HeatingNowCard({ rooms, reading, night, heute, grundlast }: {
  rooms: Room[]; reading: EnergyReading | null; night: boolean; heute: Map<string, RaumHeute>; grundlast: number | null;
}) {
  const grenze = useGrenze(night);
  const heizend = rooms.filter(r => r.tuya_device_id && r.is_heating);
  const lautThermostat = heizend.reduce((s, r) => s + roomPowerW(r), 0);
  const base = grundlast ?? GRUNDLAST_STANDARD_W;
  const verbrauch = reading?.consumption ?? null;
  const gemessen = verbrauch == null ? null : Math.max(0, Math.round(verbrauch - base));
  const diff = gemessen == null ? 0 : gemessen - lautThermostat;
  const mitPv = (reading?.pv_power ?? 0) > 30;
  const kwhHeute = [...heute.values()].reduce((s, r) => s + (r.kwh || 0), 0);

  let hinweis: { ok: boolean; text: string };
  if (gemessen == null) hinweis = { ok: true, text: 'Keine aktuellen Fronius-Daten.' };
  else if (diff > ABWEICHUNG_HINWEIS_W) hinweis = { ok: false, text:
      `${fmtKW(diff)} mehr, als die heizenden Räume erklären. Läuft etwas anderes (Espressomaschine, Herd${mitPv ? ', Warmwasser, Auto' : ''})? `
      + 'Oder ein Thermostat heizt, ohne es zu melden.' };
  else if (diff < -ABWEICHUNG_HINWEIS_W) hinweis = { ok: false, text:
      `${fmtKW(-diff)} weniger, als die heizenden Räume brauchen müssten. Ist die Leistung eines Raums zu hoch eingestellt, `
      + 'oder ist die Meldung „heizt“ gerade erst gekommen bzw. veraltet?' };
  else hinweis = { ok: true, text: 'Messung und Thermostate passen zusammen.' };

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Heizung jetzt</div>
          <div className="text-xs text-muted-foreground">Stand {fmtTime(reading?.timestamp)}</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">gemessen</div>
            <div className={`text-2xl font-bold tabular-nums ${gemessen && gemessen > 300 ? 'text-energy-import' : ''}`}>{gemessen == null ? '–' : fmtKW(gemessen)}</div>
            <div className="text-xs text-muted-foreground">Verbrauch − Grundlast {Math.round(base)} W</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">laut Thermostaten</div>
            <div className="text-2xl font-bold tabular-nums">{fmtKW(lautThermostat)}</div>
            <div className="text-xs text-muted-foreground">{heizend.length} {heizend.length === 1 ? 'Raum heizt' : 'Räume heizen'}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Grenze</div>
            <div className="text-2xl font-bold tabular-nums">{grenze && grenze.cap > 0 ? fmtKW(grenze.cap) : '–'}</div>
            <div className="text-xs text-muted-foreground">{grenze ? `${grenze.text} · verplant ${fmtKW(grenze.used)}` : 'keine aktuelle Angabe'}</div>
          </div>
        </div>

        <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${hinweis.ok ? 'bg-muted/40' : 'bg-warning/15 border border-warning/40'}`}>
          {hinweis.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-success shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" />}
          <span>{hinweis.text}{mitPv && hinweis.ok && gemessen != null ? ' (Mit PV können Warmwasser und Auto im Verbrauch mitzählen.)' : ''}</span>
        </div>

        {heizend.length > 0 && (
          <ul className="text-sm space-y-1">
            {heizend.map(r => {
              const h = heute.get(r.id);
              return (
                <li key={r.id} className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-energy-import shrink-0" />
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground">{fmtKW(roomPowerW(r))}{h?.heizt_seit ? ` · seit ${fmtTime(h.heizt_seit)}` : ''}</span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="text-xs text-muted-foreground border-t pt-2">
          Heute bisher {fmtKWh(kwhHeute)} Heizstrom (Heizzeit × Raumleistung)
        </div>
      </CardContent>
    </Card>
  );
}
