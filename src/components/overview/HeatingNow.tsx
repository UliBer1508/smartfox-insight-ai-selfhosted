// „Heizung jetzt“ (06.11.2026, doc/FIX-HEIZLEISTUNG-2026-11-06.md).
// Uli: „wir brauchen mehr Kontrolle und klare Aussagen, ob geheizt wird und wieviel“.
//
// Zwei Zahlen nebeneinander:
//   gemessen          = Hausverbrauch (Fronius) − Grundlast (aus der Leistungsmessung, sonst 240 W) − Auto
//                       (Ladeleistung der Wallboxen, seit 14.11.2026 vom Fronius-Collector, energy_readings.auto_w)
//   laut Thermostaten = Summe der Raumleistungen aller Räume, deren Thermostat „heizt“ meldet
// Weichen sie um mehr als 500 W voneinander ab, sagt die Karte, was das bedeuten kann.
// Dazu: Leistungsgrenze der Automatik (Tag/Nacht), heizende Räume mit „seit“ und kWh heute.
// Seit 16.11.2026 (doc/FIX-HEIZUNG-JETZT-BEGRUENDUNG-2026-11-16.md): je heizendem Raum die Begründung
// (manuell / nicht steuerbar / Automatik / Nachlauf) und ein Kasten „Netzstrom sparen“ mit Hinweisen.
// Die Karte ändert keine Einstellung – sie zeigt nur, wo es sich lohnt hinzuschauen.
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';
import { Room } from '@/types/room';
import { HeatingSettings } from '@/types/heating';
import { TZ, roomPowerW, fmtKW, fmtTime, fmtC, grundFuer, sparHinweise, erklaereAbweichung, DayModeRoom, Befehl, TState, Prognose, Halt } from '@/lib/heizungJetzt';
import { AlertTriangle, Flame, CheckCircle2, Lightbulb } from 'lucide-react';

export { roomPowerW };
export type { DayModeRoom };
const db = supabase as any; // neue Tabellen/Funktionen (SQL 24) noch nicht in types.ts
const GRUNDLAST_STANDARD_W = 240;

const fmtKWh = (k: number) => `${k.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;

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

// ---------------------------------------------------------------- Begründung je Raum
// Begründung der Automatik je Raum aus dem Tagesmodus (system_settings.heating_day_mode.rooms[].why, 05.11.2026),
// nachts aus heating_night_mode (Leistungsgrenze auch nachts, 06.11.2026).
// Nur frische Werte (< 20 min); bei PV-Boost/Manuell gilt die Begründung nicht.
// 16.11.2026 aus HouseOverview hierher verschoben – Raumkarte und „Heizung jetzt“ nutzen denselben Hook.
export function useDayModeRooms(night: boolean) {
  const [rooms, setRooms] = useState<Map<string, DayModeRoom>>(new Map());
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from('system_settings').select('value').eq('key', night ? 'heating_night_mode' : 'heating_day_mode').maybeSingle();
      const v = data?.value as { computed_at?: string; rooms?: DayModeRoom[] } | undefined;
      const fresh = v?.computed_at && Date.now() - new Date(v.computed_at).getTime() < 20 * 60_000;
      if (alive) setRooms(new Map(fresh ? (v?.rooms ?? []).map(r => [r.room_id, r]) : []));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [night]);
  return rooms;
}

/** Letzte Schaltbefehle (3 h), Thermostat-Befund und PV-Prognose heute – lädt jede Minute neu. */
function useHeizKontext() {
  const [befehle, setBefehle] = useState<Map<string, Befehl[]>>(new Map());
  const [befund, setBefund] = useState<Map<string, TState>>(new Map());
  const [prognose, setPrognose] = useState<Prognose>(null);
  const [halt, setHalt] = useState<Map<string, Halt>>(new Map());
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const seit = new Date(Date.now() - 3 * 3600_000).toISOString();
      const heute = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
      const [c, t, f, h] = await Promise.all([
        db.from('thermostat_commands').select('room_id, value, reason, created_at').eq('command', 'set_temp')
          .gte('created_at', seit).order('created_at', { ascending: false }).limit(300),
        db.from('thermostat_state').select('room_id, befund, dp101'),
        supabase.from('pv_forecasts').select('hourly_watts, sunrise').eq('date', heute).order('fetched_at', { ascending: false }).limit(1),
        db.from('system_settings').select('value').eq('key', 'haltezeit_aktiv').maybeSingle(),
      ]);
      if (!alive) return;
      if (!c.error) {
        const m = new Map<string, Befehl[]>();
        for (const b of (c.data ?? []) as Befehl[]) { const l = m.get(b.room_id) ?? []; l.push(b); m.set(b.room_id, l); }
        setBefehle(m);
      }
      if (!t.error) setBefund(new Map(((t.data ?? []) as TState[]).map(x => [x.room_id, x])));
      if (!h.error) setHalt(new Map((((h.data?.value as any)?.rooms ?? []) as Halt[]).map(x => [x.room_id, x])));
      const row = f.data?.[0];
      setPrognose(row ? { hourly: (row.hourly_watts as Record<string, number>) ?? {}, sunrise: row.sunrise ?? null } : null);
    };
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return { befehle, befund, prognose, halt };
}

export function HeatingNowCard({ rooms, reading, night, heute, grundlast, settings, dayRooms }: {
  rooms: Room[]; reading: EnergyReading | null; night: boolean; heute: Map<string, RaumHeute>; grundlast: number | null;
  settings: HeatingSettings; dayRooms: Map<string, DayModeRoom>;
}) {
  const grenze = useGrenze(night);
  const { befehle, befund, prognose, halt } = useHeizKontext();
  const heizend = rooms.filter(r => r.tuya_device_id && r.is_heating);
  const lautThermostat = heizend.reduce((s, r) => s + roomPowerW(r), 0);
  const base = grundlast ?? GRUNDLAST_STANDARD_W;
  const verbrauch = reading?.consumption ?? null;
  // 14.11.2026: Auto (Wallbox) und Batterie werden nicht mehr erfragt, sondern gelesen (doc/FIX-HEIZUNG-JETZT-AUTO-2026-11-14.md)
  const autoW = reading?.auto_w == null ? null : Math.max(0, Number(reading.auto_w));
  const battW = reading?.battery_power == null ? null : Number(reading.battery_power);   // negativ = lädt
  const gemessen = verbrauch == null ? null : Math.max(0, Math.round(verbrauch - base - (autoW ?? 0)));
  const mitPv = (reading?.pv_power ?? 0) > 30;
  const nebenbei: string[] = [];
  if (autoW != null && autoW > 100) nebenbei.push(`Auto lädt ${fmtKW(autoW)} (Wallbox, schon abgezogen)`);
  if (battW != null && battW < -100) nebenbei.push(`Batterie lädt ${fmtKW(-battW)}`);
  if (battW != null && battW > 100) nebenbei.push(`Batterie gibt ${fmtKW(battW)} ab`);
  const autoText = autoW == null ? 'Auto unbekannt (keine Wallbox-Daten)' : autoW > 100 ? 'Auto lädt, ist schon abgezogen' : 'Auto lädt nicht';
  const kwhHeute = [...heute.values()].reduce((s, r) => s + (r.kwh || 0), 0);
  const gruende = new Map(heizend.map(r => [r.id, grundFuer(r, dayRooms.get(r.id), befehle.get(r.id) ?? [], befund.get(r.id), halt.get(r.id))]));
  const netzW = Math.max(0, Number(reading?.power_io) || 0);   // Fronius: positiv = Bezug
  const tipps = sparHinweise({ heizend, gruende, netzW, night, settings, prognose, befund });

  // 16.11.2026: Abweichung wird erklärt statt erfragt (erklaereAbweichung in src/lib/heizungJetzt.ts)
  const mitZeit = (r: Room) => ({ ...r, heizt_seit: heute.get(r.id)?.heizt_seit ?? null });
  const hinweis = erklaereAbweichung({
    gemessenW: gemessen, messungAt: reading?.timestamp, heizend: heizend.map(mitZeit),
    alleRaeume: rooms.filter(r => r.tuya_device_id).map(mitZeit), mitPv, autoText,
    abschaltIds: new Set(heizend.filter(r => gruende.get(r.id)?.art === 'abschalten').map(r => r.id)),
  });

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
            <div className="text-xs text-muted-foreground">Verbrauch − Grundlast {Math.round(base)} W{autoW != null && autoW > 100 ? ` − Auto ${fmtKW(autoW)}` : ''}</div>
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
          <span>{hinweis.text}{nebenbei.length > 0 ? ` ${nebenbei.join(' · ')}.` : ''}</span>
        </div>

        {heizend.length > 0 && (
          <ul className="text-sm space-y-1">
            {heizend.map(r => {
              const h = heute.get(r.id);
              const g = gruende.get(r.id);
              return (
                <li key={r.id} className="flex items-start gap-2">
                  <Flame className="w-4 h-4 mt-0.5 text-energy-import shrink-0" />
                  <div className="min-w-0">
                    <div>
                      <span className="font-medium">{r.name}</span>{' '}
                      <span className="text-muted-foreground">{fmtKW(roomPowerW(r))}{h?.heizt_seit ? ` · seit ${fmtTime(h.heizt_seit)}` : ''}{r.current_temp != null ? ` · ${fmtC(Number(r.current_temp))}` : ''}</span>
                    </div>
                    <div className={`text-xs ${g?.art === 'gestoert' ? 'text-warning' : 'text-muted-foreground'}`}>{g?.text}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tipps.length > 0 && (
          <div className="rounded-md px-3 py-2 bg-warning/15 border border-warning/40 text-sm">
            <div className="flex items-center gap-1.5 font-medium"><Lightbulb className="w-4 h-4 text-warning shrink-0" />Netzstrom sparen</div>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              {tipps.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
            <div className="text-xs text-muted-foreground mt-1">Nur Hinweise – die Karte ändert keine Einstellung.</div>
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t pt-2">
          Heute bisher {fmtKWh(kwhHeute)} Heizstrom (Heizzeit × Raumleistung)
        </div>
      </CardContent>
    </Card>
  );
}
