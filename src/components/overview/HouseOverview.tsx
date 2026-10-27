// Übersicht im Aufbau der "Heizung München":
// Statuszeile → Betriebsmodus + Energie-Kacheln → Wetter & PV-Prognose → Raumkarten.
// Rein lesend bzw. über die bestehenden Schreibwege (thermostat_commands via useTuyaControl,
// rooms.manual_override_until). Keine Änderung an der Steuerlogik (pv-automation).

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useTuyaControl } from '@/hooks/useTuyaControl';
import { usePvForecast } from '@/hooks/usePvForecast';
import { getLocalDateString, getViennaMinutesSinceMidnight } from '@/lib/dateUtils';
import { EnergyReading } from '@/types/energy';
import { HeatingSettings } from '@/types/heating';
import { Room } from '@/types/room';
import { Moon, Sun, Zap, Hand, PauseCircle, Flame, Snowflake, Brain, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ApiErrorBanner } from '@/components/heating/ApiErrorBanner';
import { EnergyFlowDiagram } from '@/components/energy/EnergyFlowDiagram';
import { RoomStatusTable } from '@/components/heating/RoomStatusTable';
import { useKiPending } from '@/hooks/useKiPending';

const TZ = 'Europe/Vienna';

// ---------------------------------------------------------------- Formatierung
const fmtW = (w: number | null | undefined) => {
  if (w == null || Number.isNaN(w)) return '–';
  const a = Math.abs(w);
  return a >= 1000 ? `${(w / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kW` : `${Math.round(w)} W`;
};
const fmtT = (t: number | null | undefined, digits = 1) =>
  t == null ? '–' : `${Number(t).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} °C`;
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '–';
const minutesAgo = (iso: string | null | undefined) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 60000) : null;
const toMin = (hhmm: string | undefined, fallback: string) => {
  const [h, m] = (hhmm || fallback).split(':').map(Number);
  return h * 60 + (m || 0);
};

function isNight(settings: HeatingSettings) {
  const now = getViennaMinutesSinceMidnight();
  const start = toMin(settings.night_start_time, '22:00');
  const end = toMin(settings.night_end_time, '08:00');
  return start > end ? now >= start || now < end : now >= start && now < end;
}

// ---------------------------------------------------------------- Modus
type Tone = 'night' | 'pv' | 'normal' | 'manual' | 'off';
const TONE: Record<Tone, { badge: string; hero: string; text: string }> = {
  night: { badge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30', hero: 'border-indigo-500/40 bg-indigo-500/5', text: 'text-indigo-600 dark:text-indigo-300' },
  pv: { badge: 'bg-energy-export/15 text-energy-export border-energy-export/30', hero: 'border-energy-export/50 bg-energy-export/5', text: 'text-energy-export' },
  normal: { badge: 'bg-primary/10 text-primary border-primary/30', hero: 'border-primary/40 bg-primary/5', text: 'text-primary' },
  manual: { badge: 'bg-warning/20 text-foreground border-warning/50', hero: 'border-warning/50 bg-warning/5', text: 'text-warning' },
  off: { badge: 'bg-muted text-muted-foreground border-border', hero: '', text: 'text-muted-foreground' },
};

/** Nutzbarer Überschuss: Einspeisung + Batterieladung, die Ladung aber erst ab dem Heiz-SOC-Gate. */
function usableSurplus(r: EnergyReading | null, socGate: number) {
  if (!r) return null;
  const exportW = r.power_io < 0 ? -r.power_io : 0; // Fronius: negativ = Einspeisung
  const chargeW = (r.battery_power ?? 0) < 0 ? -(r.battery_power as number) : 0; // negativ = Laden
  const soc = r.battery_soc ?? 0;
  return Math.round(exportW + (soc >= socGate ? chargeW : 0));
}

function roomState(room: Room, night: boolean): { label: string; tone: Tone } {
  if (room.manual_override_until && new Date(room.manual_override_until) > new Date()) return { label: 'Manuell', tone: 'manual' };
  if (room.automation_enabled === false) return { label: 'Automatik aus', tone: 'off' };
  if (night) return { label: 'Nacht', tone: 'night' };
  if (room.pv_auto_active) return { label: 'PV', tone: 'pv' };
  return { label: 'Normal', tone: 'normal' };
}

// ---------------------------------------------------------------- Statuszeile
function StatusBar({ energyOk, energyTs }: { energyOk: boolean; energyTs?: string }) {
  const [svc, setSvc] = useState<{ last_sync: string | null; devices_ok: number | null; devices_configured: number | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from('service_health')
        .select('last_sync, devices_ok, devices_configured')
        .eq('service_name', 'tuya-thermostat')
        .maybeSingle();
      if (alive) setSvc(data);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const age = minutesAgo(svc?.last_sync);
  const svcOk = age != null && age <= 5;
  const energyAge = minutesAgo(energyTs);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${svcOk ? 'bg-success' : 'bg-destructive'}`} />
        {svcOk ? 'Thermostat-Dienst läuft' : age == null ? 'Thermostat-Dienst noch nie gemeldet' : `Thermostat-Dienst offline seit ${age} min`}
      </span>
      {svc?.devices_configured != null && (
        <>
          <span>·</span>
          <span className={svc.devices_ok !== svc.devices_configured ? 'text-warning font-medium' : ''}>
            {svc.devices_ok ?? 0}/{svc.devices_configured} Thermostate ok
          </span>
        </>
      )}
      <span>·</span>
      <span className={energyOk ? '' : 'text-energy-import font-medium'}>
        Fronius {energyOk ? 'ok' : energyAge != null ? `keine Daten seit ${energyAge} min` : 'keine Daten'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- Betriebsmodus
function ModeHero({ rooms, settings, surplus, reading }: { rooms: Room[]; settings: HeatingSettings; surplus: number | null; reading: EnergyReading | null }) {
  const energyTs = reading?.timestamp;
  const night = isNight(settings);
  const auto = rooms.filter(r => r.tuya_device_id);
  const heating = auto.filter(r => r.is_heating).length;
  const pvRooms = auto.filter(r => r.pv_auto_active).length;
  const manual = auto.filter(r => r.manual_override_until && new Date(r.manual_override_until) > new Date()).length;
  const thresholdOn = settings.pv_surplus_threshold_on ?? 500;

  // Tagesmodus der pv-automation (system_settings.heating_day_mode, seit 27.10.2026)
  const [dayMode, setDayMode] = useState<{ mode?: string; computed_at?: string; grid_used_w?: number; grid_cap_w?: number; ki_info?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from('system_settings').select('value').eq('key', 'heating_day_mode').maybeSingle();
      if (alive) setDayMode((data?.value as typeof dayMode) ?? null);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const dayModeFresh = dayMode?.computed_at && Date.now() - new Date(dayMode.computed_at).getTime() < 20 * 60_000;
  const dayModeText = !dayModeFresh || night ? null
    : dayMode?.mode === 'wait' ? 'Tagesmodus: Wartetag – Räume halten „Ohne PV“, bis Überschuss kommt'
    : dayMode?.mode === 'battery_gate' ? 'Tagesmodus: Batterie-Schutz – Räume halten „Ohne PV“'
    : dayMode?.mode === 'grid' ? `Tagesmodus: ohne PV – Eco nach Priorität, ${fmtW(dayMode.grid_used_w ?? 0)} von ${fmtW(dayMode.grid_cap_w ?? 0)}`
    : null;

  const socGate = settings.heating_min_battery_soc ?? 80;
  const soc = reading?.battery_soc ?? null;
  const charging = (reading?.battery_power ?? 0) < -50;

  let tone: Tone = 'normal';
  let label = 'Normal';
  let Icon = Zap;
  let reason: string;
  if (night) {
    tone = 'night'; label = 'Nacht'; Icon = Moon;
    reason = settings.night_heating_mode === 'frost_only'
      ? `Frostschutz 5 °C bis ${settings.night_end_time?.slice(0, 5) ?? '08:00'}`
      : `Nachtabsenkung bis ${settings.night_end_time?.slice(0, 5) ?? '08:00'}`;
  } else if (pvRooms > 0) {
    // Nur dann PV-Modus, wenn die Automatik tatsächlich Räume mit Überschuss heizt
    tone = 'pv'; label = 'PV-Heizen'; Icon = Sun;
    reason = `${pvRooms} ${pvRooms === 1 ? 'Raum' : 'Räume'} im PV-Boost · ${fmtW(surplus)} Überschuss`;
  } else if (charging && soc != null && soc < socGate) {
    reason = `Sonne lädt zuerst die Batterie (${Math.round(soc)} % von ${socGate} %)`;
  } else if ((surplus ?? 0) >= thresholdOn) {
    reason = `${fmtW(surplus)} Überschuss · Automatik heizt gerade keinen Raum damit`;
  } else if ((surplus ?? 0) > 0) {
    reason = `${fmtW(surplus)} Überschuss – unter der Einschaltschwelle (${fmtW(thresholdOn)})`;
  } else {
    reason = 'Kein Überschuss (0 W)';
  }
  const t = TONE[tone];
  return (
    <Card className={`h-full border-2 ${t.hero}`}>
      <CardContent className="p-5 space-y-1.5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Betriebsmodus</div>
        <div className={`flex items-center gap-2 text-3xl font-bold ${t.text}`}>
          <Icon className="w-7 h-7" />
          {label}
        </div>
        <div className="text-sm">{reason}</div>
        {dayModeText && <div className="text-sm text-muted-foreground" title={dayMode?.ki_info ? `KI: ${dayMode.ki_info}` : undefined}>{dayModeText}</div>}
        <div className="text-xs text-muted-foreground">
          {heating} von {auto.length} Räumen heizen
          {manual > 0 && <> · {manual} manuell</>} · Stand {fmtTime(energyTs)}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Energie
function EnergyTiles({ r, surplus }: { r: EnergyReading | null; surplus: number | null }) {
  const grid = r?.power_io;
  const bat = r?.battery_power;
  const tiles = [
    { k: 'PV', v: fmtW(r?.pv_power), s: 'Erzeugung', cls: 'text-energy-export' },
    {
      k: 'Netz', v: fmtW(grid == null ? null : Math.abs(grid)),
      s: grid == null ? '' : grid > 50 ? 'Bezug' : grid < -50 ? 'Einspeisung' : 'ausgeglichen',
      cls: grid != null && grid > 50 ? 'text-energy-import' : grid != null && grid < -50 ? 'text-energy-export' : '',
    },
    {
      k: 'Batterie', v: r?.battery_soc != null ? `${Math.round(r.battery_soc)} %` : '–',
      s: bat == null ? '' : bat < -50 ? `lädt ${fmtW(-bat)}` : bat > 50 ? `entlädt ${fmtW(bat)}` : 'ruht',
      cls: 'text-primary',
    },
    { k: 'Haus', v: fmtW(r?.consumption), s: 'Verbrauch', cls: '' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {tiles.map(t => (
        <Card key={t.k}>
          <CardContent className="p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t.k}</div>
            <div className={`text-xl font-bold font-mono ${t.cls}`}>{t.v}</div>
            <div className="text-xs text-muted-foreground">{t.s}</div>
          </CardContent>
        </Card>
      ))}
      <Card className="col-span-2 sm:col-span-2 border-2 border-energy-export/50 bg-energy-export/5">
        <CardContent className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Überschuss</div>
          <div className="text-xl font-bold font-mono text-energy-export">{fmtW(surplus)}</div>
          <div className="text-xs text-muted-foreground">nutzbar für Heizung</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Wetter & Prognose
// weather_data.timestamp: fetch-weather speichert die Wiener Ortszeit von Open-Meteo,
// geparst in UTC (Deno). Die Uhrzeit steht also "als UTC" in der DB → mit timeZone UTC anzeigen.
function viennaWallClockAsUtc(offsetHours = 0) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date()).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24 + offsetHours));
}

type WeatherRow = { timestamp: string; temperature_c: number | null; cloud_cover_percent: number | null; precipitation_mm: number | null; is_day: boolean | null };

function weatherIcon(w: WeatherRow) {
  if ((w.precipitation_mm ?? 0) >= 0.2) return (w.temperature_c ?? 5) <= 1 ? '🌨️' : '🌧️';
  const c = w.cloud_cover_percent ?? 0;
  if (!w.is_day) return c >= 70 ? '☁️' : '🌙';
  if (c < 25) return '☀️';
  if (c < 70) return '⛅';
  return '☁️';
}
function weatherWord(w: WeatherRow) {
  if ((w.precipitation_mm ?? 0) >= 0.2) return (w.temperature_c ?? 5) <= 1 ? 'Schnee' : 'Regen';
  const c = w.cloud_cover_percent ?? 0;
  return c < 25 ? 'klar' : c < 70 ? 'teils bewölkt' : 'bewölkt';
}

function Forecast({ kwp }: { kwp: number }) {
  const { forecasts, loadForecasts } = usePvForecast();
  const [weather, setWeather] = useState<WeatherRow[]>([]);
  useEffect(() => {
    loadForecasts();
    const load = async () => {
      const from = viennaWallClockAsUtc(0).toISOString();
      const { data } = await supabase
        .from('weather_data')
        .select('timestamp, temperature_c, cloud_cover_percent, precipitation_mm, is_day')
        .gte('timestamp', from)
        .order('timestamp', { ascending: true })
        .limit(30);
      setWeather((data as WeatherRow[]) || []);
    };
    load();
    const t = setInterval(() => { load(); loadForecasts(); }, 15 * 60_000);
    return () => clearInterval(t);
  }, [loadForecasts]);

  const today = getLocalDateString();
  const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getLocalDateString(tomorrowDate);
  const fToday = forecasts.find(f => f.date === today);
  const fTomorrow = forecasts.find(f => f.date === tomorrow);

  // PV-Stützstellen: Schlüssel "YYYY-MM-DD HH:MM:SS" in Ortszeit (Forecast.Solar)
  const allWatts = useMemo(() => {
    const out: { key: string; w: number }[] = [];
    for (const f of [fToday, fTomorrow]) if (f) for (const [k, w] of Object.entries(f.hourly_watts || {})) out.push({ key: k, w: Number(w) });
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }, [fToday, fTomorrow]);
  const wattsAt = (d: Date) => {
    const key = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 13)}`;
    let best: number | null = null;
    for (const x of allWatts) { if (x.key.slice(0, 13) <= key) best = x.w; else break; }
    if (best == null) return null;
    const dayOf = key.slice(0, 10);
    return allWatts.some(x => x.key.startsWith(dayOf)) ? best : null;
  };
  const slot = (h: number) => viennaWallClockAsUtc(h);
  const pvSlots = [1, 3, 6, 12, 24, 30].map(h => ({ d: slot(h), w: wattsAt(slot(h)) })).filter(x => x.w != null);

  const peakTomorrow = fTomorrow ? Object.entries(fTomorrow.hourly_watts || {}).reduce((m, [k, w]) => (Number(w) > m.w ? { k, w: Number(w) } : m), { k: '', w: 0 }) : null;
  let hint: string | null = null;
  if (fTomorrow && peakTomorrow) {
    const ratio = kwp > 0 ? peakTomorrow.w / (kwp * 1000) : 0;
    const word = ratio >= 0.4 ? 'ein sonniger Tag' : ratio >= 0.15 ? 'wechselhaft' : 'wenig Sonne';
    const hour = Number(peakTomorrow.k.slice(11, 13));
    hint = `Morgen erwartet die Prognose ${fTomorrow.expected_kwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh, Spitze ${fmtW(peakTomorrow.w)} gegen ${hour} Uhr – ${word}.`;
  }

  const now = weather[0];
  const todayRows = weather.filter(w => w.timestamp.slice(0, 10) === viennaWallClockAsUtc(0).toISOString().slice(0, 10));
  const temps = todayRows.map(w => w.temperature_c).filter((t): t is number => t != null);
  const wxSlots = [4, 8, 12, 16, 20, 24].map(h => weather[h]).filter(Boolean);
  const label = (d: Date) => {
    const sameDay = d.toISOString().slice(0, 10) === viennaWallClockAsUtc(0).toISOString().slice(0, 10);
    const h = d.getUTCHours();
    return sameDay ? `${h} Uhr` : `${d.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' })} ${h} Uhr`;
  };

  if (!now && !fToday && !fTomorrow) return null;
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Wetter & PV-Prognose</div>
            {now && (
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl" aria-hidden>{weatherIcon(now)}</span>
                <span className="text-2xl font-bold">{fmtT(now.temperature_c, 0)}</span>
                <span>{weatherWord(now)}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {temps.length > 0 && <>Heute noch {Math.round(Math.min(...temps))} bis {Math.round(Math.max(...temps))} °C</>}
              {fToday && <>{temps.length > 0 && ' · '}PV heute {fToday.expected_kwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh erwartet</>}
            </div>
          </div>
        </div>
        {hint && <div className="rounded-lg bg-warning/15 border border-warning/30 px-3 py-2 text-sm">{hint}</div>}
        {pvSlots.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Erwartete PV-Leistung</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {pvSlots.map(x => (
                <div key={x.d.toISOString()} className="rounded-md bg-energy-export/10 px-2.5 py-1.5">
                  <div className="text-xs text-muted-foreground">{label(x.d)}</div>
                  <div className="font-semibold font-mono text-energy-export">{fmtW(x.w)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {wxSlots.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Wetter</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {wxSlots.map(w => (
                <div key={w.timestamp} className="rounded-md bg-muted px-2.5 py-1.5" title={weatherWord(w)}>
                  <div className="text-xs text-muted-foreground">{label(new Date(w.timestamp))}</div>
                  <div className="font-semibold">{weatherIcon(w)} {w.temperature_c != null ? `${Math.round(w.temperature_c)}°` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Raumkarte
function RoomCard({ room, night, onChanged }: { room: Room; night: boolean; onChanged: (id: string, patch: Partial<Room>) => void }) {
  const { setTemperature } = useTuyaControl();
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<number>(Number(room.target_temp ?? room.comfort_temp ?? 21));
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const state = roomState(room, night);
  const overrideOn = state.label === 'Manuell';
  const syncAge = minutesAgo(room.last_thermostat_sync);
  const stale = syncAge != null && syncAge > 10;
  // Estrich-Speicher: comfort_saturated_at wird von pv-automation gesetzt und beim Nachtbeginn
  // geleert; nur Sättigungen von heute (Wiener Datum) zählen.
  const saturatedAt = (room as Room & { comfort_saturated_at?: string | null }).comfort_saturated_at;
  const estrich = !!saturatedAt && getLocalDateString(new Date(saturatedAt)) === getLocalDateString(new Date());
  const solarLimit = !!room.pv_auto_active && room.solar_limit_temp != null;

  const start = async () => {
    if (!room.id || !room.tuya_device_id) return;
    setBusy(true);
    // setTemperature setzt Befehl + 2 h Override; die gewählte Dauer wird danach eingetragen.
    const ok = await setTemperature(room.tuya_device_id, temp, room.id);
    if (ok) {
      const until = new Date(Date.now() + hours * 3600_000).toISOString();
      if (hours !== 2) await supabase.from('rooms').update({ manual_override_until: until }).eq('id', room.id);
      onChanged(room.id, { target_temp: temp, manual_override_until: until });
      setOpen(false);
    }
    setBusy(false);
  };
  const stop = async () => {
    if (!room.id) return;
    setBusy(true);
    await supabase.from('rooms').update({ manual_override_until: null }).eq('id', room.id);
    onChanged(room.id, { manual_override_until: null });
    setBusy(false);
  };

  return (
    <Card className={room.is_heating ? 'border-energy-import/40' : ''}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-lg font-semibold truncate">{room.name}</div>
            <div className={`text-xs ${stale ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
              Messung {fmtTime(room.last_thermostat_sync)}{stale && ` · vor ${syncAge} min`}
            </div>
          </div>
          <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${TONE[state.tone].badge}`}>{state.label}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Ist</div>
            <div className="text-2xl font-bold">{fmtT(room.current_temp)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Soll</div>
            <div className="text-2xl font-bold">{fmtT(room.target_temp)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Heizt</div>
            <div className={`text-lg font-semibold flex items-center gap-1 mt-1 ${room.is_heating ? 'text-energy-import' : 'text-muted-foreground'}`}>
              {room.is_heating ? <><Flame className="w-4 h-4" />ja</> : room.is_heating == null ? '–' : <><Snowflake className="w-4 h-4" />nein</>}
            </div>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          {overrideOn ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5"><Hand className="w-4 h-4 text-warning" />Manuell bis {fmtTime(room.manual_override_until)}</span>
              <Button variant="outline" size="sm" onClick={stop} disabled={busy}>Beenden</Button>
            </div>
          ) : !open ? (
            <Button variant="ghost" className="w-full justify-start text-muted-foreground" disabled={!room.tuya_device_id}
              onClick={() => { setTemp(Number(room.target_temp ?? room.comfort_temp ?? 21)); setOpen(true); }}>
              Manuell übersteuern …
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" aria-label="kälter" onClick={() => setTemp(t => Math.max(5, +(t - 0.5).toFixed(1)))}>−</Button>
                  <span className="w-20 text-center font-semibold">{fmtT(temp)}</span>
                  <Button variant="outline" size="icon" aria-label="wärmer" onClick={() => setTemp(t => Math.min(30, +(t + 0.5).toFixed(1)))}>+</Button>
                </div>
                <select className="h-10 rounded-md border bg-background px-2 text-sm" value={hours} onChange={e => setHours(Number(e.target.value))} aria-label="Dauer">
                  {[1, 2, 4, 8, 24].map(h => <option key={h} value={h}>für {h} h</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</Button>
                <Button size="sm" onClick={start} disabled={busy}>Setzen</Button>
              </div>
              <div className="text-xs text-muted-foreground">Wird innerhalb von etwa einer Minute ans Thermostat übertragen.</div>
            </div>
          )}
        </div>

        {/* Hinweise der Automatik (übernommen aus der früheren Thermostat-Karte, 26.10.2026) */}
        {(estrich || solarLimit) && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {estrich && (
              <span className="px-2 py-0.5 rounded-full border border-orange-400/40 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                title="Komfort heute erreicht. Sollwert zurück auf Eco – der aufgeheizte Estrich gibt die Wärme weiter ab.">
                🧱 Estrich-Speicher
              </span>
            )}
            {solarLimit && (
              <span className="px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                title="Der Raum darf sich durch Sonneneinstrahlung bis zu dieser Temperatur erwärmen – ohne aktives Heizen.">
                ☀️ Solar bis {fmtT(room.solar_limit_temp)}
              </span>
            )}
          </div>
        )}

        <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
          {room.automation_enabled === false && <PauseCircle className="w-3.5 h-3.5" />}
          Nacht {fmtT(room.night_temp)} · Eco {fmtT(room.eco_temp)} · Komfort {fmtT(room.comfort_temp)}
          {room.pv_boost_max_temp != null && <> · PV max {fmtT(room.pv_boost_max_temp)}</>}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Seite
interface HouseOverviewProps {
  currentReading: EnergyReading | null;
  isConnected: boolean;
  rooms: Room[];
  settings: HeatingSettings;
  updateRoomLocally: (roomId: string, updates: Partial<Room>) => void;
  onNavigate?: (tab: 'ki') => void;
}

// Aufklappbarer Block (Zustand nicht gemerkt – standardmäßig zu)
function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-5 py-3 text-sm font-medium hover:bg-muted/40 rounded-lg">
          {title}
          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function HouseOverview({ currentReading, isConnected, rooms, settings, updateRoomLocally, onNavigate }: HouseOverviewProps) {
  const pending = useKiPending();
  const { syncAllStatus } = useTuyaControl();
  const surplus = usableSurplus(currentReading, settings.heating_min_battery_soc ?? 80);
  const night = isNight(settings);
  const thermostatRooms = rooms.filter(r => r.tuya_device_id);
  return (
    <div className="space-y-4 md:space-y-6">
      <StatusBar energyOk={isConnected} energyTs={currentReading?.timestamp} />
      {/* Fehler und offene KI-Entscheidungen zuerst (seit 26.10.2026 hier statt in Heizung & KI) */}
      <ApiErrorBanner onRetry={() => { syncAllStatus({ silent: true }); }} />
      {pending.total > 0 && onNavigate && (
        <button type="button" onClick={() => onNavigate('ki')}
          className="w-full text-left rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-3 flex items-center gap-3 hover:bg-violet-500/15">
          <Brain className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0" />
          <span className="text-sm">
            <strong>{pending.total} KI-{pending.total === 1 ? 'Vorschlag wartet' : 'Vorschläge warten'}</strong> auf deine Entscheidung
            <span className="text-muted-foreground"> · {[pending.parameters && `${pending.parameters} Parameter`, pending.battery && 'Batterie', pending.prices && `${pending.prices} Preis`].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="ml-auto text-sm text-violet-700 dark:text-violet-300 font-medium">Zu KI →</span>
        </button>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <ModeHero rooms={rooms} settings={settings} surplus={surplus} reading={currentReading} />
        <EnergyTiles r={currentReading} surplus={surplus} />
      </div>
      <Fold title="Energiefluss jetzt">
        <EnergyFlowDiagram
          pvPower={currentReading?.pv_power ?? null}
          consumption={currentReading?.consumption ?? null}
          batteryPower={currentReading?.battery_power ?? null}
          gridPower={currentReading?.power_io ?? 0}
          batterySoc={currentReading?.battery_soc ?? null}
        />
      </Fold>
      <Forecast kwp={settings.pv_capacity_kwp} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {thermostatRooms.map(r => (
          <RoomCard key={r.id} room={r} night={night} onChanged={updateRoomLocally} />
        ))}
      </div>
      {/* Heizleistung live, aktiviert/wartend, parallele Kapazität, Komfort-Budget (früher Heizung & KI) */}
      <RoomStatusTable rooms={rooms} />
    </div>
  );
}
