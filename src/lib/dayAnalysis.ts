// Tagesauswertung für den Tab "Analyse" (Stand 26.10.2026).
//
// Rechnet aus den 5-Minuten-Messwerten (energy_readings) und den Thermostat-Samples
// (room_temperature_samples, je Raum alle ~5 min, enthält is_heating) einen Tag durch.
// Reine Funktionen ohne Datenbankzugriff – das Laden macht useDayAnalysis.
//
// Fronius-Vorzeichen (verifiziert): power_io < 0 = Einspeisung, > 0 = Netzbezug;
// battery_power < 0 = Laden, > 0 = Entladen.
//
// Heizenergie ist eine SCHÄTZUNG: Raumleistung (getEffectiveHeatingPower) × Zeit mit is_heating.
// Zuverlässiger Heizstatus erst seit Treiber v1.3 (24.10.2026).
//
// Herkunft der Heizenergie je Intervall: zuerst Netzbezug, dann Batterie-Entladung, Rest Sonne.
// (Konservativ: Netz und Batterie werden der Heizung zuerst zugerechnet.)

import { Room, getEffectiveHeatingPower } from '@/types/room';

export const TZ = 'Europe/Vienna';
const MAX_GAP_MS = 15 * 60 * 1000;   // längere Lücken werden nicht überbrückt
const SAMPLE_MAX_AGE_MS = 15 * 60 * 1000;

export interface ReadingRow {
  timestamp: string;
  pv_power: number | null;
  consumption: number | null;
  power_io: number;
  battery_power: number | null;
  battery_soc: number | null;
}
export interface SampleRow {
  room_id: string;
  timestamp: string;
  temperature: number;
  is_heating: boolean;
}

// ---------------------------------------------------------------- Zeit (Wien)
function viennaParts(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24, min: g('minute'), s: g('second') };
}
function viennaOffsetMs(d: Date) {
  const v = viennaParts(d);
  return Date.UTC(v.y, v.m - 1, v.d, v.h, v.min, v.s) - Math.floor(d.getTime() / 1000) * 1000;
}
/** Beginn eines Wiener Kalendertags als Date (UTC-Zeitpunkt). */
export function viennaDayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let start = guess - viennaOffsetMs(new Date(guess));
  start = guess - viennaOffsetMs(new Date(start)); // DST-Kante
  return new Date(start);
}
export function viennaDateString(d: Date = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}
export function addDays(dateStr: string, n: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return t.toISOString().slice(0, 10);
}
/** Minuten seit Wiener Mitternacht. */
export function viennaMinutes(d: Date) {
  const v = viennaParts(d);
  return v.h * 60 + v.min;
}
const toMin = (hhmm: string | undefined | null, fb: string) => {
  const [h, m] = (hhmm || fb).split(':').map(Number);
  return h * 60 + (m || 0);
};
export function isNightMinute(min: number, nightStart?: string | null, nightEnd?: string | null) {
  const s = toMin(nightStart, '20:00');
  const e = toMin(nightEnd, '09:00');
  return s > e ? min >= s || min < e : min >= s && min < e;
}

// ---------------------------------------------------------------- Ergebnis
export interface RoomDay {
  id: string;
  name: string;
  powerW: number;
  heatMinutes: number;
  heatWh: number;
  sunWh: number;
  batteryWh: number;
  gridWh: number;
  segments: { from: number; to: number }[];   // Anteil am Tag 0..1
  comfortReachedAt: string | null;             // ISO
  minTemp: number | null;
  maxTemp: number | null;
  comfortTemp: number | null;
  samples: number;
}

export interface ChartPoint {
  t: number;            // Minuten seit Mitternacht
  label: string;        // HH:MM
  pv: number;           // W
  haus: number;         // W Eigenverbrauch Haus aus PV
  heizungSonne: number; // W
  batterieLaden: number;// W
  einspeisung: number;  // W
  netz: number;         // W Netzbezug
  verbrauch: number;    // W Gesamtverbrauch Haus (inkl. Heizung)
  soc: number | null;
  prognose: number | null; // W
}

export interface ColdExport {
  wh: number;
  minutes: number;
  rooms: string[];
  medianExportW: number;
  minColdRoomPowerW: number | null;
}

export interface DayAnalysis {
  date: string;
  complete: boolean;           // ganzer Tag vorbei
  coveredHours: number;        // Stunden mit Messwerten
  lastReading: string | null;
  pvWh: number;
  consumptionWh: number;
  exportWh: number;
  importWh: number;
  chargeWh: number;
  dischargeWh: number;
  selfConsumption: number | null;   // Anteil PV, der nicht eingespeist wurde
  autarky: number | null;           // Anteil Verbrauch, der nicht aus dem Netz kam
  heatWh: number;
  heatSunWh: number;
  heatBatteryWh: number;
  heatGridWh: number;
  heatGridNightWh: number;
  hausFromPvWh: number;
  socMin: number | null;
  socMinAt: string | null;
  socMax: number | null;
  socAtNightStart: number | null;
  rooms: RoomDay[];
  points: ChartPoint[];
  coldExport: ColdExport;
  forecastKwh: number | null;
  heatingDataReliable: boolean;     // Tag liegt nach v1.3 (24.10.2026)
}

const HEATING_RELIABLE_FROM = '2026-10-24';

/** Prognose-Stützstellen: Schlüssel "YYYY-MM-DD HH:MM:SS" in Ortszeit (Forecast.Solar, Rohwerte). */
function forecastCurve(hourly: Record<string, number> | null | undefined, forecastKwh: number | null | undefined) {
  if (!hourly) return null;
  const pts = Object.entries(hourly)
    .map(([k, w]) => ({ min: Number(k.slice(11, 13)) * 60 + Number(k.slice(14, 16)), w: Number(w) }))
    .filter((p) => Number.isFinite(p.min) && Number.isFinite(p.w))
    .sort((a, b) => a.min - b.min);
  if (pts.length < 2) return null;
  // Rohkurve auf die gespeicherte (saisonal korrigierte) Tagesprognose skalieren
  let rawWh = 0;
  for (let i = 1; i < pts.length; i++) rawWh += ((pts[i].w + pts[i - 1].w) / 2) * ((pts[i].min - pts[i - 1].min) / 60);
  const scale = forecastKwh && rawWh > 0 ? (forecastKwh * 1000) / rawWh : 1;
  return (minute: number): number => {
    if (minute <= pts[0].min || minute >= pts[pts.length - 1].min) return 0;
    for (let i = 1; i < pts.length; i++) {
      if (minute <= pts[i].min) {
        const a = pts[i - 1], b = pts[i];
        return (a.w + ((b.w - a.w) * (minute - a.min)) / (b.min - a.min)) * scale;
      }
    }
    return 0;
  };
}

export function analyzeDay(args: {
  date: string;
  readings: ReadingRow[];
  samples: SampleRow[];
  rooms: Room[];
  nightStart?: string | null;
  nightEnd?: string | null;
  forecastKwh?: number | null;
  forecastHourly?: Record<string, number> | null;
  now?: Date;
}): DayAnalysis {
  const { date, rooms, nightStart, nightEnd } = args;
  const now = args.now ?? new Date();
  const dayStart = viennaDayStart(date).getTime();
  const dayEnd = viennaDayStart(addDays(date, 1)).getTime();
  const dayLen = dayEnd - dayStart;

  const readings = [...args.readings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Samples je Raum, sortiert
  const byRoom = new Map<string, SampleRow[]>();
  for (const s of args.samples) {
    if (!byRoom.has(s.room_id)) byRoom.set(s.room_id, []);
    byRoom.get(s.room_id)!.push(s);
  }
  for (const list of byRoom.values()) list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const ptr = new Map<string, number>();

  const ctrlRooms = rooms.filter((r) => r.id && r.tuya_device_id);
  const roomDays = new Map<string, RoomDay>();
  for (const r of ctrlRooms) {
    roomDays.set(r.id!, {
      id: r.id!, name: r.name, powerW: getEffectiveHeatingPower(r),
      heatMinutes: 0, heatWh: 0, sunWh: 0, batteryWh: 0, gridWh: 0, segments: [],
      comfortReachedAt: null, minTemp: null, maxTemp: null,
      comfortTemp: r.comfort_temp ?? null, samples: (byRoom.get(r.id!) ?? []).length,
    });
  }
  // Komfort erreicht / min / max direkt aus den Samples
  for (const r of ctrlRooms) {
    const rd = roomDays.get(r.id!)!;
    for (const s of byRoom.get(r.id!) ?? []) {
      const t = Number(s.temperature);
      rd.minTemp = rd.minTemp == null ? t : Math.min(rd.minTemp, t);
      rd.maxTemp = rd.maxTemp == null ? t : Math.max(rd.maxTemp, t);
      if (!rd.comfortReachedAt && rd.comfortTemp != null && t >= rd.comfortTemp - 0.1) rd.comfortReachedAt = s.timestamp;
    }
  }

  /** letzter Sample-Zustand eines Raums zum Zeitpunkt t (oder null, wenn zu alt) */
  const stateAt = (roomId: string, t: number): SampleRow | null => {
    const list = byRoom.get(roomId);
    if (!list || list.length === 0) return null;
    let i = ptr.get(roomId) ?? -1;
    while (i + 1 < list.length && new Date(list[i + 1].timestamp).getTime() <= t) i++;
    ptr.set(roomId, i);
    if (i < 0) return null;
    const s = list[i];
    return t - new Date(s.timestamp).getTime() <= SAMPLE_MAX_AGE_MS ? s : null;
  };

  let pvWh = 0, consWh = 0, expWh = 0, impWh = 0, chgWh = 0, disWh = 0;
  let heatWh = 0, heatSunWh = 0, heatBatWh = 0, heatGridWh = 0, heatGridNightWh = 0, hausPvWh = 0;
  let socMin: number | null = null, socMinAt: string | null = null, socMax: number | null = null;
  let socAtNightStart: number | null = null;
  let coveredMs = 0;
  const nightStartMin = toMin(nightStart, '20:00');

  const cold = { wh: 0, ms: 0, rooms: new Set<string>(), exports: [] as number[], minPower: null as number | null };
  const points: ChartPoint[] = [];
  const fc = forecastCurve(args.forecastHourly, args.forecastKwh);

  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const t = new Date(r.timestamp).getTime();
    if (t < dayStart || t >= dayEnd) continue;
    const next = i + 1 < readings.length ? new Date(readings[i + 1].timestamp).getTime() : Math.min(t + 5 * 60000, dayEnd);
    const dt = Math.min(Math.max(0, next - t), MAX_GAP_MS, dayEnd - t);
    const h = dt / 3600000;
    coveredMs += dt;

    const pv = Math.max(0, Number(r.pv_power ?? 0));
    const cons = Math.max(0, Number(r.consumption ?? 0));
    const io = Number(r.power_io ?? 0);
    const exp = io < 0 ? -io : 0;
    const imp = io > 0 ? io : 0;
    const bp = Number(r.battery_power ?? 0);
    const chg = bp < 0 ? -bp : 0;
    const dis = bp > 0 ? bp : 0;
    const soc = r.battery_soc != null ? Number(r.battery_soc) : null;

    // Heizleistung aller Räume in diesem Intervall
    let heatW = 0;
    const heatingNow: string[] = [];
    const coldNow: { name: string; power: number }[] = [];
    for (const room of ctrlRooms) {
      const st = stateAt(room.id!, t);
      const rd = roomDays.get(room.id!)!;
      if (st?.is_heating) {
        heatW += rd.powerW;
        heatingNow.push(room.id!);
        rd.heatMinutes += dt / 60000;
        const f0 = (t - dayStart) / dayLen, f1 = (t + dt - dayStart) / dayLen;
        const last = rd.segments[rd.segments.length - 1];
        if (last && Math.abs(last.to - f0) < 0.0001) last.to = f1; else rd.segments.push({ from: f0, to: f1 });
      } else if (
        st && room.automation_enabled && room.pv_auto_enabled && rd.comfortTemp != null &&
        Number(st.temperature) < rd.comfortTemp - 0.3 &&
        !(rd.comfortReachedAt && new Date(rd.comfortReachedAt).getTime() <= t) // Estrich-Sättigung: bewusst auf Eco
      ) {
        coldNow.push({ name: room.name, power: rd.powerW });
      }
    }
    // Herkunft: Netz zuerst, dann Batterie, Rest Sonne
    const gridW = Math.min(heatW, imp);
    const batW = Math.min(heatW - gridW, dis);
    const sunW = Math.max(0, heatW - gridW - batW);
    // Raumweise anteilig verteilen
    if (heatW > 0) {
      for (const id of heatingNow) {
        const rd = roomDays.get(id)!;
        const share = rd.powerW / heatW;
        rd.heatWh += rd.powerW * h;
        rd.sunWh += sunW * share * h;
        rd.batteryWh += batW * share * h;
        rd.gridWh += gridW * share * h;
      }
    }

    const minute = Math.floor((t - dayStart) / 60000);
    const night = isNightMinute(minute, nightStart, nightEnd);

    pvWh += pv * h; consWh += cons * h; expWh += exp * h; impWh += imp * h; chgWh += chg * h; disWh += dis * h;
    heatWh += heatW * h; heatSunWh += sunW * h; heatBatWh += batW * h; heatGridWh += gridW * h;
    if (night) heatGridNightWh += gridW * h;

    // PV-Verwendung: Einspeisung und Laden zuerst abziehen, Rest Eigenverbrauch (Heizung-Sonne, sonst Haus)
    const pvSelf = Math.max(0, pv - exp - chg);
    const heatFromPv = Math.min(sunW, pvSelf);
    const hausPv = Math.max(0, pvSelf - heatFromPv);
    hausPvWh += hausPv * h;

    if (soc != null) {
      if (socMin == null || soc < socMin) { socMin = soc; socMinAt = r.timestamp; }
      if (socMax == null || soc > socMax) socMax = soc;
      if (socAtNightStart == null && minute >= nightStartMin) socAtNightStart = soc;
    }

    // Einspeisung, während Räume unter Komfort warten
    if (exp >= 500 && coldNow.length > 0) {
      cold.wh += exp * h;
      cold.ms += dt;
      cold.exports.push(exp);
      for (const c of coldNow) {
        cold.rooms.add(c.name);
        cold.minPower = cold.minPower == null ? c.power : Math.min(cold.minPower, c.power);
      }
    }

    points.push({
      t: minute,
      label: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
      pv: Math.round(pv),
      haus: Math.round(hausPv),
      heizungSonne: Math.round(heatFromPv),
      batterieLaden: Math.round(Math.min(chg, pv)),
      einspeisung: Math.round(Math.min(exp, pv)),
      netz: Math.round(imp),
      verbrauch: Math.round(cons),
      soc,
      prognose: fc ? Math.round(fc(minute)) : null,
    });
  }

  const sorted = [...cold.exports].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  return {
    date,
    complete: now.getTime() >= dayEnd,
    coveredHours: coveredMs / 3600000,
    lastReading: readings.length ? readings[readings.length - 1].timestamp : null,
    pvWh, consumptionWh: consWh, exportWh: expWh, importWh: impWh, chargeWh: chgWh, dischargeWh: disWh,
    selfConsumption: pvWh > 0 ? Math.max(0, 1 - expWh / pvWh) : null,
    autarky: consWh > 0 ? Math.max(0, 1 - impWh / consWh) : null,
    heatWh, heatSunWh, heatBatteryWh: heatBatWh, heatGridWh, heatGridNightWh,
    hausFromPvWh: hausPvWh,
    socMin, socMinAt, socMax, socAtNightStart,
    rooms: [...roomDays.values()].sort((a, b) => b.heatWh - a.heatWh),
    points,
    coldExport: {
      wh: cold.wh, minutes: cold.ms / 60000, rooms: [...cold.rooms],
      medianExportW: Math.round(median), minColdRoomPowerW: cold.minPower,
    },
    forecastKwh: args.forecastKwh ?? null,
    heatingDataReliable: date >= HEATING_RELIABLE_FROM,
  };
}
