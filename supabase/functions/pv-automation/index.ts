import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_PV_SURPLUS_THRESHOLD_ON = 500;
const DEFAULT_PV_SURPLUS_THRESHOLD_OFF = 200;
const DEFAULT_MIN_SWITCH_INTERVAL_MIN = 25; // Reaktive Strategie: 25min Mindest-Heizdauer pro Raum, verhindert Ping-Pong

// ============= TOKEN CACHING =============
// Cache token in memory (reused across invocations within same instance)
let cachedToken: string | null = null;
let tokenExpiry: number = 0;
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

// Helper: Check if current time is within night hours (Europe/Vienna timezone!)
function isNightTime(nightStartTime: string, nightEndTime: string): { isNight: boolean; wienTime: string; wienHour: number } {
  const now = new Date();
  
  // WICHTIG: Wien-Zeit verwenden, nicht UTC!
  const wienFormatter = new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const wienTime = wienFormatter.format(now);
  const [wienHour, wienMinute] = wienTime.split(':').map(Number);
  const currentMinutes = wienHour * 60 + wienMinute;
  
  const [startH, startM] = (nightStartTime || '22:00').split(':').map(Number);
  const [endH, endM] = (nightEndTime || '06:00').split(':').map(Number);
  
  const nightStart = startH * 60 + startM;
  const nightEnd = endH * 60 + endM;
  
  let isNight: boolean;
  // Case: Night spans midnight (e.g., 22:00-06:00)
  if (nightStart > nightEnd) {
    isNight = currentMinutes >= nightStart || currentMinutes < nightEnd;
  } else {
    // Case: Night within same day (e.g., 00:00-06:00)
    isNight = currentMinutes >= nightStart && currentMinutes < nightEnd;
  }
  
  return { isNight, wienTime, wienHour };
}

// Helper: Robustes Parsen von "HH:MM" oder "HH:MM:SS"
function parseTimeOfDay(s: string | undefined | null, fallback = '08:00'): { hour: number; minute: number } {
  const src = (s && typeof s === 'string' && s.length >= 4) ? s : fallback;
  const parts = src.split(':');
  const hour = Math.max(0, Math.min(23, parseInt(parts[0], 10) || 0));
  const minute = Math.max(0, Math.min(59, parseInt(parts[1], 10) || 0));
  return { hour, minute };
}

// Helper: Tagstart-Stunde (aus settings.night_end_time, Default 08:00)
function getDayStartHour(settings: any): number {
  return parseTimeOfDay(settings?.night_end_time, '08:00').hour;
}
function getDayStartMinute(settings: any): number {
  return parseTimeOfDay(settings?.night_end_time, '08:00').minute;
}
function formatDayStart(settings: any): string {
  const h = getDayStartHour(settings);
  const m = getDayStartMinute(settings);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Mindesttemperatur ohne PV je Raum (rooms.wait_min_temp, Konzept 27.10.2026 §3.1).
// Ziel am Wartetag, beim Batterie-Gate und für Räume ohne Budget. Fallback: Eco − 1,5 °C.
function getWaitMinTemp(room: any, settings: any): number {
  const w = Number(room?.wait_min_temp);
  if (Number.isFinite(w) && w > 0) return w;
  const eco = Number(room?.eco_temp) || Number(settings?.eco_temp) || 19;
  return Math.max(5, eco - 1.5);
}

// Anwesenheit (Konzept 28.10.2026, umgedreht 01.11.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md §9).
// Grundzustand ANWESEND. Kalender presence_periods = Zeiträume, in denen das Haus LEER ist (Abwesenheit).
// "Anwesend" beginnt schon presence_lead_hours vor end_at (Vorlauf vor der Rückkehr).
// Fail-safe: Ausgeschaltet, Tabelle fehlt oder Lesefehler → anwesend.
type PresenceInfo = { away: boolean; reason: string; until: string | null; nextStart: string | null };
async function getPresence(supabase: any, settings: any): Promise<PresenceInfo> {
  if (settings?.presence_control_enabled === false) {
    return { away: false, reason: 'Anwesenheit-Steuerung aus', until: null, nextStart: null };
  }
  const leadH = Math.max(0, Math.min(72, Number(settings?.presence_lead_hours ?? 6) || 0));
  const now = Date.now();
  try {
    const { data, error } = await supabase
      .from('presence_periods')
      .select('start_at, end_at')
      .gt('end_at', new Date(now).toISOString())
      .order('start_at', { ascending: true })
      .limit(50);
    if (error) throw error;
    const rows = (data || []) as Array<{ start_at: string; end_at: string }>;
    const running = rows.filter(r => new Date(r.start_at).getTime() <= now);
    const away = running.filter(r => new Date(r.end_at).getTime() - leadH * 3600_000 > now);
    const next = rows.find(r => new Date(r.start_at).getTime() > now);
    if (away.length > 0) {
      const until = away.map(r => r.end_at).sort().slice(-1)[0];
      return { away: true, reason: `abwesend laut Kalender bis ${until}`, until, nextStart: null };
    }
    if (running.length > 0) {
      return { away: false, reason: `Vorlauf (Rückkehr ${running[0].end_at})`, until: null, nextStart: next?.start_at ?? null };
    }
    return { away: false, reason: 'anwesend (keine Abwesenheit eingetragen)', until: null, nextStart: next?.start_at ?? null };
  } catch (e) {
    console.warn('[ANWESENHEIT] presence_periods nicht lesbar → anwesend (fail-safe):', e);
    return { away: false, reason: 'Kalender nicht lesbar → anwesend', until: null, nextStart: null };
  }
}

// ============= LEISTUNGSGRENZE GILT IMMER (06.11.2026, doc/FIX-HEIZLEISTUNG-2026-11-06.md) =============
// Uli 06.11.2026: „Grenze gilt immer“. Räume unter ihrer Untergrenze (Tag) bzw. unter ihrem Nachtwert
// (Nacht) heizen nach Priorität, aber nur solange die Summe der Raumleistungen unter der Grenze bleibt.
// Ausnahme: Ein Raum, der allein schon größer ist als die Grenze (Wohnzimmer 5,5 kW), darf heizen,
// wenn gerade kein anderer Raum heizt – dann heizt er allein.
// Wer länger als cap_wait_boost_min wartet, kommt beim nächsten Lauf zuerst dran (sonst käme ein
// großer Raum mit niedriger Priorität nie zum Zug).
// Räume, die gerade noch nachlaufen (Thermostat heizt über den Sollwert hinaus), werden mitgezählt.

// Schaltband der TGP508 (Befund 09.11.2026, doc/FIX-VORRANG-UND-SCHALTBAND-2026-11-09.md): Das Thermostat schaltet
// AN bei Ist ≤ Soll − Band und AUS bei Ist ≥ Soll + Band; Band = DP 101 × 0,1 °C (eingestellt 1,0 °C).
// Folgen: „Ist − 0,5 °C“ hält ein laufendes Thermostat NICHT an, und ein Raum innerhalb des Bandes springt
// trotz Soll = Ziel nicht an. Band je Raum aus thermostat_state.dp101 (room._band), sonst 1,0 °C.
const bandOf = (room: any): number => {
  const b = Number(room?._band);
  return Number.isFinite(b) && b > 0 ? b : 1.0;
};

/** Sollwert, bei dem ein wartender Raum sicher nicht heizt – auch ein laufendes Thermostat schaltet ab:
 *  abgerundet Ist − Band − 0,5 °C, nie über dem Ziel. (Vor 09.11.2026: Ist − 0,5 °C – stoppte nichts.) */
function holdBelow(cur: number, want: number, band = 1.0): number {
  return Math.min(want, Math.max(5, Math.floor((cur - band - 0.5) * 2) / 2));
}

/** Anstoß: Ein Raum hat Leistung bekommen, liegt unter seinem Ziel, heizt aber nicht, weil er im Schaltband
 *  liegt (Ist > Ziel − Band). Dann Soll so weit anheben, dass das Thermostat sicher einschaltet
 *  (aufgerundet Ist + Band + 0,2 °C), höchstens maxT. Sonst das Ziel selbst. */
function startTarget(cur: number, want: number, band: number, isHeating: boolean, maxT: number): { temp: number; anstoss: boolean } {
  if (isHeating || cur <= 0 || cur >= want || cur <= want - band) return { temp: want, anstoss: false };
  const t = Math.min(maxT, Math.ceil((cur + band + 0.2) * 2) / 2);
  return t > want ? { temp: t, anstoss: true } : { temp: want, anstoss: false };
}

type CapCand = { id: string; name: string; power: number; prio: number; heating?: boolean };
type CapResult = { granted: Set<string>; waiting: Set<string>; usedW: number; alone: string | null; kept: Set<string>; reserviert: boolean };

// Wer heizt, heizt fertig (09.11.2026, doc/FIX-VORRANG-BEHALTEN-2026-11-09.md): Ein Raum, der im letzten Lauf
// Leistung bekommen hat und noch unter seinem Ziel liegt, behält sie – vor Wartezeit-Vorrang und Priorität.
// Vorher fiel ein Raum nach einem Lauf „heizt allein“ aus dem Wartezustand, verlor den Vorrang und wartete
// wieder 60 min (Wohnzimmer 09.11.: sechsmal, ~95 min Heizzeit am Tag, Untergrenze nie erreicht).
// Behalten nur, solange der Raum wirklich heizt (DP 5) – nach der Zuteilung hat er cap_keep_start_min (15 min)
// Zeit zum Anlaufen. Wer zugeteilt ist, aber nicht heizt, behält nichts und blockiert die Grenze nicht.
// Höchstens cap_keep_max_min (Standard 120 min) am Stück, dann zählt wieder Vorrang/Priorität.

/** Reine Funktion: teilt die Leistung unter capW zu – zuerst wer schon heizt (behalten), dann Wartezeit-Vorrang,
 *  dann Priorität. grantedSince: seit wann ein Raum Leistung hat (aus dem letzten Lauf). */
function allocateUnderCap(
  cands: CapCand[],
  capW: number,
  startUsedW: number,
  waitSince: Record<string, string>,
  boostMin: number,
  nowMs: number,
  grantedSince: Record<string, string> = {},
  keepMaxMin = 120,
  keepStartMin = 15,
): CapResult {
  const boosted = (c: CapCand) => {
    const s = waitSince[c.id];
    return s && boostMin > 0 && nowMs - new Date(s).getTime() >= boostMin * 60_000 ? new Date(s).getTime() : null;
  };
  const keeps = (c: CapCand) => {
    const s = grantedSince[c.id];
    if (!s || keepMaxMin <= 0) return null;
    const age = nowMs - new Date(s).getTime();
    if (age >= keepMaxMin * 60_000) return null;
    return c.heating === true || age < keepStartMin * 60_000 ? new Date(s).getTime() : null;
  };
  const ordered = [...cands].sort((a, b) => {
    const ka = keeps(a), kb = keeps(b);
    if (ka !== null && kb !== null) return ka - kb;   // wer schon länger heizt zuerst
    if (ka !== null) return -1;
    if (kb !== null) return 1;
    const ba = boosted(a), bb = boosted(b);
    if (ba !== null && bb !== null) return ba - bb;   // am längsten wartend zuerst
    if (ba !== null) return -1;
    if (bb !== null) return 1;
    return a.prio - b.prio;
  });
  const kept = new Set<string>(ordered.filter((c) => keeps(c) !== null).map((c) => c.id));
  const granted = new Set<string>();
  const waiting = new Set<string>();
  let usedW = startUsedW;
  let alone: string | null = null;
  // Reservierung: Ein Raum mit Wartezeit-Vorrang, der gerade nicht passt (z. B. Wohnzimmer 5,5 kW > Grenze),
  // sperrt neue Zuteilungen an andere. Wer schon heizt, heizt fertig; danach wird die Grenze frei und der Raum
  // heizt allein. Ohne Sperre füllten kleine Räume die Grenze immer wieder auf (Nachrechnung 09.11.2026).
  let reserviert = false;
  for (const c of ordered) {
    const isKept = kept.has(c.id);
    if (reserviert && !isKept) { waiting.add(c.id); continue; }
    if (usedW + c.power <= capW) {
      usedW += c.power; granted.add(c.id);
    } else if (granted.size === 0 && (usedW === 0
      || (c.power > capW && (isKept || boosted(c) !== null)))) {
      // größer als die Grenze, aber sonst heizt niemand → allein.
      // Seit 10.11.2026 (B): auch wenn nur noch Nachlauf läuft (kein Raum hat Leistung zugeteilt) – aber NUR für
      // einen Raum, der größer als die Grenze ist, und nur wenn er schon heizt (Vorrang: wer heizt, heizt bis Ziel)
      // oder die Vorrang-Wartezeit hinter sich hat. Vorher blockierte ein einziges nachlaufendes Thermostat
      // (Toilette Eingang, 100 W) über Stunden alle Räume. Korrektur 10.11. 16:05 (B2): Die erste Fassung ließ auch
      // Räume unter der Grenze „allein“ heizen (Zimmer Uli 2000 W + 2050 W Nachlauf) und nahm dem schon heizenden
      // Wohnzimmer nach einer Runde die Leistung wieder weg, weil es nicht mehr als wartend zählte.
      usedW += c.power; granted.add(c.id); alone = c.id;
    } else {
      waiting.add(c.id);
      if (!isKept && keepMaxMin > 0 && boosted(c) !== null) reserviert = true;
    }
  }
  for (const id of [...kept]) if (!granted.has(id)) kept.delete(id);
  return { granted, waiting, usedW, alone, kept, reserviert };
}

/** Wartezustand fortschreiben: neue Wartende mit „jetzt“, wer nicht mehr wartet, fällt raus. */
function nextWaitState(prev: Record<string, string>, waiting: Set<string>, nowIso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of waiting) out[id] = prev[id] ?? nowIso;
  return out;
}

/** Zuteilungszustand fortschreiben: wer Leistung hat, behält sein „seit“; wer keine mehr hat, fällt raus. */
function nextGrantState(prev: Record<string, string>, granted: Set<string>, nowIso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of granted) out[id] = prev[id] ?? nowIso;
  return out;
}

type CapState = { rooms: Record<string, string>; granted: Record<string, string> };

async function loadWaitState(supabase: any): Promise<CapState> {
  try {
    const { data } = await supabase.from('system_settings').select('value').eq('key', 'cap_wait_state').maybeSingle();
    const v = data?.value as { rooms?: Record<string, string>; granted?: Record<string, string> } | null;
    return { rooms: v?.rooms ?? {}, granted: v?.granted ?? {} };
  } catch { return { rooms: {}, granted: {} }; }
}
async function saveWaitState(supabase: any, rooms: Record<string, string>, granted: Record<string, string>, phase: 'tag' | 'nacht') {
  try {
    await supabase.from('system_settings').upsert({
      key: 'cap_wait_state',
      value: { rooms, granted, phase, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  } catch (e) { console.log(`[GRENZE] Wartezustand nicht gespeichert: ${e}`); }
}

// Gemessene/eingetragene Leistung (heating_power_w, Messung 06.11.) vor der alten Schätzung calculated_power_w (10.11.2026)
const roomPowerW = (room: any) => Number(room?.heating_power_w) || Number(room?.calculated_power_w) || 800;

// Nicht steuerbar (10.11.2026, C, doc/FIX-REGELN-A-B-C-2026-11-10.md): SQL 30 setzt rooms.nicht_steuerbar_seit, wenn
// ≥ 4 ausgeführte Befehle den Sollwert am Gerät nicht geändert haben. Solche Räume bekommen keine Befehle mehr –
// außer einem Prüfbefehl pro Stunde: Wirkt er (Gerät repariert), löscht SQL 30 die Markierung von selbst.
async function probeDueIds(supabase: any, rooms: any[]): Promise<Set<string>> {
  const flagged = rooms.filter((r: any) => !!r.nicht_steuerbar_seit);
  const due = new Set<string>();
  if (flagged.length === 0) return due;
  try {
    const { data } = await supabase.from('thermostat_commands').select('room_id, created_at')
      .in('room_id', flagged.map((r: any) => r.id))
      .gte('created_at', new Date(Date.now() - 60 * 60_000).toISOString());
    const recent = new Set(((data ?? []) as any[]).map((c) => c.room_id));
    for (const r of flagged) if (!recent.has(r.id)) due.add(r.id);
  } catch (e) { console.log(`[NICHT-STEUERBAR] Prüfbefehl-Abfrage fehlgeschlagen → kein Prüfbefehl: ${e}`); }
  return due;
}

/** Schaltband je Raum aus thermostat_state.dp101 (×0,1 °C) an die Raumobjekte hängen (room._band). */
async function attachBands(supabase: any, rooms: any[]): Promise<void> {
  try {
    const { data } = await supabase.from('thermostat_state').select('room_id, dp101');
    const m = new Map<string, number>(((data ?? []) as any[]).filter((x) => x.dp101 != null).map((x) => [x.room_id, Number(x.dp101) / 10]));
    for (const r of rooms) { const b = m.get(r.id); if (b && b > 0) r._band = b; }
  } catch (e) { console.log(`[SCHALTBAND] thermostat_state nicht lesbar → Band 1,0 °C: ${e}`); }
}

// ============= HEIZPLANER STEUERT (13.11.2026, doc/FIX-PLANER-MODELL-2026-11-13.md) =============
// Modus „steuern“ (heating_settings.planer_modus): Der Heizplaner (alle 15 min) entscheidet je Raum und halbe Stunde,
// ob geheizt wird. Diese Funktion setzt das in Sollwerte um. Das Regelwerk (Tagesmodus, Budgets, Nacht-Verteilung)
// bleibt nur Rückfall, wenn der Plan älter als PLAN_MAX_ALTER_MIN ist oder ein Raum im Plan fehlt.
// Sicherheit bleibt immer: manuell übersteuert, Automatik aus, Fühler in der Sonne, nicht steuerbar (werden vorher
// aussortiert), nie unter Untergrenze − Sicherheitsabstand, nie über Komfort + 0,3 °C.
const PLAN_MAX_ALTER_MIN = 30;
type PlanEintrag = { heizt: boolean; ziel: number; unter: number };
type PlanStand = { map: Map<string, PlanEintrag> | null; grund: string };

async function ladePlanerPlan(supabase: any, settings: any): Promise<PlanStand> {
  if ((settings?.planer_modus ?? 'schatten') !== 'steuern') return { map: null, grund: `Planer-Modus ${settings?.planer_modus ?? 'schatten'}` };
  try {
    const { data } = await supabase.from('heizplan').select('erstellt_at, plan').order('erstellt_at', { ascending: false }).limit(1).maybeSingle();
    if (!data?.plan) return { map: null, grund: 'kein Plan vorhanden → Regelwerk' };
    const alterMin = (Date.now() - new Date(data.erstellt_at).getTime()) / 60_000;
    if (alterMin > PLAN_MAX_ALTER_MIN) return { map: null, grund: `Plan ${Math.round(alterMin)} min alt (> ${PLAN_MAX_ALTER_MIN}) → Regelwerk` };
    const idx = Math.floor((Date.now() / 1000 - Number(data.plan.start)) / 900);
    if (!(idx >= 0 && idx < 96)) return { map: null, grund: `Plan passt nicht zur Uhrzeit (Slot ${idx}) → Regelwerk` };
    const map = new Map<string, PlanEintrag>();
    for (const r of (data.plan.raeume ?? []) as any[]) {
      const h = String(r.h ?? '');
      if (h.length <= idx) continue;
      if (r.m2 === false) continue;   // Raummodell noch nicht neu gelernt → Regelwerk für diesen Raum
      map.set(r.id, { heizt: h[idx] === '1', ziel: Number(r.ziel?.[idx]), unter: Number(r.unter) });
    }
    return { map, grund: `Plan von ${new Date(data.erstellt_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })}` };
  } catch (e) {
    return { map: null, grund: `Plan nicht lesbar (${e}) → Regelwerk` };
  }
}

/** Reine Funktion: Sollwert für einen Raum nach dem Plan. Thermostat-Schaltband beachten (an bei Ist ≤ Soll − Band,
 *  aus bei Ist ≥ Soll + Band). Wo der jetzige Sollwert schon das Richtige bewirkt, bleibt er (keine unnötigen Befehle). */
function planerSollwert(room: any, e: PlanEintrag, settings: any): { temp: number; why: string; heizt: boolean } {
  const cur = Number(room.current_temp) || 0;
  const soll = Number(room.target_temp) || 0;
  const band = bandOf(room);
  const komfort = Number(room.comfort_temp) || (Number.isFinite(e.ziel) ? e.ziel + 1 : 22);
  const abst = Math.max(0, Number(settings?.planer_sicherheit_abstand ?? 1.5));
  const ziel = Number.isFinite(e.ziel) ? e.ziel : komfort;
  const sicher = Number.isFinite(e.unter) ? e.unter - abst : -Infinity;
  const notfall = cur > 0 && cur < sicher;
  if (cur > 0 && cur >= komfort + 0.3) {
    return { temp: holdBelow(cur, 99, band), heizt: false, why: `Planer: über Komfort (${cur.toFixed(1)} ≥ ${komfort} + 0,3 °C) → Thermostat aus` };
  }
  if (e.heizt || notfall) {
    const grund = notfall ? `Sicherheit: unter Untergrenze − ${abst} °C (${cur.toFixed(1)} < ${sicher.toFixed(1)} °C) → heizt`
                          : `Planer: heizen (Ziel ${ziel} °C, Ist ${cur.toFixed(1)} °C)`;
    if (room.is_heating === true && soll > 0 && soll >= cur - band + 0.1 && soll <= komfort + band) {
      return { temp: soll, heizt: true, why: `${grund}, läuft` };
    }
    const an = Math.min(komfort + band, Math.max(ziel, Math.ceil((cur + band + 0.2) * 2) / 2));
    return { temp: an, heizt: true, why: `${grund} → ${an} °C (schaltet sicher ein, Schaltband ±${band} °C)` };
  }
  if (room.is_heating !== true && soll > 0 && soll <= cur - 0.3) {
    return { temp: soll, heizt: false, why: `Planer: nicht heizen (Ist ${cur.toFixed(1)} °C, Ziel ${ziel} °C)` };
  }
  const aus = holdBelow(cur, 99, band);
  return { temp: aus, heizt: false, why: `Planer: nicht heizen → ${aus} °C (Thermostat aus)` };
}

// Tagesmodus-Zuteilung (Konzept 27.10.2026 §2/§3). Reine Funktion, testbar.
// rooms: Räume OHNE Budget, nach Priorität sortiert.
// Schritt 0: Räume, die noch nachlaufen (heizen, obwohl schon über dem Ziel), zählen zur Leistung.
// Pass 1: Räume unter Untergrenze → bis Untergrenze heizen, nach Priorität UNTER der Grenze maxGridW
//         (seit 06.11.2026 wieder begrenzt, „Grenze gilt immer“; ein Raum über der Grenze heizt allein).
//         Wer nicht mehr passt, wartet mit „Ist − Band − 0,5 °C“ (Thermostat schaltet sicher ab) und kommt nach
//         cap_wait_boost_min zuerst dran. Wer Leistung hat und heizt, behält sie bis zum Ziel (09.11.2026).
//         Liegt ein zugeteilter Raum im Schaltband und heizt nicht, bekommt er einen Anstoß (Soll über Ist + Band).
// Pass 2 (nur 'grid'): Eco nach Priorität, nur solange unter maxGridW noch Leistung frei ist;
//         warme Räume halten Eco.
function allocateDayTargets(
  rooms: Array<{ room: any; heatingPower: number }>,
  settings: any,
  dayMode: 'wait' | 'grid' | 'battery_gate' | 'evening',
  maxGridW: number,
  modeText: string,
  waitSince: Record<string, string> = {},
  nowMs: number = Date.now(),
  grantedSince: Record<string, string> = {},
): { targets: Map<string, { temp: number; why: string }>; gridUsedW: number; waiting: Set<string>; capGranted: Set<string> } {
  const targets = new Map<string, { temp: number; why: string }>();
  // Batterie-Schutz (Konzept Tagesablauf §3.4, Raummodell §3.2): Ziel ist
  // „Untergrenze − battery_gate_floor_delta“ (seit 02.11.2026 Abstand 0 → Untergrenze).
  const gateDelta = Math.max(0, Number(settings?.battery_gate_floor_delta ?? 0));
  const boostMin = Math.max(0, Number(settings?.cap_wait_boost_min ?? 60));
  const keepMaxMin = Math.max(0, Number(settings?.cap_keep_max_min ?? 120));
  const comfortOf = (rp: { room: any }) => Number(rp.room.comfort_temp) || Number(settings?.comfort_temp) || 22;
  // Abschalten, sobald ein heizender Raum sein Ziel um so viel überschritten hat (statt Ziel + Band, 09.11.2026)
  const stopMargin = Math.max(0, Number(settings?.ziel_abschalt_ueber_c ?? 0.3));
  // Anstoß und Abschalten am Ziel brauchen zusätzliche Befehle – nur im Lokal-Modus (Cloud: 30 Aufrufe/Tag)
  const fein = settings?._lokal !== false;
  // Abend (seit 06.11.2026): ab Sonnenuntergang gilt die Nachtlogik – Ziel = max(Nachtwert, Untergrenze), kein Eco.
  const nightOf = (rp: { room: any }) => Math.max(Number(rp.room.night_temp) || Number(settings?.night_temp) || 17, getWaitMinTemp(rp.room, settings));
  const floorOf = (rp: { room: any }) => dayMode === 'battery_gate'
    ? Math.max(5, getWaitMinTemp(rp.room, settings) - gateDelta)
    : dayMode === 'evening' ? nightOf(rp)
    : getWaitMinTemp(rp.room, settings);
  const floorName = dayMode === 'evening' ? 'Nachtwert' : 'Untergrenze';
  const ecoOf = (rp: { room: any }) => Number(rp.room.eco_temp) || Number(settings?.eco_temp) || 19;
  const curOf = (rp: { room: any }) => Number(rp.room.current_temp) || 0;

  // Schritt 0: Nachlauf mitzählen (Thermostat heizt noch, Raum liegt schon über seinem Ziel)
  // Räume außerhalb der Steuerung, die trotzdem heizen (nicht steuerbar, Fühler in der Sonne), zählen zur Leistung (10.11.2026)
  let startUsed = Math.max(0, Number(settings?._extraUsedW) || 0);
  const nachlauf = new Set<string>();
  for (const rp of rooms) {
    const cur = curOf(rp);
    const ziel = dayMode === 'grid' ? Math.max(floorOf(rp), ecoOf(rp)) : floorOf(rp);
    if (rp.room.is_heating === true && cur > 0 && cur >= ziel) { startUsed += rp.heatingPower; nachlauf.add(rp.room.id); }
  }

  // Pass 1: unter Untergrenze
  const under = rooms.filter(rp => { const c = curOf(rp); return c > 0 && c < floorOf(rp); });
  const cap = allocateUnderCap(
    under.map(rp => ({ id: rp.room.id, name: rp.room.name, power: rp.heatingPower, prio: Number(rp.room.priority) || 99,
                       heating: rp.room.is_heating === true })),
    maxGridW, startUsed, waitSince, boostMin, nowMs, grantedSince, keepMaxMin,
  );
  let gridUsedW = cap.usedW;
  const granted = new Set<string>(cap.granted);

  for (const rp of rooms) {
    const waitT = floorOf(rp);
    const cur = curOf(rp);
    if (cap.granted.has(rp.room.id)) {
      const allein = cap.alone === rp.room.id ? ` – größer als die Grenze ${maxGridW} W, heizt allein` : '';
      const behalten = cap.kept.has(rp.room.id) ? ', behält Leistung bis Ziel' : '';
      const st = fein ? startTarget(cur, waitT, bandOf(rp.room), rp.room.is_heating === true, Math.max(waitT, comfortOf(rp)))
                      : { temp: waitT, anstoss: false };
      targets.set(rp.room.id, { temp: st.temp,
        why: `unter ${floorName} (${cur.toFixed(1)} < ${waitT} °C) → heizt bis ${floorName}, ${cap.usedW}/${maxGridW} W${allein}${behalten}`
          + (st.anstoss ? ` – Anstoß ${st.temp} °C (im Schaltband ±${bandOf(rp.room)} °C, sonst schaltet das Thermostat nicht ein)` : '') });
    } else if (cap.waiting.has(rp.room.id)) {
      const seit = waitSince[rp.room.id] ? ` seit ${new Date(waitSince[rp.room.id]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })}` : '';
      targets.set(rp.room.id, { temp: holdBelow(cur, waitT, bandOf(rp.room)),
        why: `unter ${floorName} (${cur.toFixed(1)} < ${waitT} °C), Grenze ${maxGridW} W belegt (${cap.usedW} W) → wartet${seit}` });
    } else if (fein && rp.room.is_heating === true && cur > 0 && cur >= waitT + stopMargin) {
      // Ziel erreicht, Thermostat läuft noch: abschalten – sonst heizt es bis Ziel + Band (09.11.2026)
      targets.set(rp.room.id, { temp: holdBelow(cur, waitT, bandOf(rp.room)),
        why: `${floorName} erreicht (${cur.toFixed(1)} ≥ ${waitT} + ${stopMargin} °C) → Thermostat aus (würde sonst bis ${(waitT + bandOf(rp.room)).toFixed(1)} °C heizen)` });
    } else {
      const nach = nachlauf.has(rp.room.id) ? ' (heizt noch nach, zählt mit)' : '';
      targets.set(rp.room.id, { temp: waitT, why: (dayMode === 'battery_gate'
        ? `Batterie-Schutz: hält Untergrenze ${waitT} °C, Sonne lädt erst die Batterie`
        : `${modeText} → hält ${floorName} ${waitT} °C`) + nach });
    }
  }

  if (dayMode === 'grid' && !cap.reserviert) {   // Vorrang reserviert: kein Eco-Pass für andere (09.11.2026)
    for (const rp of rooms) {
      const ecoT = ecoOf(rp);
      const waitT = getWaitMinTemp(rp.room, settings);
      if (ecoT <= waitT) continue;
      if (cap.waiting.has(rp.room.id)) continue;   // wartet schon auf die Untergrenze
      if (cap.alone === rp.room.id) continue;      // heizt allein über der Grenze – nur bis Untergrenze, nicht bis Eco
      const cur = curOf(rp);
      if (cur <= 0) continue;
      if (fein && rp.room.is_heating === true && cur >= ecoT + stopMargin) {
        // Eco erreicht, Thermostat läuft noch: abschalten wie in Pass 1 – sonst heizt es bis Eco + Band (10.11.2026, A)
        targets.set(rp.room.id, { temp: holdBelow(cur, ecoT, bandOf(rp.room)),
          why: `${modeText} → Eco erreicht (${cur.toFixed(1)} ≥ ${ecoT} + ${stopMargin} °C) → Thermostat aus (würde sonst bis ${(ecoT + bandOf(rp.room)).toFixed(1)} °C heizen)` });
      } else if (cur >= ecoT) {
        targets.set(rp.room.id, { temp: ecoT, why: `${modeText} → Eco halten (Raum warm)${nachlauf.has(rp.room.id) ? ', heizt noch nach' : ''}` });
      } else if (granted.has(rp.room.id)) {
        targets.set(rp.room.id, { temp: ecoT, why: `${modeText} → Eco aus Netz (${gridUsedW}/${maxGridW}W)` });
      } else if (gridUsedW + rp.heatingPower <= maxGridW) {
        gridUsedW += rp.heatingPower;
        granted.add(rp.room.id);
        targets.set(rp.room.id, { temp: ecoT, why: `${modeText} → Eco aus Netz (${gridUsedW}/${maxGridW}W)` });
      }
      // sonst bleibt das Ziel aus Pass 1 – Raum wartet auf Netz-Kapazität
    }
  }
  return { targets, gridUsedW, waiting: cap.waiting, capGranted: cap.granted };
}

// (isMorningWaitPeriod entfernt — Thermostate regeln passiven Solargewinn selbst, alle Räume gleich behandelt)

// (isOptimalHeatingTime entfernt — normale Tag-Logik übernimmt)

interface MLDecision {
  room_id: string;
  room_name: string;
  action: 'activate' | 'deactivate' | 'keep';
  target_temp: number;
  reasoning: string;
  expected_energy_wh?: number;
  confidence?: number;
}

interface MLDecisionResponse {
  decisions?: MLDecision[];
  overall_strategy?: string;
  error?: string;
}

// Tuya API Helpers
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

async function sha256Hash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============= CACHED TOKEN FETCH =============
async function getAccessToken(accessId: string, accessSecret: string): Promise<string> {
  const now = Date.now();
  
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && tokenExpiry > now + TOKEN_BUFFER_MS) {
    console.log('[Tuya] Using cached token (expires in', Math.round((tokenExpiry - now) / 60000), 'min)');
    return cachedToken;
  }

  console.log('[Tuya] Fetching new access token...');
  const timestamp = now.toString();
  const path = '/v1.0/token?grant_type=1';
  const contentHash = await sha256Hash('');
  const stringToSign = ['GET', contentHash, '', path].join('\n');
  const signStr = accessId + timestamp + stringToSign;
  const sign = await hmacSha256(accessSecret, signStr);

  const response = await fetch(`https://openapi.tuyaeu.com${path}`, {
    method: 'GET',
    headers: {
      'client_id': accessId,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
    },
  });

  const data = await response.json();
  if (!data.success) throw new Error(`Tuya token error: ${data.msg}`);
  
  // Cache the token (Tuya tokens are valid for ~2 hours = 7200 seconds)
  cachedToken = data.result.access_token;
  const expiresIn = (data.result.expire_time || 7200) * 1000; // Convert to ms
  tokenExpiry = now + expiresIn;
  
  console.log('[Tuya] New token cached, expires in', Math.round(expiresIn / 60000), 'min');
  return cachedToken!;
}

interface TuyaResult {
  success: boolean;
  errorType?: string;
  errorMessage?: string;
}

  // Set device temperature - TGP508 only supports temp_set via Cloud API
  async function setDeviceTemperature(
    accessId: string,
    accessSecret: string,
    deviceId: string,
    temperature: number
  ): Promise<TuyaResult> {
    try {
      const token = await getAccessToken(accessId, accessSecret);
      const timestamp = Date.now().toString();
      const path = `/v1.0/devices/${deviceId}/commands`;
      
      const commands = [
        { code: 'temp_set', value: Math.round(temperature * 10) }
      ];
    
    const body = { commands };
    const bodyStr = JSON.stringify(body);
    const contentHash = await sha256Hash(bodyStr);
    const stringToSign = ['POST', contentHash, '', path].join('\n');
    const signStr = accessId + token + timestamp + stringToSign;
    const sign = await hmacSha256(accessSecret, signStr);

    console.log(`[Tuya] ${deviceId} -> ${temperature}°C`);

    const response = await fetch(`https://openapi.tuyaeu.com${path}`, {
      method: 'POST',
      headers: {
        'client_id': accessId,
        'access_token': token,
        'sign': sign,
        'sign_method': 'HMAC-SHA256',
        't': timestamp,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });

    const result = await response.json();
    console.log(`[Tuya] ${deviceId} -> ${temperature}°C: success=${result.success}, code=${result.code}`);
    
    if (result.success === true) {
      return { success: true };
    }
    
    // Determine error type from Tuya error codes
    const errorType = result.code === 1010 ? 'token_expired'
      : result.code === 2009 ? 'device_offline'
      : 'tuya_api';
    
    return { 
      success: false, 
      errorType, 
      errorMessage: result.msg || `Tuya error code: ${result.code}` 
    };
  } catch (error) {
    console.error(`[Tuya] Error for ${deviceId}:`, error);
    return { 
      success: false, 
      errorType: 'tuya_api', 
      errorMessage: String(error) 
    };
  }
}

// Set device mode separately (e.g. 'home' for manual mode)
// Called hourly to prevent internal thermostat schedules from overriding
async function setDeviceModeHome(
  accessId: string,
  accessSecret: string,
  deviceId: string
): Promise<TuyaResult> {
  try {
    const token = await getAccessToken(accessId, accessSecret);
    const timestamp = Date.now().toString();
    const path = `/v1.0/devices/${deviceId}/commands`;
    
    const commands = [{ code: 'mode', value: 'home' }];
    const body = { commands };
    const bodyStr = JSON.stringify(body);
    const contentHash = await sha256Hash(bodyStr);
    const stringToSign = ['POST', contentHash, '', path].join('\n');
    const signStr = accessId + token + timestamp + stringToSign;
    const sign = await hmacSha256(accessSecret, signStr);

    const response = await fetch(`https://openapi.tuyaeu.com${path}`, {
      method: 'POST',
      headers: {
        'client_id': accessId,
        'access_token': token,
        'sign': sign,
        'sign_method': 'HMAC-SHA256',
        't': timestamp,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });

    const result = await response.json();
    console.log(`[Tuya] ${deviceId} mode->home: success=${result.success}, code=${result.code}`);
    return { success: result.success === true, errorMessage: result.msg };
  } catch (error) {
    console.error(`[Tuya] Mode error for ${deviceId}:`, error);
    return { success: false, errorType: 'tuya_api', errorMessage: String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Authentication: Validate JWT token or known key
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = authHeader.replace('Bearer ', '');

  // Quick check: known keys (service_role, anon, publishable)
  const knownKeys = [serviceRoleKey, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
  let isAuthorized = knownKeys.includes(token);

  // If not a known key, try to decode JWT and check role
  if (!isAuthorized) {
    try {
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
        const role = payload.role || payload.aud;
        isAuthorized = ['anon', 'authenticated', 'service_role'].includes(role);
        if (!isAuthorized) {
          console.error(`[pv-automation] Auth rejected: role=${role}, sub=${!!payload.sub}`);
        }
      }
    } catch (e) {
      console.error(`[pv-automation] JWT decode failed: ${e}`);
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseKey = serviceRoleKey;
  const tuyaAccessId = Deno.env.get('TUYA_ACCESS_ID');
  const tuyaAccessSecret = Deno.env.get('TUYA_ACCESS_SECRET');
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace('/pv-automation', '');

    // GET /status
    if (path === '/status' && req.method === 'GET') {
      const { data: reading } = await supabase
        .from('energy_readings')
        .select('power_io, battery_soc, pv_power, consumption, timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      const { data: rooms } = await supabase
        .from('rooms')
        .select('id, name, pv_auto_enabled, pv_auto_active, target_temp, current_temp')
        .eq('pv_auto_enabled', true);

      const { data: settings } = await supabase
        .from('heating_settings')
        .select('*')
        .limit(1)
        .single();

      const surplus = reading?.power_io ? -reading.power_io : 0;

      return new Response(JSON.stringify({
        success: true,
        status: {
          currentSurplus: surplus,
          batterySoc: reading?.battery_soc || 0,
          pvPower: reading?.pv_power || 0,
          consumption: reading?.consumption || 0,
          thresholds: {
            on: settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON,
            off: settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF
          },
          rooms: rooms || [],
          lastReading: reading?.timestamp
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST /check - ML-based automation with SKIP LOGIC and NIGHT PAUSE
    if ((path === '/check' || path === '') && req.method === 'POST') {
      // K7 (10.11.2026, SQL 33): höchstens ein Lauf pro 60 s – drei Aufrufer (Cron, Fronius-Collector, Thermostat-Dienst).
      // Fehlt die Funktion oder schlägt der Aufruf fehl, läuft die Runde wie bisher (fail-open).
      try {
        const { data: darf, error: sperrFehler } = await supabase.rpc('pv_automation_lauf_starten', { p_abstand_s: 60 });
        if (!sperrFehler && darf === false) {
          console.log('[PV-Automation] Übersprungen: letzter Lauf < 60 s her');
          return new Response(JSON.stringify({ success: true, skipped: 'letzter Lauf < 60 s her' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (sperrFehler) console.log(`[PV-Automation] Lauf-Sperre nicht verfügbar → Lauf ohne Sperre: ${sperrFehler.message}`);
      } catch (e) { console.log(`[PV-Automation] Lauf-Sperre Fehler → Lauf ohne Sperre: ${e}`); }

      console.log('[PV-Automation] Starting ML-based check...');

      // Load control mode FIRST
      const { data: modeSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();
      let controlMode = (modeSetting?.value as { mode?: string })?.mode || 'cloud';
      console.log(`[PV-Automation] Control mode: ${controlMode}`);

      // ============= TUYA API QUOTA + KANAL-GESUNDHEIT =============
      let quotaData: { monthly_limit: number; calls_this_month: number; month: string; daily_limit: number; calls_today: number; today: string; last_sync_at: string | null } | null = null;
      let quotaExhausted = false;
      let pvPriorityMode = false; // PV-Überschuss-Priorität bei Quota-Knappheit
      let pvPriorityCalls = 0; // Zähler für PV-Priority-Calls (max 5)
      const PV_PRIORITY_MAX_CALLS = 5;
      // STOP-Reserve: Cloud-Calls die auch bei erschöpfter Quota für Sicherheits-
      // Rückstellungen (Night/Frost/Komfort→Eco/Übertemp-Stop) verwendet werden dürfen.
      // Erhöht auf 15, damit alle 12 Räume abends sicher abgesenkt werden können.
      // Wird strikt nur für Senkungen verwendet (priority='stop' im setTemperatureForMode).
      let stopReserveCalls = 0;
      const STOP_RESERVE_MAX_CALLS = 15;
      let localServiceActive = true;
      let lastLocalExec: string | null = null;
      let forcedLocalFallback = false;

      const checkLocalServiceActive = async (): Promise<boolean> => {
        // Single Source of Truth: service_health.last_sync für tuya-thermostat (5 min Schwelle).
        // last_local_command_at ist KEIN zuverlässiges Liveness-Signal (kann normal lange still sein
        // bei Komfort-Sättigung, Nacht, Pause). lastLocalExec wird nur noch für Logging gefüllt.
        const { data: recentLocalExec } = await supabase
          .from('thermostat_commands')
          .select('executed_at')
          .eq('status', 'executed')
          .order('executed_at', { ascending: false })
          .limit(1);
        lastLocalExec = recentLocalExec?.[0]?.executed_at || null;

        const { data: health } = await supabase
          .from('service_health')
          .select('last_sync')
          .eq('service_name', 'tuya-thermostat')
          .maybeSingle();

        const lastSync = health?.last_sync;
        return !!(lastSync && (Date.now() - new Date(lastSync).getTime()) < 5 * 60 * 1000);
      };

      // NOTE: Auto-switch to local mode is DISABLED - local service is not yet functional.
      // The mode must be changed manually by the user in settings.
      const persistLocalModeIfNeeded = async (reason: string) => {
        console.log(`[PV-Automation] ⚠️ Quota-Problem erkannt (${reason}), aber Auto-Switch auf LOCAL ist deaktiviert. Bleibe bei aktuellem Modus.`);
      };

      const queueLocalTemperatureCommand = async (
        roomId: string,
        temperature: number,
        reason?: string
      ): Promise<{ queued: boolean; alreadyQueued: boolean; error?: string }> => {
        const { data: pendingCommand } = await supabase
          .from('thermostat_commands')
          .select('id, value')
          .eq('room_id', roomId)
          .eq('command', 'set_temp')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const pendingValue = Number(pendingCommand?.value ?? NaN);
        if (pendingCommand?.id && Number.isFinite(pendingValue) && Math.abs(pendingValue - temperature) < 0.1) {
          return { queued: true, alreadyQueued: true };
        }

        // (27.10.2026) Kein separates set_mode mehr: Der lokale Dienst v1.3 setzt bei jedem
        // set_temp Modus "home" + Sollwert atomar. Das frühere set_mode stand in value_text,
        // der Dienst las value → scheiterte immer ("Unbekannter Modus null").

        const { error } = await supabase.from('thermostat_commands').insert({
          room_id: roomId,
          command: 'set_temp',
          value: temperature,
          status: 'pending',
          // Protokoll-Modul (01.11.2026, SQL 11): Begründung erscheint im Protokoll-Tab
          reason: reason ? String(reason).slice(0, 300) : null,
        });

        if (error) {
          console.error('[PV-Automation] Local command insert error:', error);
          return { queued: false, alreadyQueued: false, error: error.message };
        }

        return { queued: true, alreadyQueued: false };
      };

      if (controlMode === 'cloud') {
        const { data: quotaSetting } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'tuya_api_quota')
          .maybeSingle();

         if (quotaSetting?.value) {
          quotaData = quotaSetting.value as typeof quotaData;
          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const wienDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(now);

          let quotaRolledOver = false;
          if (quotaData!.month !== currentMonth) {
            quotaData!.calls_this_month = 0;
            quotaData!.month = currentMonth;
            quotaRolledOver = true;
            console.log(`[PV-Automation] 🔄 Monats-Reset: ${currentMonth} (calls_this_month → 0)`);
          }
          if (quotaData!.today !== wienDate) {
            quotaData!.calls_today = 0;
            quotaData!.today = wienDate;
            quotaRolledOver = true;
            console.log(`[PV-Automation] 🔄 Tages-Reset: ${wienDate} (calls_today → 0)`);
          }
          // Persistiere Reset SOFORT, sonst bleibt der Counter ewig in der DB stehen
          // wenn die Quota direkt danach als erschöpft markiert wird (kein write am Ende)
          if (quotaRolledOver) {
            await supabase
              .from('system_settings')
              .update({ value: quotaData as any, updated_at: new Date().toISOString() })
              .eq('key', 'tuya_api_quota');
          }

          const monthlyLimit = quotaData!.monthly_limit || 900;
          const configuredDailyLimit = quotaData!.daily_limit || 33;
          
          // DYNAMISCHES TAGESBUDGET: Verbleibendes Monatsbudget / verbleibende Tage
          const now2 = new Date();
          const daysInMonth = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
          const wienDay = parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', day: 'numeric' }).format(now2));
          const remainingDays = Math.max(1, daysInMonth - wienDay + 1); // inkl. heute
          const remainingMonthlyBudget = Math.max(0, monthlyLimit - quotaData!.calls_this_month);
          const dynamicDailyLimit = Math.max(30, Math.floor(remainingMonthlyBudget / remainingDays));
          
          // Verwende das kleinere von konfiguriertem und dynamischem Limit
          const dailyLimit = Math.min(configuredDailyLimit, dynamicDailyLimit);
          
          // Reserve: 2 Calls für Notfall-Frostschutz freihalten
          const effectiveDailyLimit = Math.max(1, dailyLimit - 2);

          // Plausibilitäts-Check: Tages-Counter
          if (quotaData!.calls_today > configuredDailyLimit * 2) {
            console.log(`[PV-Automation] ⚠️ Tages-Counter unplausibel hoch (${quotaData!.calls_today}/${configuredDailyLimit}) - reset auf ${configuredDailyLimit}`);
            quotaData!.calls_today = configuredDailyLimit;
          }

          // Plausibilitäts-Check: Monats-Counter
          if (quotaData!.calls_this_month > monthlyLimit * 2) {
            console.log(`[PV-Automation] ⚠️ Monats-Counter unplausibel hoch (${quotaData!.calls_this_month}/${monthlyLimit}) - reset auf ${monthlyLimit}`);
            quotaData!.calls_this_month = monthlyLimit;
          }

          if (quotaData!.calls_this_month >= monthlyLimit || quotaData!.calls_today >= effectiveDailyLimit) {
            quotaExhausted = true;
            console.log(`[PV-Automation] ⚠️ Quota erschöpft (${quotaData!.calls_today}/${dailyLimit} heute [dynamisch: ${dynamicDailyLimit}, konfig: ${configuredDailyLimit}], ${quotaData!.calls_this_month}/${monthlyLimit} monatlich, ${remainingDays} Tage übrig)`);
          } else {
            console.log(`[PV-Automation] Quota: ${quotaData!.calls_today}/${dailyLimit} heute [dynamisch: ${dynamicDailyLimit}], ${quotaData!.calls_this_month}/${monthlyLimit} monatlich, ${remainingDays} Tage übrig`);
          }
        }

        // Realitäts-Check: echte Quota-Fehler loggen (aber KEIN Auto-Switch)
        const { data: recentQuotaErrors } = await supabase
          .from('api_errors')
          .select('id')
          .eq('source', 'pv-automation')
          .eq('error_type', 'tuya_api')
          .is('resolved_at', null)
          .gte('created_at', new Date(Date.now() - 90 * 60 * 1000).toISOString())
          .ilike('error_message', '%quota%')
          .limit(1);

        if (recentQuotaErrors && recentQuotaErrors.length > 0) {
          quotaExhausted = true;
          console.log('[PV-Automation] ⚠️ Quota laut API-Fehlern erschöpft - Auto-Switch auf LOCAL ist deaktiviert, bleibe bei Cloud');
        }
      }

      if (controlMode === 'local' || quotaExhausted) {
        localServiceActive = await checkLocalServiceActive();

        if (localServiceActive) {
          await supabase
            .from('api_errors')
            .update({ resolved_at: new Date().toISOString() })
            .eq('source', 'pv-automation')
            .eq('error_type', 'no_control_channel')
            .is('resolved_at', null);
        } else {
          const { data: recentNoControl } = await supabase
            .from('api_errors')
            .select('id')
            .eq('source', 'pv-automation')
            .eq('error_type', 'no_control_channel')
            .is('resolved_at', null)
            .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
            .limit(1);

          if (!recentNoControl || recentNoControl.length === 0) {
            await supabase.from('api_errors').insert({
              source: 'pv-automation',
              error_type: 'no_control_channel',
              error_message: `Lokaler Service nicht aktiv. Letzter ausgeführter lokaler Befehl: ${lastLocalExec || 'nie'}`,
              error_code: 'NO_CONTROL',
            });
          }

          console.log(`[PV-Automation] ⛔ Kein Steuerkanal verfügbar (lastLocalExec=${lastLocalExec || 'none'})`);
        }
      }

      // Helper: Mode-aware temperature setting
      // priority='stop' → Notfall-/Rückstell-Befehl (Night, Frostschutz, Sicherheits-Stopp)
      //   - darf STOP_RESERVE_MAX_CALLS auch bei erschöpfter Quota nutzen
      //   - schreibt zusätzlich/als Fallback in thermostat_commands (deduped),
      //     damit ein später aktivierter Local-Service den Befehl nachholen kann
      async function setTemperatureForMode(
        deviceId: string,
        roomId: string,
        temperature: number,
        priority: 'normal' | 'stop' = 'normal',
        reason?: string
      ): Promise<TuyaResult> {
        if (controlMode === 'local') {
          const queued = await queueLocalTemperatureCommand(roomId, temperature, reason);
          if (!queued.queued) {
            return { success: false, errorType: 'db_error', errorMessage: queued.error || 'Lokales Queueing fehlgeschlagen' };
          }

          if (!localServiceActive) {
            console.log(`[PV-Automation] Local command vorgemerkt (Service offline): room=${roomId} temp=${temperature}°C`);
            return {
              success: false,
              errorType: 'local_service_offline',
              errorMessage: queued.alreadyQueued
                ? 'Lokaler Service offline - Befehl bereits wartend'
                : 'Lokaler Service offline - Befehl wartend vorgemerkt',
            };
          }

          console.log(`[PV-Automation] Local command queued: room=${roomId} temp=${temperature}°C${queued.alreadyQueued ? ' (bereits vorhanden)' : ''}`);
          return { success: true };
        }

        // CLOUD-MODUS
        // STOP-Befehle: Reserve nutzen (kein Queue-Fallback, da Local-Service nicht eingerichtet ist)
        if (priority === 'stop') {
          if (quotaExhausted) {
            if (stopReserveCalls >= STOP_RESERVE_MAX_CALLS) {
              console.log(`[PV-Automation] ⛔ STOP-Reserve erschöpft (${stopReserveCalls}/${STOP_RESERVE_MAX_CALLS}) → keine Zustellung möglich`);
              return {
                success: false,
                errorType: 'quota_exhausted',
                errorMessage: 'Cloud-Quota und Stop-Reserve erschöpft – Rückstellung konnte nicht zugestellt werden',
              };
            }
            stopReserveCalls++;
            console.log(`[PV-Automation] 🛑 STOP-Reserve-Call ${stopReserveCalls}/${STOP_RESERVE_MAX_CALLS}: ${deviceId} → ${temperature}°C (Rückstellung trotz Quota)`);
          }

          if (!tuyaAccessId || !tuyaAccessSecret) {
            return { success: false, errorType: 'config', errorMessage: 'Tuya credentials not configured' };
          }
          return await setDeviceTemperature(tuyaAccessId, tuyaAccessSecret, deviceId, temperature);
        }

        // QUOTA-GATE: Block cloud API calls when quota is exhausted (nur normale Calls)
        // EXCEPTION: PV-Priority-Modus erlaubt begrenzte Calls bei hohem PV-Überschuss
        if (quotaExhausted && !pvPriorityMode) {
          console.log(`[PV-Automation] ⛔ QUOTA-GATE: Cloud API call blocked for device ${deviceId} → ${temperature}°C`);
          return { success: false, errorType: 'quota_exhausted', errorMessage: 'Tuya API Quota erschöpft - kein Cloud-Call möglich' };
        }
        if (quotaExhausted && pvPriorityMode) {
          // Nur Aufheiz-Calls (>= eco_temp) zählen gegen PV-Priority-Limit
          const nightTempRef = settings?.night_temp || 17;
          const isHeatingCall = temperature > nightTempRef + 0.5;
          if (isHeatingCall) {
            if (pvPriorityCalls >= PV_PRIORITY_MAX_CALLS) {
              console.log(`[PV-Automation] ⛔ PV-Priority-Limit erreicht (${pvPriorityCalls}/${PV_PRIORITY_MAX_CALLS})`);
              return { success: false, errorType: 'quota_exhausted', errorMessage: 'PV-Priority-Limit erreicht' };
            }
            pvPriorityCalls++;
            console.log(`[PV-Automation] ⚡ PV-Priority-Call ${pvPriorityCalls}/${PV_PRIORITY_MAX_CALLS}: ${deviceId} → ${temperature}°C (Aufheizen)`);
          } else {
            console.log(`[PV-Automation] 🔽 PV-Priority-Deaktivierung (kein Limit): ${deviceId} → ${temperature}°C`);
          }
        }
        if (!tuyaAccessId || !tuyaAccessSecret) {
          return { success: false, errorType: 'config', errorMessage: 'Tuya credentials not configured' };
        }
        return await setDeviceTemperature(tuyaAccessId, tuyaAccessSecret, deviceId, temperature);
      }

      // 2. Load settings FIRST (needed for night check)
      const { data: settings } = await supabase
        .from('heating_settings')
        .select('*')
        .limit(1)
        .single();

      // Anwesenheit (28.10.2026): abwesend → jeder Tag wie ein Wartetag, kein Komfort. Nacht unverändert.
      const presence = await getPresence(supabase, settings);
      const isAway = presence.away;
      console.log(`[ANWESENHEIT] ${isAway ? 'ABWESEND' : 'anwesend'} – ${presence.reason}${presence.nextStart ? `, nächster Eintrag ${presence.nextStart}` : ''}`);

      // NIGHT PAUSE: Skip Tuya cloud calls during night hours to save API quota
      const nightStartTime = settings?.night_start_time || '22:00';
      const nightEndTime = settings?.night_end_time || '08:00';
      const { isNight, wienTime, wienHour: preNightWienHour } = isNightTime(nightStartTime, nightEndTime);
      
      if (isNight) {
        const nightHeatingMode = settings?.night_heating_mode || 'frost_only';
        console.log(`[PV-Automation] Night mode active (${wienTime}), mode: ${nightHeatingMode}`);

        // Parallel-Plan-Snapshot auf Nacht-Defaults zurücksetzen, damit UI keine
        // veralteten Tages-Werte (max_parallel_eco/comfort > 0) mehr anzeigt.
        try {
          await supabase.from('system_settings').upsert(
            {
              key: 'parallel_heating_capacity',
              value: {
                computed_at: new Date().toISOString(),
                grid_export_w: 0,
                baseload_buffer_w: 0,
                trend_w_per_5min: 0,
                trend_bonus_w: 0,
                lookahead_bonus_w: 0,
                lookahead_factor: 'neutral',
                next_hour_forecast_w: 0,
                eco_budget_w: 0,
                comfort_budget_w: 0,
                eco_candidates: [],
                comfort_candidates: [],
                max_parallel_eco: 0,
                max_parallel_comfort: 0,
                planned_eco_room_ids: [],
                planned_comfort_room_ids: [],
                budget_mode: 'night',
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'key' }
          );
        } catch (e) {
          console.log(`[PV-Automation] Night parallel-plan reset failed: ${e}`);
        }

        // NIGHT-QUIET-GATE: Pro Nacht nur EINMAL Tuya-Calls absetzen.
        // "Nacht-Schlüssel" = Datum des Nacht-Beginns (Wien). Wenn aktuelle Wien-Zeit
        // vor night_end ist, gehört sie zur "Nacht" des Vortages.
        const wienHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
        const wienMinute = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna', minute: '2-digit' }));
        const wienDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' }); // YYYY-MM-DD in Wien-Zeit
        const { hour: nightEndHour, minute: nightEndMin } = parseTimeOfDay(nightEndTime, '08:00');
        const isBeforeNightEnd =
          wienHour < nightEndHour ||
          (wienHour === nightEndHour && wienMinute < nightEndMin);
        const [wienY, wienM, wienD] = wienDateStr.split('-').map(Number);
        const nightKeyDate = new Date(wienY, wienM - 1, wienD);
        if (isBeforeNightEnd) nightKeyDate.setDate(nightKeyDate.getDate() - 1);
        const nightKey = `${nightKeyDate.getFullYear()}-${String(nightKeyDate.getMonth() + 1).padStart(2, '0')}-${String(nightKeyDate.getDate()).padStart(2, '0')}`; // YYYY-MM-DD

        const { data: gateRow } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'night_frost_last_pushed')
          .maybeSingle();
        const gateVal = (gateRow?.value as { night?: string; failures?: number; last_attempt_at?: string } | null) || null;
        const lastPushedNight = gateVal?.night || null;
        const lastFailures = Number(gateVal?.failures || 0);
        const lastAttemptAt = gateVal?.last_attempt_at ? new Date(gateVal.last_attempt_at).getTime() : 0;
        const minsSinceLastAttempt = lastAttemptAt > 0 ? (Date.now() - lastAttemptAt) / 60000 : 9999;
        const NIGHT_RETRY_THROTTLE_MIN = 15;

        // Quiet Mode NUR wenn die Nacht bereits ohne Fehler abgeschlossen wurde.
        // Bei Fehlern: alle 15 Min erneut versuchen (nur fehlgeschlagene Räume).
        // Seit 06.11.2026: „Nachtwert halten“ (maintain) hat KEINEN Quiet Mode mehr – die Leistungsgrenze
        // wird bei jedem Lauf neu verteilt (sonst heizten alle Räume gleichzeitig, 03./04.11.: 7–11 kW).
        // Nur bei Fehlern bleibt die 15-Minuten-Pause, damit ein offline Dienst nicht alle 5 Minuten Fehler schreibt.
        const isMaintainNight = nightHeatingMode !== 'frost_only';
        const fullySucceeded = !isMaintainNight && lastPushedNight === nightKey && lastFailures === 0;
        const recentlyAttempted = lastPushedNight === nightKey && minsSinceLastAttempt < NIGHT_RETRY_THROTTLE_MIN
          && (!isMaintainNight || lastFailures > 0);
        if (fullySucceeded || recentlyAttempted) {
          const reason = fullySucceeded
            ? `bereits erfolgreich gepushed für Nacht ${nightKey}`
            : `Retry-Throttle (${minsSinceLastAttempt.toFixed(1)}min < ${NIGHT_RETRY_THROTTLE_MIN}min, ${lastFailures} offen)`;
          console.log(`[PV-Automation] 🌙 Night quiet mode (${reason})`);
          return new Response(JSON.stringify({
            success: true,
            message: `Nachtmodus aktiv (${wienTime}) - Quiet Mode (${reason})`,
            nightMode: true,
            nightHeatingMode,
            quietMode: true,
            nightKey,
            pendingFailures: lastFailures,
            results: []
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Load all rooms with Tuya devices
        const { data: allRooms } = await supabase
          .from('rooms')
          // '*' statt Spaltenliste: enthält fuehler_sonne_seit (SQL 28), läuft aber auch ohne die Spalte weiter
          .select('*')
          .not('tuya_device_id', 'is', null);
        
        if (!allRooms || allRooms.length === 0) {
          // Auch ohne Räume: Gate setzen, sonst läuft die Abfrage alle 2 Min
          await supabase.from('system_settings').upsert({
            key: 'night_frost_last_pushed',
            value: { night: nightKey, pushed_at: new Date().toISOString(), rooms: 0 }
          }, { onConflict: 'key' });
          return new Response(JSON.stringify({ 
            success: true, 
            message: `Nachtmodus aktiv (${wienTime}) - keine Thermostate konfiguriert`,
            nightMode: true,
            results: [] 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const nightResults: { roomId: string; roomName: string; success: boolean; action: string; error?: string }[] = [];

        if (nightHeatingMode === 'frost_only') {
          // FROST_ONLY: Einmalig pro Nacht Thermostate auf Frostschutz (5°C) setzen.
          // Kein periodischer 30-Min-Resync mehr (verbrennt Quota).
          // TGP508 halten den Sollwert; falls ein internes Programm dazwischenfunkt,
          // wird das morgens beim Eco-Start ohnehin korrigiert.
          const FROST_TEMP = 5;

          const roomsNeedingOff = allRooms.filter(r => {
            const currentTarget = Number(r.target_temp) || 0;
            return currentTarget > FROST_TEMP + 1;
          });

          if (roomsNeedingOff.length === 0) {
            console.log(`[PV-Automation] 🌙 Night frost_only: alle ${allRooms.length} Thermostate bereits ≤${FROST_TEMP + 1}°C → Gate setzen, Quiet Mode`);
            // Gate auch hier setzen, damit kommende Iterationen sofort returnen
            await supabase.from('system_settings').upsert({
              key: 'night_frost_last_pushed',
              value: { night: nightKey, pushed_at: new Date().toISOString(), rooms: 0, mode: 'frost_only' }
            }, { onConflict: 'key' });
            return new Response(JSON.stringify({ 
              success: true, 
              message: `Nachtmodus aktiv (${wienTime}) - alle Thermostate auf Frostschutz (${FROST_TEMP}°C)`,
              nightMode: true, nightHeatingMode,
              quietMode: true, nightKey,
              thermostatsChecked: allRooms.length,
              results: [] 
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          console.log(`[PV-Automation] 🌙 Night frost_only EINMAL-Push: ${roomsNeedingOff.length}/${allRooms.length} rooms → ${FROST_TEMP}°C (Nacht ${nightKey})`);

          for (const room of roomsNeedingOff) {
            console.log(`[PV-Automation] Night: ${room.name} → ${FROST_TEMP}°C (was ${room.target_temp}°C)`);

            const result = await setTemperatureForMode(
              room.tuya_device_id!,
              room.id,
              FROST_TEMP,
              'stop',
              `Nacht: Frostschutz ${FROST_TEMP}°C`
            );

            if (result.success) {
              await supabase.from('rooms').update({
                target_temp: FROST_TEMP,
                pv_auto_active: false,
                heating_paused_reason: 'night_frost_only',
                last_auto_change: new Date().toISOString(),
                // Lokal-Modus (08.11.2026): „erfolgreich“ heißt nur „eingereiht“ – Erreichbarkeit und Heizstatus schreibt allein der Thermostat-Dienst nach echter Lesung (FIX-LOKAL-ERREICHBARKEIT-2026-11-08).
                ...(controlMode === 'cloud' ? { is_heating: false, last_thermostat_sync: new Date().toISOString() } : {}),
                updated_at: new Date().toISOString()
              }).eq('id', room.id);

              nightResults.push({ roomId: room.id, roomName: room.name, success: true, action: `frost_${FROST_TEMP}°C` });
            } else {
              const failReason = result.errorType === 'no_control_channel'
                ? 'night_frost_failed: kein Steuerkanal (Cloud-Quota erschöpft & Local-Service offline)'
                : result.errorType === 'quota_exhausted'
                ? `night_frost_failed: ${result.errorMessage || 'Quota erschöpft'}`
                : `night_frost_failed: ${result.errorMessage || 'unbekannt'}`;
              console.error(`[PV-Automation] Night frost: Failed ${room.name}: ${failReason}`);

              // Persistente API-Fehler-Markierung für UI-Banner
              await supabase.from('api_errors').insert({
                source: 'pv-automation',
                room_id: room.id,
                room_name: room.name,
                error_type: result.errorType === 'no_control_channel' ? 'no_control_channel' : 'night_frost_failed',
                error_message: failReason,
                error_code: result.errorType || 'unknown',
                device_id: room.tuya_device_id,
              }).select().single().then(() => {}, () => {});

              const fallbackTemp = Number(room.target_temp) || 20;
              await supabase.from('rooms').update({
                target_temp: fallbackTemp,
                heating_paused_reason: failReason,
                updated_at: new Date().toISOString()
              }).eq('id', room.id);
              nightResults.push({ roomId: room.id, roomName: room.name, success: false, action: 'frost_failed', error: failReason });
            }
          }

          // Gate setzen mit success-gated Status:
          // - failures===0 → Nacht abgeschlossen, Quiet Mode bis nightKey wechselt
          // - failures>0  → Retry alle 15min für die fehlgeschlagenen Räume
          const nightFailures = nightResults.filter(r => !r.success).length;
          const nightSuccesses = nightResults.filter(r => r.success).length;
          await supabase.from('system_settings').upsert({
            key: 'night_frost_last_pushed',
            value: {
              night: nightKey,
              pushed_at: new Date().toISOString(),
              last_attempt_at: new Date().toISOString(),
              rooms: roomsNeedingOff.length,
              successes: nightSuccesses,
              failures: nightFailures,
              mode: 'frost_only'
            }
          }, { onConflict: 'key' });
          if (nightFailures > 0) {
            console.log(`[NIGHT-RETRY] frost_only: ${nightFailures}/${roomsNeedingOff.length} fehlgeschlagen → Retry in 15min`);
          }

        } else {
          // MAINTAIN: Bisheriges Verhalten – night_temp halten
          const globalNightTemp = settings?.night_temp || 17;
          console.log(`[PV-Automation] Night maintain: globalNightTemp=${globalNightTemp}°C`);
          
          // Seit 02.11.2026 (Konzept Tagesablauf §11): Die Untergrenze ist auch nachts eine harte Grenze.
          // Nachtwert unter der Untergrenze wird angehoben. Nur „Frostschutz“ (frost_only) ist eine bewusste Ausnahme.
          const nightTargetOf = (r: any) => Math.max(Number(r.night_temp) || globalNightTemp, getWaitMinTemp(r, settings));

          // ---- Leistungsgrenze auch nachts (06.11.2026, Uli: „Grenze gilt immer“) ----
          // Grenze = „Max. Heizleistung ohne PV“ (max_grid_heating_power_w). Räume unter ihrem Nachtwert
          // heizen nach Wartezeit-Vorrang/Priorität, solange die Summe darunter bleibt; ein Raum über der
          // Grenze heizt allein. Andere warten mit „Ist − Band − 0,5 °C“. Wer heizt, behält die Leistung bis zum Ziel;
          // im Schaltband gibt es einen Anstoß (09.11.2026). Nachlauf und manuell übersteuerte
          // Räume, die gerade heizen, zählen zur Leistung. Räume mit ausgeschalteter Automatik bleiben unberührt.
          const nightCapW = Math.max(0, Number(settings?.max_grid_heating_power_w ?? 2000));
          const nightBoostMin = Math.max(0, Number(settings?.cap_wait_boost_min ?? 60));
          const nowMsNight = Date.now();
          await attachBands(supabase, allRooms);
          // Fühler in der Sonne (SQL 28) wie übersteuert: keine Befehle, zählt nur mit, wenn er heizt
          // Nicht steuerbar (C, 10.11.2026) wie übersteuert, außer Prüfbefehl fällig
          const nachtProbe = await probeDueIds(supabase, allRooms);
          const isOverridden = (r: any) => !!r.fuehler_sonne_seit
            || (!!r.nicht_steuerbar_seit && !nachtProbe.has(r.id))
            || (!!r.manual_override_until && new Date(r.manual_override_until).getTime() > nowMsNight);
          const autoRooms = allRooms.filter((r: any) => r.automation_enabled !== false);
          const ctrlRooms = autoRooms.filter((r: any) => !isOverridden(r));
          let nightStartUsed = 0;
          const nightNachlauf = new Set<string>();
          for (const r of autoRooms) {
            const cur = Number(r.current_temp) || 0;
            const heatingAnyway = r.is_heating === true && (isOverridden(r) || (cur > 0 && cur >= nightTargetOf(r)));
            if (heatingAnyway) { nightStartUsed += roomPowerW(r); nightNachlauf.add(r.id); }
          }
          const nightCands = ctrlRooms
            .filter((r: any) => { const c = Number(r.current_temp) || 0; return c > 0 && c < nightTargetOf(r); })
            .map((r: any) => ({ id: r.id, name: r.name, power: roomPowerW(r), prio: Number(r.priority) || 99, heating: r.is_heating === true }));
          const nightState = await loadWaitState(supabase);
          const nightWaitPrev = nightState.rooms;
          const nightCap = allocateUnderCap(nightCands, nightCapW, nightStartUsed, nightWaitPrev, nightBoostMin, nowMsNight,
            nightState.granted, Math.max(0, Number(settings?.cap_keep_max_min ?? 120)));
          const nowIsoNight = new Date().toISOString();
          await saveWaitState(supabase, nextWaitState(nightWaitPrev, nightCap.waiting, nowIsoNight),
            nextGrantState(nightState.granted, nightCap.granted, nowIsoNight), 'nacht');

          const fmtHM = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
          const nightPlan: Array<{ room: any; target: number; why: string }> = ctrlRooms.map((r: any) => {
            const want = nightTargetOf(r);
            const cur = Number(r.current_temp) || 0;
            let target = want;
            let why: string;
            if (nightCap.granted.has(r.id)) {
              const st = controlMode === 'local'
                ? startTarget(cur, want, bandOf(r), r.is_heating === true, Math.max(want, Number(r.comfort_temp) || want))
                : { temp: want, anstoss: false };
              target = st.temp;
              why = `unter Nachtwert (${cur.toFixed(1)} < ${want} °C) → heizt, ${nightCap.usedW}/${nightCapW} W`
                + (nightCap.alone === r.id ? ` – größer als die Grenze, heizt allein` : '')
                + (nightCap.kept.has(r.id) ? ', behält Leistung bis Ziel' : '')
                + (st.anstoss ? ` – Anstoß ${st.temp} °C (im Schaltband ±${bandOf(r)} °C)` : '');
            } else if (nightCap.waiting.has(r.id)) {
              target = holdBelow(cur, want, bandOf(r));
              const seit = nightWaitPrev[r.id] ? ` seit ${fmtHM(nightWaitPrev[r.id])}` : '';
              why = `unter Nachtwert (${cur.toFixed(1)} < ${want} °C), Grenze ${nightCapW} W belegt (${nightCap.usedW} W) → wartet${seit}`;
            } else if (controlMode === 'local' && r.is_heating === true && cur > 0 && cur >= want + Math.max(0, Number(settings?.ziel_abschalt_ueber_c ?? 0.3))) {
              // Ziel erreicht, Thermostat läuft noch: abschalten – sonst heizt es bis Ziel + Band (09.11.2026)
              target = holdBelow(cur, want, bandOf(r));
              why = `Nachtwert erreicht (${cur.toFixed(1)} ≥ ${want} °C) → Thermostat aus (würde sonst bis ${(want + bandOf(r)).toFixed(1)} °C heizen)`;
            } else {
              why = `hält Nachtwert ${want} °C` + (nightNachlauf.has(r.id) ? ' (heizt noch nach, zählt mit)' : '');
            }
            return { room: r, target, why };
          });
          console.log(`[NACHT-GRENZE] ${nightCap.usedW}/${nightCapW} W · heizt: ${[...nightCap.granted].length} · wartet: ${[...nightCap.waiting].length} · Nachlauf: ${nightNachlauf.size}`);

          // Planer steuert (13.11.2026): auch nachts entscheidet der Plan; die Nacht-Verteilung oben bleibt Rückfall.
          const nachtPlan = await ladePlanerPlan(supabase, settings);
          if (nachtPlan.map) {
            let n = 0;
            for (const p of nightPlan) {
              const e = nachtPlan.map.get(p.room.id);
              if (!e) continue;
              const z = planerSollwert(p.room, e, settings);
              p.target = z.temp; p.why = z.why; n++;
            }
            console.log(`[PLANER-STEUERT] Nacht, ${nachtPlan.grund}: ${n} Räume nach Plan`);
          } else if ((settings?.planer_modus ?? 'schatten') === 'steuern') {
            console.log(`[PLANER-STEUERT] Nacht: ${nachtPlan.grund}`);
          }

          // Für die App: Begründung je Raum auch nachts (Übersicht › Raumkarte „Automatik: …“)
          try {
            await supabase.from('system_settings').upsert({
              key: 'heating_night_mode',
              value: {
                computed_at: new Date().toISOString(),
                cap_w: nightCapW,
                used_w: nightCap.usedW,
                rooms: nightPlan.map(p => ({ room_id: p.room.id, name: p.room.name, target: p.target, why: p.why })),
              },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'key' });
          } catch (e) { console.log(`[NACHT-GRENZE] Persist fehlgeschlagen: ${e}`); }

          const roomsNeedingAdjustment = nightPlan.filter(p => Math.abs((Number(p.room.target_temp) || 0) - p.target) >= 0.25);

          if (roomsNeedingAdjustment.length === 0) {
            await supabase.from('system_settings').upsert({
              key: 'night_frost_last_pushed',
              value: { night: nightKey, pushed_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), rooms: 0, failures: 0, mode: 'maintain' }
            }, { onConflict: 'key' });
            return new Response(JSON.stringify({
              success: true,
              message: `Nachtmodus aktiv (${wienTime}) - keine Änderung nötig (${nightCap.usedW}/${nightCapW} W)`,
              nightMode: true, nightHeatingMode,
              nightKey,
              thermostatsChecked: allRooms.length,
              results: []
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          for (const plan of roomsNeedingAdjustment) {
            const room = plan.room;
            const nightTarget = plan.target;
            console.log(`[PV-Automation] Night maintain: ${room.name} → ${nightTarget}°C (was ${room.target_temp}°C) – ${plan.why}`);

            const result = await setTemperatureForMode(
              room.tuya_device_id!,
              room.id,
              nightTarget,
              'stop',
              `Nacht: ${plan.why}`
            );

            if (result.success) {
              await supabase.from('rooms').update({
                target_temp: nightTarget,
                pv_auto_active: false,
                heating_paused_reason: null,
                last_auto_change: new Date().toISOString(),
                // Lokal-Modus (08.11.2026): „erfolgreich“ heißt nur „eingereiht“ – Erreichbarkeit und Heizstatus schreibt allein der Thermostat-Dienst nach echter Lesung (FIX-LOKAL-ERREICHBARKEIT-2026-11-08).
                ...(controlMode === 'cloud' ? { last_thermostat_sync: new Date().toISOString() } : {}),
                updated_at: new Date().toISOString()
              }).eq('id', room.id);
              
              nightResults.push({ roomId: room.id, roomName: room.name, success: true, action: `maintain_${nightTarget}°C` });
            } else {
              const failReason = result.errorType === 'no_control_channel'
                ? 'night_maintain_failed: kein Steuerkanal (Cloud-Quota & Local-Service offline)'
                : `night_maintain_failed: ${result.errorMessage || 'unbekannt'}`;
              await supabase.from('api_errors').insert({
                source: 'pv-automation',
                room_id: room.id,
                room_name: room.name,
                error_type: result.errorType === 'no_control_channel' ? 'no_control_channel' : 'night_frost_failed',
                error_message: failReason,
                error_code: result.errorType || 'unknown',
                device_id: room.tuya_device_id,
              }).select().single().then(() => {}, () => {});
              nightResults.push({ roomId: room.id, roomName: room.name, success: false, action: 'maintain_failed', error: failReason });
            }
          }

          // Gate setzen mit success-gated Status (siehe frost_only oben)
          const maintainFailures = nightResults.filter(r => !r.success).length;
          const maintainSuccesses = nightResults.filter(r => r.success).length;
          await supabase.from('system_settings').upsert({
            key: 'night_frost_last_pushed',
            value: {
              night: nightKey,
              pushed_at: new Date().toISOString(),
              last_attempt_at: new Date().toISOString(),
              rooms: roomsNeedingAdjustment.length,
              successes: maintainSuccesses,
              failures: maintainFailures,
              mode: 'maintain'
            }
          }, { onConflict: 'key' });
          if (maintainFailures > 0) {
            console.log(`[NIGHT-RETRY] maintain: ${maintainFailures}/${roomsNeedingAdjustment.length} fehlgeschlagen → Retry in 15min`);
          }
        }

        const successCount = nightResults.filter(r => r.success).length;
        
        // Quota tracking für Nacht-Befehle
        if (quotaData && controlMode === 'cloud' && successCount > 0) {
          quotaData.calls_this_month += successCount;
          quotaData.calls_today += successCount;
          await supabase.from('system_settings')
            .update({ value: quotaData, updated_at: new Date().toISOString() })
            .eq('key', 'tuya_api_quota');
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: `Nachtmodus aktiv (${wienTime}, ${nightHeatingMode}) - ${successCount} Thermostate angepasst`,
          nightMode: true, nightHeatingMode,
          adjusted: successCount,
          total: allRooms.length,
          results: nightResults,
          quotaStatus: quotaData ? { today: quotaData.calls_today, dailyLimit: quotaData.daily_limit, month: quotaData.calls_this_month, monthlyLimit: quotaData.monthly_limit } : null,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 1. Load latest energy reading
      const { data: reading, error: readingError } = await supabase
        .from('energy_readings')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (readingError || !reading) {
        return new Response(JSON.stringify({ success: false, error: 'No energy readings' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const surplus = -reading.power_io;
      const batterySoc = reading.battery_soc || 0;
      const gridExportForPriority = Math.max(0, -reading.power_io);

      // ============= PV-PRIORITY-MODUS =============
      // Bei erschöpfter Quota ABER hohem PV-Überschuss: begrenzte API-Calls erlauben
      // Damit wird PV-Potenzial genutzt statt Strom ins Netz zu verschenken
      if (quotaExhausted && controlMode === 'cloud') {
        // Prüfe ob kritische Eco-Transition nötig ist (Räume noch auf Nacht-Temp nach Tagstart)
        // Critical-Eco-Transition NUR im Morgen-Fenster (dayStart..dayStart+29 min Wien-Zeit) wenn Räume noch auf Nacht.
        // Vorher: griff auch abends/nachts und verschwendete Quota.
        let needsCriticalEcoTransition = false;
        const _wienMinForTransition = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna', minute: '2-digit' }));
        const _dayStartHour = getDayStartHour(settings);
        if (preNightWienHour === _dayStartHour && _wienMinForTransition < 30) {
          const { data: ecoCheckRooms } = await supabase
            .from('rooms')
            .select('id, target_temp, eco_temp, tuya_device_id, automation_enabled')
            .not('tuya_device_id', 'is', null)
            .eq('automation_enabled', true);
          
          needsCriticalEcoTransition = (ecoCheckRooms || []).some(r => {
            const currentTarget = Number(r.target_temp) || 0;
            const ecoTemp = r.eco_temp || 19;
            return currentTarget < ecoTemp - 1;
          });
        }

        if (needsCriticalEcoTransition) {
          // Eco-Übergang ist Pflicht — Quota-Limit für diese kritische Transition ignorieren
          console.log(`[PV-Automation] 🔥 KRITISCHE ECO-TRANSITION: ${preNightWienHour}:xx, Räume noch auf Nacht → Quota-Override für Eco`);
          quotaExhausted = false;
        } else {
          // Dynamische PV-Priority-Schwelle basierend auf Batterie-SOC
          const pvPriorityActive = 
            (batterySoc >= 95 && gridExportForPriority > 500) ||
            (batterySoc >= 90 && batterySoc < 95 && gridExportForPriority > 1000);
          
          if (pvPriorityActive) {
            pvPriorityMode = true;
            console.log(`[PV-Automation] ⚡ PV-PRIORITY-MODUS aktiviert: ${gridExportForPriority}W Export, ${batterySoc}% Batterie → max ${PV_PRIORITY_MAX_CALLS} Calls erlaubt trotz Quota`);
          } else {
            // Quota erschöpft und kein PV-Priority → sofort zurückkehren ohne DB-Writes
            console.log(`[PV-Automation] ⚠️ Quota erschöpft, kein PV-Priority (Export ${gridExportForPriority}W, SOC ${batterySoc}%) → SOFORT-RETURN`);
            return new Response(JSON.stringify({
              success: true,
              message: 'Quota erschöpft - übersprungen (kein PV-Priority)',
              quotaExhausted: true,
              pvPriorityMode: false,
              tuyaApiCalls: 0,
              quotaStatus: quotaData ? { today: quotaData.calls_today, dailyLimit: quotaData.daily_limit, month: quotaData.calls_this_month, monthlyLimit: quotaData.monthly_limit } : null,
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }
      }

      // minBatterySoc removed — only heating_min_battery_soc is used (siehe SOC-Gate)
      const thresholdOn = settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON;
      const thresholdOff = settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF;
      const minSwitchIntervalMs = (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN) * 60 * 1000;

      // 3. Load ALL automated rooms - not just those with PV heating
      // This ensures rooms with pv_auto_enabled=false still get:
      // - Night mode (night_temp)
      // - Budget pause (15°C when PV is low)
      // - But NO active PV heating to comfort temp
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' }); // YYYY-MM-DD in Wien-Zeit
      let { data: rooms, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('automation_enabled', true)
        .not('tuya_device_id', 'is', null);

      if (roomsError || !rooms || rooms.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No rooms with PV automation', results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ---- Fühler in der Sonne (09.11.2026, doc/FIX-FUEHLER-SONNE-UND-DP19-2026-11-09.md) ----
      // Meldet ein Thermostat eine Sonnenspitze (SQL 28 setzt rooms.fuehler_sonne_seit), misst es am heißen Fühler
      // und heizt ohnehin nicht. Der Raum bekommt dann weder PV-Budget noch einen Teil der Leistungsgrenze und
      // keinen Befehl – sonst wäre Leistung für einen Raum reserviert, der gar nicht heizt. Sollwert bleibt, wie er ist.
      const fuehlerSonne = rooms.filter((r: any) => !!r.fuehler_sonne_seit);
      if (fuehlerSonne.length > 0) {
        for (const r of fuehlerSonne) {
          console.log(`[FUEHLER-SONNE] ${r.name}: gemeldet ${r.current_temp_gemeldet} °C, gerechnet ${r.current_temp} °C seit ${r.fuehler_sonne_seit} → ausgelassen`);
        }
        rooms = rooms.filter((r: any) => !r.fuehler_sonne_seit);
      }
      // Nicht steuerbar (C): raus aus der Runde, außer Prüfbefehl fällig. Wer davon trotzdem heizt, zählt zur Grenze.
      const tagProbe = await probeDueIds(supabase, rooms);
      const nichtSteuerbar = rooms.filter((r: any) => !!r.nicht_steuerbar_seit && !tagProbe.has(r.id));
      for (const r of nichtSteuerbar) {
        console.log(`[NICHT-STEUERBAR] ${r.name}: seit ${r.nicht_steuerbar_seit} (${r.nicht_steuerbar_grund ?? '–'}) → keine Befehle, nächster Prüfbefehl spätestens in 60 min`);
      }
      for (const id of tagProbe) console.log(`[NICHT-STEUERBAR] ${rooms.find((r: any) => r.id === id)?.name}: Prüfbefehl fällig → bleibt in dieser Runde`);
      if (nichtSteuerbar.length > 0) rooms = rooms.filter((r: any) => !nichtSteuerbar.includes(r));
      const ausserhalbHeizW = [...fuehlerSonne, ...nichtSteuerbar]
        .filter((r: any) => r.is_heating === true).reduce((a: number, r: any) => a + roomPowerW(r), 0);

      // 12.11.2026: KI-Tagesplaner (ai-daily-planner) entfernt – ersetzt durch den rechnenden Heizplaner (heizplaner).
      // Sein Rang wurde nie gelesen (heating_recommendations leer) und hätte nur bei gleicher Priorität gewirkt
      // (rooms.priority ist eindeutig). doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md

      // ============= PRE-SYNC: Frische Thermostatdaten vor Automationsrunde =============
      // Throttle: nur alle 15 Minuten syncen um Tuya API Quota zu schonen
      let syncFailed = false;
      const shouldSync = (() => {
        if (controlMode !== 'cloud' || !tuyaAccessId || !tuyaAccessSecret) return false;
        if (quotaExhausted) return false; // Skip pre-sync when quota exhausted
        if (!quotaData?.last_sync_at) return true;
        const lastSync = new Date(quotaData.last_sync_at).getTime();
        const minutesSinceSync = (Date.now() - lastSync) / (1000 * 60);
        return minutesSinceSync >= 360; // 360 Minuten (6h) → maximale Quota-Ersparnis (One-Shot-Logik)
      })();

      if (shouldSync) {
        try {
          console.log(`[PV-Automation] Pre-sync: Lade frische Thermostatdaten für ${rooms.length} Räume...`);
          const syncResponse = await fetch(`${supabaseUrl}/functions/v1/tuya-control/sync-all`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
          });
          
          if (syncResponse.ok) {
            const syncResult = await syncResponse.json();
            console.log(`[PV-Automation] Pre-sync erfolgreich: ${syncResult.results?.length || 0} Räume synchronisiert`);
            
            // Quota: Sync = 2 API calls (Token-Refresh + Batch-Status)
            if (quotaData) {
              quotaData.calls_this_month += 2;
              quotaData.calls_today += 2;
              quotaData.last_sync_at = new Date().toISOString();
              // Re-check quota after pre-sync
              const effectiveDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
              if (quotaData.calls_today >= effectiveDL || quotaData.calls_this_month >= (quotaData.monthly_limit || 900)) {
                quotaExhausted = true;
                console.log(`[PV-Automation] ⚠️ Quota nach Pre-Sync erschöpft (${quotaData.calls_today}/${effectiveDL} heute, ${quotaData.calls_this_month}/${quotaData.monthly_limit || 900} monatlich)`);
              }
            }
            
            // Räume neu laden mit frischen Daten
            const { data: freshRooms, error: freshError } = await supabase
              .from('rooms')
              .select('*')
              .eq('automation_enabled', true)
              .not('tuya_device_id', 'is', null);
            
            if (!freshError && freshRooms && freshRooms.length > 0) {
              rooms = freshRooms;
              console.log(`[PV-Automation] Räume neu geladen nach Pre-sync`);
            }
          } else {
            console.warn(`[PV-Automation] Pre-sync fehlgeschlagen (${syncResponse.status}) - verwende DB-Daten, nur Reduktionen/Stops erlaubt`);
            syncFailed = true;
          }
        } catch (syncError) {
          console.warn(`[PV-Automation] Pre-sync Fehler: ${syncError} - verwende DB-Daten, nur Reduktionen/Stops erlaubt`);
          syncFailed = true;
        }
      } else if (controlMode === 'cloud') {
        console.log(`[PV-Automation] Pre-sync übersprungen (Throttle: nächster Sync in ${quotaData?.last_sync_at ? Math.max(0, 360 - Math.round((Date.now() - new Date(quotaData.last_sync_at).getTime()) / 60000)) : '?'} Min)`);
      }

      // 4. Load ML features
      const { data: mlFeatures } = await supabase
        .from('room_ml_features')
        .select('*')
        .in('room_id', rooms.map(r => r.id))
        .order('date', { ascending: false });

      // Get latest feature per room
      const latestMlFeatures: Record<string, unknown>[] = [];
      const seenRooms = new Set<string>();
      for (const f of mlFeatures || []) {
        if (!seenRooms.has(f.room_id)) {
          latestMlFeatures.push(f);
          seenRooms.add(f.room_id);
        }
      }

      // 5. Load weather data
      const { data: weatherData } = await supabase
        .from('weather_data')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      // 6. Load recent evaluated events for feedback
      const { data: recentEvents } = await supabase
        .from('learning_events')
        .select('decision_type, action, reward, reward_breakdown')
        .eq('is_evaluated', true)
        .order('timestamp', { ascending: false })
        .limit(10);

      // 7. Load PV forecast for today (with hourly_watts for tracking)
      // Wien-Datum verwenden (nicht UTC!) — zwischen 00:00-01:00 UTC wäre sonst das gestrige Datum
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      const { data: todayForecast } = await supabase
        .from('pv_forecasts')
        .select('expected_kwh, hourly_watts, sunset, sunrise, date')
        .eq('date', today)
        .maybeSingle();

      // === PV-FORECAST-FALLBACK (Robustheit 1) ===
      // Wenn heutiger Forecast fehlt oder 0, lade letzten verfügbaren Eintrag der letzten 3 Tage
      let pvForecast: any = todayForecast;
      let forecastIsStale = false;
      if (!todayForecast || !todayForecast.expected_kwh) {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
          .toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
        const { data: fallback } = await supabase
          .from('pv_forecasts')
          .select('expected_kwh, hourly_watts, sunset, sunrise, date')
          .gte('date', threeDaysAgo)
          .lt('date', today)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (fallback?.expected_kwh) {
          pvForecast = fallback;
          forecastIsStale = true;
          console.log(`[PV-FORECAST] Stale fallback from ${fallback.date}: ${fallback.expected_kwh} kWh (×0.7 comfort budget)`);
        } else {
          console.log(`[PV-FORECAST] Kein Forecast verfügbar (auch kein 3-Tage-Fallback) → Hard-Gate aktiv`);
        }
      }

      const expectedPvKwh = pvForecast?.expected_kwh || 0;
      const hourlyWatts = (pvForecast?.hourly_watts || {}) as Record<string, number>;
      
      // Sonnenuntergang erkennen für Batterie-Reserve-Logik
      const sunsetStr = pvForecast?.sunset as string | null; // z.B. "19:45:00"
      const sunsetHour = sunsetStr ? parseInt(sunsetStr.split(':')[0], 10) : 20; // Fallback 20:00
      const sunsetMin = sunsetStr ? sunsetHour * 60 + (parseInt(sunsetStr.split(':')[1], 10) || 0) : 20 * 60;
      const { wienHour: currentWienHour } = isNightTime(settings?.night_start_time || '22:00', settings?.night_end_time || '08:00');
      const wienNowParts = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      const wienNowMin = Number(wienNowParts.find(p => p.type === 'hour')?.value ?? currentWienHour) * 60 + Number(wienNowParts.find(p => p.type === 'minute')?.value ?? 0);
      // Seit 06.11.2026 minutengenau (vorher nur Stunde → „nach Sonnenuntergang“ galt z. B. schon ab 16:00 bei Sonnenuntergang 16:40).
      const afterSunset = wienNowMin >= sunsetMin;

      // ============= PV-BOOST: ENERGIEBUDGET-BERECHNUNG =============
      // WW + E-Auto werden autonom von Smartfox gesteuert und reduzieren
      // den verfügbaren Netzexport bereits physikalisch — KEIN zusätzlicher Abzug
      // im Tagesbudget (sonst Doppelzählung, Heizbudget zu klein).
      const boostDelta = settings?.pv_boost_temp_delta || 2;
      const batteryCapacity = settings?.battery_capacity_kwh || 13.8;
      const batteryNeedKwh = batteryCapacity * Math.max(0, 1 - (batterySoc / 100));
      const availableHeatingKwh = Math.max(0, expectedPvKwh - batteryNeedKwh);

      // Prognose-Korrektur: Vergleiche bisherige tatsächliche PV-Produktion mit Prognose
      let forecastAccuracy = 1.0; // 1.0 = perfekt
      const { wienHour: currentHourForForecast } = isNightTime('22:00', settings?.night_end_time || '08:00');
      // Start ab Tagesbeginn (Default 6 Uhr), nicht erst ab 8:00 — sonst läuft Morgen-Heizung ohne Korrektur
      const forecastWindowStartHour = 6;
      if (currentHourForForecast > forecastWindowStartHour && Object.keys(hourlyWatts).length > 0) {
        // Summe der prognostizierten Wh bis zur aktuellen Stunde
        // BUG-FIX: hourly_watts Keys sind "2026-04-12 07:00:00", nicht "7"
        let forecastSoFarWh = 0;
        for (let h = 6; h < currentHourForForecast; h++) {
          const key = `${today} ${h.toString().padStart(2, '0')}:00:00`;
          forecastSoFarWh += (hourlyWatts[key] || 0);
        }
        
        if (forecastSoFarWh > 0) {
          // Tatsächliche Produktion aus energy_readings (energy_out = PV-Produktion)
          const todayStart = `${today}T06:00:00`;
          const { data: todayReadings } = await supabase
            .from('energy_readings')
            .select('pv_power, timestamp')
            .gte('timestamp', todayStart)
            .order('timestamp', { ascending: true });
          
          if (todayReadings && todayReadings.length > 2) {
            // Trapezintegral über die Samples → robust gegen Lücken (z.B. Collector-Ausfälle)
            // pv_power ist Momentanleistung (W); Σ ((W1+W2)/2 * Δt_h) = Wh
            let actualWh = 0;
            for (let i = 1; i < todayReadings.length; i++) {
              const t1 = new Date(todayReadings[i - 1].timestamp).getTime();
              const t2 = new Date(todayReadings[i].timestamp).getTime();
              const dtHours = (t2 - t1) / 3_600_000;
              // Lücken >10min ignorieren (Collector war offline) — verhindert Über/Unterschätzung
              if (dtHours <= 0 || dtHours > 10 / 60) continue;
              const w1 = todayReadings[i - 1].pv_power || 0;
              const w2 = todayReadings[i].pv_power || 0;
              actualWh += ((w1 + w2) / 2) * dtHours;
            }
            forecastAccuracy = Math.min(2.0, actualWh / forecastSoFarWh);
          } else {
            // Zu wenige Samples (<3) — konservative Annahme statt voller Prognose,
            // verhindert Über-Allokation am frühen Morgen vor genug Messdaten
            forecastAccuracy = 0.7;
            console.log(`[PV-Automation] Forecast-Accuracy: <3 Samples → konservativ 0.7 (statt 1.0)`);
          }
        }
      }

      // Grundlast schätzen (Verbrauch ohne Heizung, typisch 400-600W)
      const baseLoad = 500; // TODO: könnte aus Verbrauchs-Analyse kommen
      
      // ============= PV-TAGESPROGNOSE: Verbleibende Energie berechnen =============
      // Summe der prognostizierten Watt von jetzt bis Sonnenuntergang
      let remainingPvForecastWh = 0;
      const sunriseStr2 = pvForecast?.sunrise as string | null;
      const sunriseHour = sunriseStr2 ? parseInt(sunriseStr2.split(':')[0], 10) : 6;
      const hoursUntilSunset = Math.max(0, sunsetHour - currentWienHour);
      
      if (!afterSunset) {
        for (let h = currentWienHour; h < sunsetHour; h++) {
          const key = `${today} ${h.toString().padStart(2, '0')}:00:00`;
          remainingPvForecastWh += (hourlyWatts[key] || 0);
        }
      }
      
      // Korrigieren mit Prognose-Genauigkeit und Grundlast abziehen
      const remainingPvForHeatingWh = Math.max(0, 
        (remainingPvForecastWh * forecastAccuracy) - (baseLoad * hoursUntilSunset)
      );
      
      // ============= ECO-ENERGIEBEDARF ALLER RÄUME =============
      let totalEcoEnergyNeededWh = 0;
      const ecoRoomDetails: Array<{name: string, neededWh: number, tempDiff: number}> = [];
      
      for (const room of rooms) {
        if (!room.automation_enabled) continue;
        const ecoTemp = room.eco_temp || settings?.eco_temp || 19;
        const currentTemp = room.current_temp || 0;
        if (currentTemp >= ecoTemp) continue;
        
        const tempDiff = ecoTemp - currentTemp;
        const heatingPower = room.heating_power_w || room.calculated_power_w || 800;
        
        // ML-Features für genauere Schätzung nutzen
        const mlFeature = mlFeatures.find(f => f.room_id === room.id);
        let energyNeededWh: number;
        
        if (mlFeature?.energy_per_degree_wh && mlFeature.energy_per_degree_wh > 0) {
          energyNeededWh = tempDiff * mlFeature.energy_per_degree_wh;
        } else {
          // Fallback: heatingPower × geschätzte Dauer (ca. 45 Min pro Grad)
          const estimatedMinutes = tempDiff * 45;
          energyNeededWh = (heatingPower * estimatedMinutes) / 60;
        }
        
        totalEcoEnergyNeededWh += energyNeededWh;
        ecoRoomDetails.push({ name: room.name, neededWh: Math.round(energyNeededWh), tempDiff: Math.round(tempDiff * 10) / 10 });
      }
      
      const pvSufficientForEco = remainingPvForHeatingWh >= totalEcoEnergyNeededWh;
      console.log(`[PV-Automation] 📊 Tagesprognose: PV-Rest=${(remainingPvForHeatingWh/1000).toFixed(1)}kWh, Eco-Bedarf=${(totalEcoEnergyNeededWh/1000).toFixed(1)}kWh → ${pvSufficientForEco ? '✅ REICHT' : '⚠️ REICHT NICHT'} | Accuracy=${(forecastAccuracy*100).toFixed(0)}%`);
      if (ecoRoomDetails.length > 0) {
        console.log(`[PV-Automation] 📊 Eco-Räume: ${ecoRoomDetails.map(r => `${r.name} (${r.tempDiff}°→${r.neededWh}Wh)`).join(', ')}`);
      }
      
      // Anzahl der Räume die noch auf Eco gebracht werden müssen
      const ecoRoomsRemaining = ecoRoomDetails.length;
      
      // ============= HARTES SOC-GATE (Heizung darf Batterie nur über Gate entladen) =============
      // Einzige Source of Truth: heating_min_battery_soc (manuell eingestellt, z.B. 75%).
      // battery_reserve_for_night_soc ist @deprecated und darf NICHT mehr als Gate-Fallback dienen.
      // Wenn heating_min_battery_soc null ist, gilt Default 80 — nicht der alte deprecated Wert.
      const heatingMinSoc = settings?.heating_min_battery_soc ?? 80;
      const socGateMode = (settings?.heating_soc_gate_mode ?? 'strict') as 'strict' | 'soft';

      // Nach Sonnenuntergang: Batterie-Reserve für Eco nur wenn SOC > Gate (nicht mehr hartcodiert 50)
      // Seit 06.11.2026 aus: Ab Sonnenuntergang gilt die Nachtlogik (Tagesmodus 'evening'), kein Eco aus der Batterie.
      // Uli: „Warum um 19:00 auf 22? Das ist doch Quatsch.“ – die Batterie ist für die Nacht.
      const batteryEcoReserveAllowed = false;
      void ecoRoomsRemaining;
      
      // Aktuelle Stunden-Prognose für Mindest-Budget
      const currentHourForecastW = hourlyWatts[`${today} ${currentWienHour.toString().padStart(2, '0')}:00:00`] || 0;
      const currentHourForecastCorrected = currentHourForecastW * forecastAccuracy;

      const boostAllowed = availableHeatingKwh > 3 && forecastAccuracy >= 0.7;
      console.log(`[PV-Automation] PV-Boost: Budget=${availableHeatingKwh.toFixed(1)}kWh (Prognose=${expectedPvKwh}kWh - Batterie=${batteryNeedKwh.toFixed(1)}; WW+Auto=Smartfox-autonom, kein Abzug), Prognose-Genauigkeit=${(forecastAccuracy*100).toFixed(0)}%, Boost=${boostAllowed ? 'ERLAUBT' : 'GESPERRT'}`);
      const pvPower = reading.pv_power || 0;
      const rawBatteryPower = reading.battery_power || 0;
      // Smartfox-Konvention: negativ=laden, positiv=entladen
      // Normalisierung: positiv=laden, negativ=entladen (für Budget-Logik)
      const batteryPower = -rawBatteryPower;
      // Klare Helper-Konstanten (positive Werte) für lesbaren neuen Code.
      // Bestehende batteryPower-Vergleiche bleiben unverändert.
      const batteryChargingW = Math.max(0, batteryPower);
      const batteryDischargingW = Math.max(0, -batteryPower);
      void batteryChargingW; void batteryDischargingW;

      // ============= PV-TREND (5-Min) =============
      // Automatisch berechnet, nicht konfigurierbar. Wird in Bonus + Tolerante Deaktivierung verwendet.
      let pvTrend = 0; // W (positiv = steigend)
      try {
        const { data: trendData } = await supabase
          .from('energy_readings')
          .select('pv_power, timestamp')
          .gte('timestamp', new Date(Date.now() - 6 * 60 * 1000).toISOString())
          .order('timestamp', { ascending: false })
          .limit(10);
        if (trendData && trendData.length >= 2) {
          const pvNow = trendData[0]?.pv_power ?? pvPower;
          const pvOld = trendData[trendData.length - 1]?.pv_power ?? pvNow;
          pvTrend = Math.round((pvNow - pvOld));
          console.log(`[PV-TREND] ${trendData.length} samples, jetzt=${pvNow}W vor 5min=${pvOld}W → Trend=${pvTrend > 0 ? '+' : ''}${pvTrend}W`);
        }
      } catch (e) {
        console.log(`[PV-TREND] Berechnung fehlgeschlagen: ${e}`);
      }

      // ============= BATTERIE-RESERVE FÜR NACHVERBRAUCH =============
      const batteryReserveSoc = settings?.battery_reserve_for_night_soc ?? 60;
      const batteryBufferEnabled = settings?.battery_buffer_enabled !== false;
      const batteryBufferBonusW = settings?.battery_buffer_bonus_w ?? 500;
      const tolerantDeactivationEnabled = settings?.tolerant_deactivation_enabled !== false;
      const socAboveReserve = batterySoc - batteryReserveSoc;

      // ============= TÄGLICHES SOC-TRACKING =============
      try {
        const trackToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
        const wienHourNow = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
        const wienMinuteNow = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna', minute: '2-digit' }));
        const { data: existing } = await supabase
          .from('battery_daily_tracking')
          .select('soc_at_heating_start, soc_at_heating_end')
          .eq('date', trackToday)
          .maybeSingle();
        if (wienHourNow === getDayStartHour(settings) && wienMinuteNow < 30 && !existing?.soc_at_heating_start) {
          await supabase.from('battery_daily_tracking').upsert({
            date: trackToday, soc_at_heating_start: batterySoc,
          }, { onConflict: 'date' });
          console.log(`[BATTERY-TRACK] Heizstart-SOC erfasst: ${batterySoc}%`);
        }
        if (wienHourNow >= 17 && wienHourNow <= 19 && !existing?.soc_at_heating_end) {
          await supabase.from('battery_daily_tracking').upsert({
            date: trackToday, soc_at_heating_end: batterySoc,
          }, { onConflict: 'date' });
          console.log(`[BATTERY-TRACK] Heizende-SOC erfasst: ${batterySoc}%`);
        }
      } catch (e) {
        console.log(`[BATTERY-TRACK] Snapshot fehlgeschlagen: ${e}`);
      }

      // (Solar-Gain-Erkennung entfernt — Thermostate regeln passiven Solargewinn selbst)

      // Calculate grid export (negative power_io means export)
      const gridExport = reading.power_io < 0 ? -reading.power_io : 0;

      // ============= CONSUMER PRIORITY entfernt =============
      // WW + E-Auto werden autonom von Smartfox priorisiert; deren Verbrauch reduziert
      // gridExport bereits physikalisch. Frühere Software-Reserven (hotwaterReserveW,
      // carReserveW, consumer_priority) wurden entfernt, weil sie zu doppelter Reservierung
      // und blockiertem Heizkomfort führten. Batterie-Vorrang bleibt über heating_min_battery_soc.
      const batteryBeforeHeating = true;

      // ============= LEISTUNGSBUDGET-MANAGEMENT =============
      // Berechne verfügbares Budget basierend auf PV-Leistung oder Netz-Maximum
      const powerBudgetEnabled = settings?.power_budget_enabled !== false;
      const maxGridHeatingPower = settings?.max_grid_heating_power_w || 2000;
      const powerBudgetTolerance = settings?.power_budget_tolerance_w || 200;
      const roomRotationMinutes = settings?.room_rotation_minutes || 30;
      const minRoomPauseMinutes = settings?.min_room_pause_minutes || 15;
      const pvThresholdOn = settings?.pv_surplus_threshold_on || 500;
      const pvThresholdOff = settings?.pv_surplus_threshold_off || 200;
      const floorResponseHours = settings?.floor_heating_response_hours || 0;
      // Pre-Heat: Tagesfenster beginnt floor_heating_response_hours vor settings.night_end_time (Wien),
      // damit Fußbodenheizung mit Vorlauf starten kann — Untergrenze 06:00.
      const _dayStartHour = getDayStartHour(settings);
      const dayWindowStartHour = Math.max(_dayStartHour - Math.round(floorResponseHours), 6);
      if (floorResponseHours > 0) {
        console.log(`[PRE-HEAT] dayWindowStart=${dayWindowStartHour}h (Vorlauf ${floorResponseHours}h vor ${formatDayStart(settings)}, Untergrenze 06:00)`);
      }


      // Budget-Modus bestimmen
      let budgetMode: 'pv_optimized' | 'grid_sequential' | 'unlimited' = 'unlimited';
      let availableBudget = 999999; // Unlimited default
      let comfortBudget = 999999; // Komfort-Budget: nur echter Überschuss

      // Aktuell heizende Leistung — im äußeren Scope, weil später in Logs/Phase-1-Header referenziert
      const currentlyHeatingPower = rooms
        .filter(r => r.is_heating)
        .reduce((sum, r) => sum + (r.heating_power_w || r.calculated_power_w || 800), 0);

      if (powerBudgetEnabled) {
        if (pvPower > 500) {
          // PV-Optimiert: Budget = gridExport + Leistung bereits heizender Räume + Toleranz
          budgetMode = 'pv_optimized';
          const dynamicTolerance = Math.max(powerBudgetTolerance, Math.round(gridExport * 0.20));
          
          // Basis-Budget: gridExport + bereits heizend + Toleranz
          let baseBudget = gridExport + currentlyHeatingPower + dynamicTolerance;
          
          // Prognose-Mindest-Budget für Eco: Wenn Tagesprognose reicht, mindestens Stunden-Prognose nutzen
          // Erst ab 9:00 Uhr — davor bleibt Nachtmodus aktiv
          // HARD-GATE: Nur wenn Batterie über Schutz-SOC UND kein Netzbezug (echter Überschuss)
          const realSurplusOk = (reading.power_io ?? 0) <= 50;
          const socOkForForecast = batterySoc >= heatingMinSoc;
          if (currentWienHour >= dayWindowStartHour && pvSufficientForEco && ecoRoomsRemaining > 0 && totalEcoEnergyNeededWh > 0) {
            if (socOkForForecast && realSurplusOk) {
              const forecastMinBudget = Math.max(0, currentHourForecastCorrected - baseLoad);
              if (forecastMinBudget > baseBudget) {
                console.log(`[PV-Automation] ☀️ Prognose-Budget: Tages-PV reicht für Eco → Mindest-Budget ${Math.round(forecastMinBudget)}W (Stunden-Prognose ${Math.round(currentHourForecastCorrected)}W - Grundlast ${baseLoad}W) statt aktuell ${Math.round(baseBudget)}W`);
                baseBudget = forecastMinBudget;
              }
            } else {
              console.log(`[OVERSHOOT-GATE] Prognose-Mindest-Budget gesperrt: SOC=${batterySoc}% (Gate=${heatingMinSoc}%, ok=${socOkForForecast}), power_io=${Math.round(reading.power_io ?? 0)}W (≤50, ok=${realSurplusOk}) → baseBudget bleibt ${Math.round(baseBudget)}W`);
            }
          }
          
          // Batterie-Ladereserve: Bei SOC unter Heizungs-Gate Lade-Leistung reservieren
          if (batteryPower > 0 && batterySoc < heatingMinSoc) {
            // Batterie lädt gerade — diese Leistung vom Budget abziehen
            // Bei SOC < 30%: volle Ladeleistung reservieren
            // Bei SOC 30-Gate%: anteilig reduzieren
            const range = Math.max(10, heatingMinSoc - 30);
            const batteryPriority = batterySoc < 30 ? 1.0 : (heatingMinSoc - batterySoc) / range;
            const batteryReserve = Math.round(batteryPower * batteryPriority);
            baseBudget = Math.max(0, baseBudget - batteryReserve);
            console.log(`[PV-Automation] 🔋 Batterie-Ladereserve: ${batteryReserve}W abgezogen (SOC ${batterySoc}% < Gate ${heatingMinSoc}%, lädt ${Math.round(batteryPower)}W, Priorität ${(batteryPriority*100).toFixed(0)}%) → Budget ${Math.round(baseBudget)}W`);
          }
          
          // Netzbezug abziehen (10.11.2026, doc/FIX-PRUEFUNG-REST-2026-11-10.md): Das Budget zählt die Leistung aller gerade
          // heizenden Räume mit. Kommt ein Teil davon aus dem Netz, ist das keine Sonne – sonst behält ein Raum sein
          // „PV-Budget“, heizt aus dem Netz und zählt dabei nicht zur Leistungsgrenze des Tagesmodus.
          const netzBezugW = Math.max(0, Number(reading.power_io) || 0);
          if (netzBezugW > 50) {
            baseBudget = Math.max(0, baseBudget - netzBezugW);
            console.log(`[PV-Automation] 🔌 Netzbezug-Korrektur: ${Math.round(netzBezugW)}W Bezug → Eco-Budget reduziert auf ${Math.round(baseBudget)}W`);
          }

          // Batterie-Schutz: Wenn Batterie entlädt, Budget reduzieren
          // ABER: Tagsüber immer aktiv, nach Sunset nur für Komfort (nicht für Eco)
          if (batteryPower < 0) {
            const batteryDrain = Math.abs(batteryPower);
            if (!batteryEcoReserveAllowed) {
              // Tagsüber oder SOC <= 50%: Batterie-Korrektur für ALLES (Eco + Komfort)
              baseBudget = Math.max(0, baseBudget - batteryDrain);
              console.log(`[PV-Automation] ⚡ Batterie-Korrektur: ${batteryDrain}W Entladung → Eco-Budget reduziert auf ${baseBudget}W`);
            } else {
              // Nach Sunset + SOC > 50%: Eco-Budget NICHT reduzieren (Batterie für Eco erlaubt)
              console.log(`[PV-Automation] 🌅 Batterie-Korrektur für Eco aufgehoben: ${batteryDrain}W Entladung erlaubt (Abend-Reserve, SOC ${batterySoc}%)`);
            }
          }

          // Konsumenten-Vorrang-Block entfernt: WW + Auto sind Smartfox-autonom und
          // werden nicht mehr software-seitig reserviert. Batterie-Vorrang via heating_min_battery_soc.
          void batteryBeforeHeating;

          availableBudget = Math.max(0, baseBudget);
          
          // ============= GESTUFTER PROGNOSE-BONUS (nur Eco, mit SOC-Gates) =============
          // Wenn PV-Tagesprognose den Eco-Bedarf deutlich übersteigt UND Batterie Reserve hat,
          // wird das Eco-Budget hochgestuft, damit auch bei wenig Live-Export geheizt werden kann.
          // Komfort bleibt strikt — kein Bonus für Komfort.
          let prognoseBonus = 0;
          if (currentWienHour >= dayWindowStartHour && !afterSunset && ecoRoomsRemaining > 0 && totalEcoEnergyNeededWh > 0) {
            const bonusSocOk = batterySoc >= heatingMinSoc;
            const bonusGridOk = (reading.power_io ?? 0) <= 50;
            if (!bonusSocOk || !bonusGridOk) {
              console.log(`[OVERSHOOT-GATE] Prognose-Bonus gesperrt: SOC=${batterySoc}% (Gate=${heatingMinSoc}%, ok=${bonusSocOk}), power_io=${Math.round(reading.power_io ?? 0)}W (≤50, ok=${bonusGridOk})`);
            } else {
              const ratio = remainingPvForHeatingWh / totalEcoEnergyNeededWh;
              if (ratio >= 3 && batterySoc >= 50) {
                prognoseBonus = 1500;
              } else if (ratio >= 2 && batterySoc >= 60) {
                prognoseBonus = 800;
              } else if (ratio >= 1.5 && batterySoc >= 70) {
                prognoseBonus = 400;
              }
              if (prognoseBonus > 0) {
                availableBudget += prognoseBonus;
                console.log(`[PV-Automation] 📈 Prognose-Bonus: +${prognoseBonus}W (Ratio=${ratio.toFixed(1)}x, SOC=${batterySoc}%) → Eco-Budget=${availableBudget}W`);
              }
            }
          }
          
          // ============= BATTERIE-PUFFER (Eco-Budget, mit Reserve-Schutz) =============
          // Nur wenn SOC weit über Reserve UND Prognose den Tagesbedarf deckt UND Trend nicht stark fallend.
          // Skaliert in 3 Stufen je nach Abstand zur Reserve.
          let batteryBuffer = 0;
          if (batteryBufferEnabled
              && socAboveReserve > 20
              && remainingPvForHeatingWh >= totalEcoEnergyNeededWh
              && pvTrend >= -300) {
            if (socAboveReserve >= 35) batteryBuffer = batteryBufferBonusW;
            else if (socAboveReserve >= 25) batteryBuffer = Math.round(batteryBufferBonusW * 0.6);
            else batteryBuffer = Math.round(batteryBufferBonusW * 0.3);
            availableBudget += batteryBuffer;
            console.log(`[BATTERY-BUFFER] +${batteryBuffer}W (SOC=${batterySoc}% / Reserve=${batteryReserveSoc}% → Δ=${socAboveReserve}, PV-Rest≥Bedarf, Trend=${pvTrend}W) → Eco-Budget=${availableBudget}W`);
          } else if (batteryBufferEnabled && socAboveReserve > 20) {
            console.log(`[BATTERY-BUFFER] Gesperrt: PV-Rest<Bedarf (${(remainingPvForHeatingWh/1000).toFixed(1)}/${(totalEcoEnergyNeededWh/1000).toFixed(1)}kWh) oder Trend=${pvTrend}W`);
          }

          // ============= PV-TREND BONUS — symmetrisch (Eco-Budget) =============
          // Trend-Faktor 0.5 mit Clamp ±1500W, kein Threshold mehr.
          // Steigender Trend → mehr Räume parallel; fallender Trend → konservativer.
          const trendBonus = Math.max(-1500, Math.min(1500, Math.round(pvTrend * 0.5)));
          if (trendBonus !== 0) {
            availableBudget = Math.max(0, availableBudget + trendBonus);
            console.log(`[PV-TREND] ${trendBonus >= 0 ? '+' : ''}${trendBonus}W (Trend=${pvTrend >= 0 ? '+' : ''}${pvTrend}W × 0.5, symmetrisch) → Eco-Budget=${availableBudget}W`);
          }

          // ============= DYNAMISCHER BASELOAD-PUFFER (Komfort-Schutz) =============
          // Aus Standardabweichung der letzten ~10 Min consumption — schützt vor unnötigen
          // Komfort-Deaktivierungen bei Lastspitzen (Backofen, Mikrowelle, ...).
          let dynamicBaseloadBuffer = 300;
          try {
            const { data: bl } = await supabase
              .from('energy_readings')
              .select('consumption')
              .gte('timestamp', new Date(Date.now() - 11 * 60 * 1000).toISOString())
              .order('timestamp', { ascending: false })
              .limit(15);
            const vals = (bl || []).map(r => Number(r.consumption || 0)).filter(v => v > 0);
            if (vals.length >= 3) {
              const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
              const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
              const stddev = Math.sqrt(variance);
              dynamicBaseloadBuffer = Math.max(200, Math.min(1500, Math.round(stddev * 1.5)));
              console.log(`[BASELOAD-BUFFER] N=${vals.length}, μ=${Math.round(mean)}W, σ=${Math.round(stddev)}W → Puffer=${dynamicBaseloadBuffer}W`);
            }
          } catch (e) {
            console.log(`[BASELOAD-BUFFER] Berechnung fehlgeschlagen: ${e}`);
          }

          // ============= PROGNOSE-LOOKAHEAD-BONUS (nur Komfort) =============
          // Wenn die kommende Stunde mind. 90% des aktuellen Werts liefert → Bonus für Komfort,
          // damit mehr Räume parallel hochgezogen werden. Bei Wolkenfront (≤50%) → Komfort drosseln.
          let lookaheadBonus = 0;
          let lookaheadFactor: 'boost' | 'neutral' | 'cloud_warning' = 'neutral';
          let nextHourForecastCorrected = 0;
          try {
            const nextHour = (currentWienHour + 1) % 24;
            const nextHourRawW = hourlyWatts[`${today} ${nextHour.toString().padStart(2, '0')}:00:00`] || 0;
            nextHourForecastCorrected = nextHourRawW * forecastAccuracy;
            if (currentHourForecastCorrected > 100) {
              if (nextHourForecastCorrected >= currentHourForecastCorrected * 0.9) {
                lookaheadBonus = Math.max(0, Math.min(
                  Math.round(gridExport * 0.3),
                  Math.round(nextHourForecastCorrected - baseLoad - 1000)
                ));
                if (lookaheadBonus > 0) lookaheadFactor = 'boost';
              } else if (nextHourForecastCorrected < currentHourForecastCorrected * 0.5) {
                lookaheadFactor = 'cloud_warning';
              }
            }
          } catch (e) {
            console.log(`[LOOKAHEAD] Berechnung fehlgeschlagen: ${e}`);
          }

          // REAKTIVE STRATEGIE: Komfort-Budget = NUR echter Zähler-Export.
          // Kein "effective Export"-Trick mehr: Wir rechnen die laufende Heizleistung
          // NICHT mehr als "wird gleich frei" hinzu, sondern warten, bis der Zähler
          // tatsächlich Export zeigt. So entstehen keine Phantom-Aktivierungen, die
          // dann aus Akku/Netz gespeist werden müssen.
          const effectiveExport = gridExport; // Reaktiv: nur echter Export zählt
          let rawComfortBudget = effectiveExport - dynamicBaseloadBuffer + trendBonus + lookaheadBonus;
          if (batteryPower < 0) {
            rawComfortBudget = rawComfortBudget - Math.abs(batteryPower);
          }

          // FIX B: Battery-Full Comfort Bonus
          // Wenn Batterie voll ist (≥95%) UND nächste Stunde verlässlich Überschuss-PV kommt (≥10kW),
          // wird Komfort-Budget um den prognostizierten Überschuss erhöht. Andernfalls geht der
          // Solarstrom in die Einspeisung / Wechselrichter-Abregelung verloren.
          let batteryFullBonus = 0;
          const FULL_BATTERY_SOC = 95;
          const MIN_FORECAST_FOR_BONUS = 10000; // 10 kW
          if (
            !isNight &&
            batterySoc >= FULL_BATTERY_SOC &&
            nextHourForecastCorrected >= MIN_FORECAST_FOR_BONUS
          ) {
            // Erwarteter Überschuss = Prognose − Baseload − Sicherheits-Puffer (2kW)
            const expectedSurplus = nextHourForecastCorrected - (baseLoad || 1500) - 2000;
            batteryFullBonus = Math.max(0, Math.round(expectedSurplus));
            rawComfortBudget = rawComfortBudget + batteryFullBonus;
            console.log(`[BATTERY-FULL-BONUS] 🔋✅ SOC ${batterySoc}% ≥ ${FULL_BATTERY_SOC}%, Prognose+1h ${Math.round(nextHourForecastCorrected)}W ≥ ${MIN_FORECAST_FOR_BONUS}W → Komfort-Bonus +${batteryFullBonus}W (Überschuss würde sonst eingespeist/abgeregelt)`);
          }

          comfortBudget = Math.max(0, Math.round(rawComfortBudget));
          if (lookaheadFactor === 'cloud_warning') {
            const before = comfortBudget;
            comfortBudget = Math.round(comfortBudget * 0.7);
            console.log(`[LOOKAHEAD] ⛅ Wolkenfront erkannt (Stunde+1=${Math.round(nextHourForecastCorrected)}W < 50% × ${Math.round(currentHourForecastCorrected)}W) → Komfort ${before}W × 0.7 = ${comfortBudget}W`);
          } else if (lookaheadBonus > 0) {
            console.log(`[LOOKAHEAD] ☀️ Stabile Sonne (Stunde+1=${Math.round(nextHourForecastCorrected)}W ≥ 90% × ${Math.round(currentHourForecastCorrected)}W) → Komfort-Bonus +${lookaheadBonus}W`);
          }
          // Robustheit 1: Stale-Forecast (>1 Tag alt) → Komfort konservativ ×0.7
          if (forecastIsStale && comfortBudget > 0) {
            const beforeStale = comfortBudget;
            comfortBudget = Math.round(comfortBudget * 0.7);
            console.log(`[PV-FORECAST] Stale-Fallback: Komfort ${beforeStale}W × 0.7 = ${comfortBudget}W (konservativ wegen veralteter Prognose)`);
          }
          console.log(`[PV-Automation] PV-Budget: gridExport ${gridExport}W + heizend ${currentlyHeatingPower}W + Toleranz ${dynamicTolerance}W = ${availableBudget}W (Eco${batteryEcoReserveAllowed ? ' +Batterie-Reserve' : ''}${pvSufficientForEco ? ' +Prognose-OK' : ''}${prognoseBonus > 0 ? ` +Prognose-Bonus ${prognoseBonus}W` : ''}${batteryBuffer > 0 ? ` +Batt-Puffer ${batteryBuffer}W` : ''}${trendBonus !== 0 ? ` ${trendBonus >= 0 ? '+' : ''}${trendBonus}W Trend` : ''}) | Komfort-Budget: ${comfortBudget}W (effExport ${effectiveExport} [grid ${gridExport}+heiz ${currentlyHeatingPower}] − Baseload ${dynamicBaseloadBuffer}${trendBonus !== 0 ? ` ${trendBonus >= 0 ? '+' : ''}${trendBonus}` : ''}${lookaheadBonus > 0 ? ` +Lookahead ${lookaheadBonus}` : ''}${batteryFullBonus > 0 ? ` +BattFull ${batteryFullBonus}` : ''})`);

          // Persist für UI (parallel-heating-capacity wird nach Phase-Setup ergänzt)
          (globalThis as any).__parallelPlanCtx = {
            gridExport, dynamicBaseloadBuffer, pvTrend, trendBonus,
            lookaheadBonus, lookaheadFactor, nextHourForecastCorrected,
            ecoBudget: availableBudget, comfortBudget,
            effectiveExport, batteryFullBonus,
          };
        } else if (gridExport > 200) {
          budgetMode = 'grid_sequential';
          availableBudget = Math.max(0, gridExport);
          // Batterie-Ladereserve auch hier abziehen (gegen Heizungs-Gate)
          if (batteryPower > 0 && batterySoc < heatingMinSoc) {
            const range = Math.max(10, heatingMinSoc - 30);
            const batteryPriority = batterySoc < 30 ? 1.0 : (heatingMinSoc - batterySoc) / range;
            const batteryReserve = Math.round(batteryPower * batteryPriority);
            availableBudget = Math.max(0, availableBudget - batteryReserve);
            console.log(`[PV-Automation] 🔋 Batterie-Ladereserve (grid_seq): ${batteryReserve}W abgezogen → Budget ${Math.round(availableBudget)}W`);
          }
          comfortBudget = availableBudget;
          console.log(`[PV-Automation] Wenig PV (${pvPower}W) aber gridExport ${gridExport}W → Budget für Eco: ${availableBudget}W`);
        } else if (!afterSunset && currentWienHour >= dayWindowStartHour && pvSufficientForEco && ecoRoomsRemaining > 0 && currentHourForecastCorrected > baseLoad) {
          // Tagsüber, wenig aktueller PV-Export, aber Tagesprognose reicht für Eco
          // → Mindest-Budget aus Stunden-Prognose erlauben (sequentielles Heizen)
          budgetMode = 'grid_sequential';
          availableBudget = Math.max(0, currentHourForecastCorrected - baseLoad);
          // Batterie-Ladereserve auch hier abziehen (gegen Heizungs-Gate)
          if (batteryPower > 0 && batterySoc < heatingMinSoc) {
            const range = Math.max(10, heatingMinSoc - 30);
            const batteryPriority = batterySoc < 30 ? 1.0 : (heatingMinSoc - batterySoc) / range;
            const batteryReserve = Math.round(batteryPower * batteryPriority);
            availableBudget = Math.max(0, availableBudget - batteryReserve);
            console.log(`[PV-Automation] 🔋 Batterie-Ladereserve (forecast_seq): ${batteryReserve}W abgezogen → Budget ${Math.round(availableBudget)}W`);
          }
          comfortBudget = 0; // Kein Komfort bei wenig aktuellem Überschuss
          console.log(`[PV-Automation] ☀️ Wenig PV aktuell (${pvPower}W) aber Tagesprognose reicht → Eco-Budget aus Prognose: ${Math.round(availableBudget)}W (Stunde: ${Math.round(currentHourForecastCorrected)}W - Grundlast ${baseLoad}W)`);
        } else if (batteryEcoReserveAllowed) {
          // Nach Sunset, kein PV, aber Batterie-Reserve für Eco erlaubt
          budgetMode = 'grid_sequential';
          // Budget = was die Batterie liefern kann (typisch 2000-3000W Entladeleistung)
          const batteryDischargePower = Math.abs(batteryPower) > 0 ? Math.abs(batteryPower) : 2000;
          availableBudget = batteryDischargePower;
          comfortBudget = 0; // Kein Komfort aus Batterie!
          console.log(`[PV-Automation] 🌅 Abend-Modus: Kein PV, Batterie-Reserve für Eco → Budget ${availableBudget}W (nur Eco, kein Komfort)`);
        } else {
          budgetMode = 'grid_sequential';
          availableBudget = 0;
          comfortBudget = 0;
          console.log(`[PV-Automation] Wenig PV (${pvPower}W) und kein gridExport → KEIN Heizen, Budget=0W`);
        }
      }

      // ============= TAGESART: SONNENTAG ODER SCHLECHTER TAG (Konzept Tagesablauf §2, Stand 02.11.2026) =============
      // Uli 02.11.2026: „Eco ist das Ziel. Wir können nicht nur auf PV bauen. Wenn PV da ist, soll sie zu 100 % genutzt
      // werden.“ Fester Stromtarif, Grundlast ≈ 0 → ob die Batterie tagsüber oder nachts in die Heizung geht, ändert den
      // Netzbezug nicht. Der Batterie-Schutz hat nur an Tagen Sinn, an denen die Sonne die Batterie heute noch füllt
      // UND danach Überschuss für die Räume bleibt (Sonnentag). Sonst: Eco aus jeder Quelle, nach Priorität.
      // Überschuss = Rest-Prognose (korrigiert) − Grundlast − was die Batterie bis voll noch aufnimmt.
      const batteryNeedWhForDay = Math.max(0, batteryNeedKwh * 1000);
      const surplusAfterBatteryWh = Math.max(0, remainingPvForHeatingWh - batteryNeedWhForDay);
      let dayRatio: number | null = null;
      const dayThreshold = 1.0;
      const kiAdjust = 0;
      const kiInfo = 'aus (seit 12.11.2026)';
      if (!afterSunset) {
        dayRatio = totalEcoEnergyNeededWh > 0
          ? surplusAfterBatteryWh / totalEcoEnergyNeededWh
          : (surplusAfterBatteryWh > 0 ? 99 : 0);
        // 12.11.2026 (Bereinigung Stufe 2, Mustergedächtnis): keine Verschiebung der Schwelle mehr durch
        // best_match_today – feste Schwelle 1,0. doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md §4.3
      }
      const sunnyDay = dayRatio !== null && dayRatio >= dayThreshold;
      console.log(`[TAGESART] ${sunnyDay ? 'Sonnentag' : (afterSunset ? 'nach Sonnenuntergang' : 'schlechter Tag')} | PV-Rest ${(remainingPvForHeatingWh / 1000).toFixed(1)} kWh − Batterie ${(batteryNeedWhForDay / 1000).toFixed(1)} kWh = ${(surplusAfterBatteryWh / 1000).toFixed(1)} kWh für Räume, Eco-Bedarf ${(totalEcoEnergyNeededWh / 1000).toFixed(1)} kWh, Ratio ${dayRatio === null ? '–' : dayRatio.toFixed(2)} / Schwelle ${dayThreshold} | KI: ${kiInfo}`);

      // ============= SOC-GATE ENFORCEMENT (gehärtet) =============
      // Komfort-Hard-Lock: Komfort darf NIEMALS bei SOC < heatingMinSoc laufen — auch wenn Batterie gerade lädt.
      if (batterySoc < heatingMinSoc && comfortBudget > 0) {
        console.log(`[SOC-GATE] 🔒 Komfort hart gesperrt: SOC ${batterySoc}% < ${heatingMinSoc}% → comfortBudget ${comfortBudget}W → 0W`);
        comfortBudget = 0;
      }

      // Ladestand-Grenze (seit 01.11.2026 ohne Ausnahme, Konzept Tagesablauf §3.4):
      // SOC < heatingMinSoc → Batterie-Schutz, AUCH wenn die Batterie gerade lädt. Die Sonne gehört
      // zuerst der Batterie. Vorher galt das Gate nur bei „lädt nicht oder Netzbezug“ und öffnete
      // genau dann, wenn PV die Batterie lud – die Heizung nahm ihr die Sonne weg (01.11.2026).
      // Seit 02.11.2026: nur an Sonnentagen. Am schlechten Tag und nach Sonnenuntergang kein Batterie-Schutz –
      // dort gilt Eco nach Priorität aus jeder Quelle (Tagesmodus 'grid'), begrenzt durch max_grid_heating_power_w.
      const socGateBlocked = batterySoc < heatingMinSoc && sunnyDay;
      if (batterySoc < heatingMinSoc && !sunnyDay) {
        console.log(`[SOC-GATE] offen: SOC ${batterySoc}% < ${heatingMinSoc}%, aber kein Sonnentag → Eco aus Batterie/Netz nach Priorität`);
      }
      if (socGateBlocked) {
        if (socGateMode === 'strict') {
          // Geheizt wird nur noch aus echter Einspeisung: Sonne, die die Batterie nicht mehr aufnimmt.
          const exportBudget = gridExport >= pvThresholdOn ? gridExport + currentlyHeatingPower : 0;
          console.log(`[SOC-GATE] 🚫 STRICT: SOC ${batterySoc}% < ${heatingMinSoc}%, batteryPower=${Math.round(batteryPower)}W, Export=${Math.round(gridExport)}W → Eco-Budget ${availableBudget}W → ${exportBudget}W (nur echte Einspeisung), Komfort 0W`);
          availableBudget = exportBudget;
          comfortBudget = 0;

          // ============= AKTIVE NOTFALL-STOPS =============
          // Thermostate halten autonom ihre Sollwerte — wir MÜSSEN aktiv zurücksetzen.
          // Ziel seit 27.10.2026: Mindesttemperatur ohne PV (wait_min_temp), vorher night_temp.
          // Die Raumschleife verwendet bei aktivem Gate dasselbe Ziel (Tagesmodus 'battery_gate'),
          // dadurch kein Pingpong mehr zwischen Gate und Raumschleife.
          // Routet je nach controlMode: Cloud → Tuya-API (mit STOP-Reserve), Local → DB-Queue.
          try {
            const { data: stopRooms } = await supabase
              .from('rooms')
              .select('id, name, target_temp, eco_temp, night_temp, wait_min_temp, is_heating, automation_enabled, tuya_device_id, manual_override_until')
              .eq('automation_enabled', true);

            const nowMs = Date.now();
            const candidates = (stopRooms || []).filter(r => {
              const overrideActive = r.manual_override_until && new Date(r.manual_override_until).getTime() > nowMs;
              if (overrideActive) return false;
              if (!r.tuya_device_id) return false;
              const floorT = Math.max(5, getWaitMinTemp(r, settings) - Math.max(0, Number(settings?.battery_gate_floor_delta ?? 0)));
              const targetT = Number(r.target_temp) || 0;
              return targetT > floorT + 0.1;
            });

            if (candidates.length > 0) {
              const successIds: string[] = [];
              for (const r of candidates) {
                const waitT = Math.max(5, getWaitMinTemp(r, settings) - Math.max(0, Number(settings?.battery_gate_floor_delta ?? 0)));
                const result = await setTemperatureForMode(r.tuya_device_id!, r.id, waitT, 'stop', `Batterie-Schutz (SOC ${batterySoc}%) → Untergrenze − Abstand = ${waitT}°C`);
                if (result.success) {
                  successIds.push(r.id);
                  console.log(`[SOC-GATE-STOP] 🛑 ${r.name}: target → Notfall-Grenze ${waitT}°C (mode=${controlMode})`);
                } else {
                  console.error(`[SOC-GATE-STOP] ❌ ${r.name}: ${result.errorType} - ${result.errorMessage}`);
                }
              }
              if (successIds.length > 0) {
                await supabase
                  .from('rooms')
                  .update({ heating_paused_reason: `SOC-Gate (${batterySoc}% < ${heatingMinSoc}%)` })
                  .in('id', successIds);
              }
            } else {
              console.log(`[SOC-GATE-STOP] Keine Räume zum Stoppen (alle bereits ≤ night_temp oder im manual override)`);
            }
          } catch (e: any) {
            console.error(`[SOC-GATE-STOP] ❌ Exception:`, e?.message ?? e);
          }
        } else {
          // soft: Komfort hart auf 0.
          // Eco: Neue Aktivierungen blockieren, wenn Batterie gerade NICHT aktiv lädt
          // (verhindert Batterie-Entladung durch Eco-Heizung ohne PV-Deckung).
          comfortBudget = 0;
          if (batteryPower <= 50) {
            availableBudget = 0;
            console.log(`[SOC-GATE] ⚠️ SOFT+kein Laden: SOC ${batterySoc}% < ${heatingMinSoc}%, Batterie idle (${Math.round(batteryPower)}W) → Eco-Budget ebenfalls 0W`);
          } else {
            console.log(`[SOC-GATE] ⚠️ SOFT: SOC ${batterySoc}% < ${heatingMinSoc}%, Batterie lädt (${Math.round(batteryPower)}W) → Komfort=0W, Eco erlaubt`);
          }
        }
      }

      // 12.11.2026 (Bereinigung Stufe 2, Mustergedächtnis §4.3) entfernt: Zuschläge aus analyze-patterns –
      //   preheating_signal (Eco-Budget min 800 W / Komfort +500 W, Pre-Heat-Override je Raum),
      //   weekly_insight (Eco-Budget min 600 W vor Netzspitzen; Komfort ×0,7 bei „Eigenverbrauch < 60 %“ –
      //   die Quote kam aus daily_pattern_scores und lag bei 3,4 % statt ~97 %),
      //   best_match_today (Komfort bis +400 W, Eco-Budget min 600 W am „Winner-Tag“).
      // Die Werte schreibt analyze-patterns weiter; ai-parameter-advisor liest sie nur als Hinweis.
      // Ersatz: Heizplaner (Modus „steuern“). Zurück: git revert dieses Commits.

      // Räume nach Priorität, Effizienz und Temperatur-Defizit sortieren
      // ML-Features (energy_per_degree_wh) werden für Effizienz-Sortierung genutzt
      const now = new Date();
      // ============= RAUMMODELL / VORAUSSCHAU (02.11.2026; seit 12.11.2026 aus dem Heizmodell des Planers) =============
      // Je Raum gelernt (heizplaner, täglich 03:00, Tabelle heizmodell): ohne Heizen gilt dT/dt = −k·(T − T_außen) + c
      // (k Auskühlen [1/h], c innere Wärme/Nachbarräume [°C/h]). Ersetzt das alte Nacht-Modell (raum_abkuehlung/raum_modell),
      // das nur aus wenigen Nächten ohne Heizen gelernt hat. Mit T∞ = T_außen + c/k und der Außentemperatur der Nacht:
      //   nötig abends       = T∞ + (Eco − T∞) · e^(k·h_Nacht)      → so warm muss der Raum bei Nachtbeginn sein
      //   morgen ohne Heizen = T∞ + (T_jetzt − T∞) · e^(−k·h_bis_Morgen)
      // Wirkung: nur Anzeige (Protokoll › Raummodell) und Sortierung bei gleicher Priorität – rooms.priority ist eindeutig.
      const vorausschau = new Map<string, { k: number; c: number; prior: boolean; noetigAbends: number; morgenOhneHeizen: number; nachtBedarf: number }>();
      let vorausAussen: number | null = null;
      let vorausHNacht = 10;
      try {
        const nsT = parseTimeOfDay(settings?.night_start_time, '22:00');
        const neT = parseTimeOfDay(settings?.night_end_time, '08:00');
        const pad = (n: number) => String(n).padStart(2, '0');
        const tomorrowD = new Date(`${today}T12:00:00Z`); tomorrowD.setUTCDate(tomorrowD.getUTCDate() + 1);
        const tomorrow = tomorrowD.toISOString().slice(0, 10);
        vorausHNacht = (24 - nsT.hour - nsT.minute / 60) + neT.hour + neT.minute / 60;
        // weather_data: Wiener Ortszeit als UTC gespeichert
        const { data: wRows } = await supabase
          .from('weather_data')
          .select('temperature_c')
          .gte('timestamp', `${today}T${pad(nsT.hour)}:${pad(nsT.minute)}:00Z`)
          .lt('timestamp', `${tomorrow}T${pad(neT.hour)}:${pad(neT.minute)}:00Z`);
        const temps = (wRows || []).map((w: any) => Number(w.temperature_c)).filter((x: number) => Number.isFinite(x));
        vorausAussen = temps.length > 0 ? temps.reduce((a: number, b: number) => a + b, 0) / temps.length : null;
        const { data: modell } = await supabase.from('heizmodell').select('room_id, param, prior');
        const nowWienH = currentWienHour;
        const hBisMorgen = (24 - nowWienH) + neT.hour;
        if (vorausAussen !== null) {
          for (const m of (modell || []) as any[]) {
            // Seit 13.11.2026 (param.v = 2) kühlen Raumluft und Estrich gemeinsam aus: wirksame Rate k / (1 + r),
            // Ziel T∞ = T_außen + c/k (doc/FIX-PLANER-MODELL-2026-11-13.md).
            const kRoh = Number(m.param?.k);
            const k = m.param?.v === 2 ? kRoh / (1 + (Number(m.param?.r) || 0)) : kRoh;
            const c = (Number(m.param?.c) || 0) * (k / (kRoh || 1));
            if (!Number.isFinite(k) || k <= 0) continue;
            const room = rooms.find((r: any) => r.id === m.room_id);
            if (!room) continue;
            const eco = Number(room.eco_temp) || Number(settings?.eco_temp) || 19;
            const cur = Number(room.current_temp) || 0;
            const tInf = vorausAussen + c / k;
            const noetig = tInf + (eco - tInf) * Math.exp(k * vorausHNacht);
            const morgen = cur > 0 ? tInf + (cur - tInf) * Math.exp(-k * hBisMorgen) : NaN;
            vorausschau.set(room.id, {
              k, c, prior: m.prior === true,
              noetigAbends: Math.round(noetig * 10) / 10,
              morgenOhneHeizen: Math.round(morgen * 10) / 10,
              nachtBedarf: cur > 0 ? Math.round((noetig - cur) * 10) / 10 : 0,
            });
          }
        }
        console.log(`[VORAUSSCHAU] Nacht ${vorausHNacht.toFixed(1)} h, außen Ø ${vorausAussen === null ? '–' : vorausAussen.toFixed(1)} °C, Modell für ${vorausschau.size}/${rooms.length} Räume`);
        for (const r of rooms) {
          const v = vorausschau.get(r.id);
          if (v) console.log(`[VORAUSSCHAU] ${r.name}: abends nötig ${v.noetigAbends} °C für Eco am Morgen, ohne Heizen morgen ${v.morgenOhneHeizen} °C, Nachtbedarf ${v.nachtBedarf >= 0 ? '+' : ''}${v.nachtBedarf} °C (k ${v.k}, c ${v.c}${v.prior ? ', Modell angelehnt' : ''})`);
        }
        await supabase.from('system_settings').upsert({
          key: 'raum_vorausschau',
          value: {
            computed_at: new Date().toISOString(),
            quelle: 'heizmodell',
            aussen_nacht: vorausAussen === null ? null : Math.round(vorausAussen * 10) / 10,
            stunden_nacht: Math.round(vorausHNacht * 10) / 10,
            rooms: rooms.map((r: any) => ({ room_id: r.id, name: r.name, current: r.current_temp, eco: r.eco_temp, ...(vorausschau.get(r.id) ?? {}) })),
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      } catch (e) {
        console.warn('[VORAUSSCHAU] nicht verfügbar (SQL 18 noch nicht ausgeführt?):', e);
      }

      const roomsWithPriority = rooms.map(room => {
        const ecoTemp = room.eco_temp || settings?.eco_temp || 19;
        const comfortTemp = room.comfort_temp || settings?.comfort_temp || 21;
        const currentTemp = room.current_temp || ecoTemp;
        const tempDeficit = ecoTemp - currentTemp;
        const heatingPower = room.heating_power_w || room.calculated_power_w || 800;
        
        // ML-Features: energy_per_degree_wh für diesen Raum nachschlagen
        const mlFeature = latestMlFeatures.find((f: any) => f.room_id === room.id);
        const energyPerDegreeWh = (mlFeature as any)?.energy_per_degree_wh || null;
        
        // Geschätzte Dauer bis Ziel (in Minuten)
        const tempToTarget = Math.max(0, comfortTemp - currentTemp);
        const estimatedDurationMin = energyPerDegreeWh && heatingPower > 0
          ? (energyPerDegreeWh * tempToTarget) / heatingPower * 60
          : null;
        const estimatedEnergyWh = energyPerDegreeWh
          ? energyPerDegreeWh * tempToTarget
          : null;
        
        // Wartezeit seit letzter Heizung
        const lastEnd = room.last_heating_end ? new Date(room.last_heating_end) : null;
        const waitTimeMinutes = lastEnd ? (now.getTime() - lastEnd.getTime()) / (1000 * 60) : 999;
        
        // Aktuelle Heizdauer
        const lastStart = room.last_heating_start ? new Date(room.last_heating_start) : null;
        const isCurrentlyHeating = room.is_heating === true;
        const heatingDurationMinutes = isCurrentlyHeating && lastStart ? 
          (now.getTime() - lastStart.getTime()) / (1000 * 60) : 0;
        
        // Logging: Effizienz-Info pro Raum
        if (energyPerDegreeWh && tempToTarget > 0) {
          console.log(`[PV-Automation] ${room.name}: braucht ~${estimatedEnergyWh?.toFixed(0)} Wh für +${tempToTarget.toFixed(1)}°C (${energyPerDegreeWh.toFixed(0)} Wh/°C), geschätzte Dauer: ${estimatedDurationMin?.toFixed(0)} Min bei ${heatingPower}W`);
        }
        
        
        return {
          room,
          priority: room.priority || 2,
          tempDeficit,
          heatingPower,
          energyPerDegreeWh,
          estimatedDurationMin,
          waitTimeMinutes,
          isCurrentlyHeating,
          heatingDurationMinutes,
          nachtBedarf: vorausschau.get(room.id)?.nachtBedarf ?? null,
        };
      });
      
      // Sortierung: 1. Priorität (eindeutig je Raum, Index rooms_priority_unique – die weiteren Schlüssel greifen
      // daher nur, falls zwei Räume je dieselbe Priorität bekommen), 2. Temperatur-Defizit (>0.5°C Unterschied),
      // 3. Nachtbedarf, 4. Effizienz (energy_per_degree_wh), 5. Wartezeit (längste zuerst als Tiebreaker)
      roomsWithPriority.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (Math.abs(a.tempDeficit - b.tempDeficit) > 0.5) return b.tempDeficit - a.tempDeficit;
        // Raummodell (02.11.2026): größerer Nachtbedarf zuerst – dieser Raum braucht die PV-Wärme heute Nacht am meisten
        if (a.nachtBedarf !== null && b.nachtBedarf !== null && Math.abs(a.nachtBedarf - b.nachtBedarf) > 0.3) {
          return b.nachtBedarf - a.nachtBedarf;
        }
        const aEff = a.energyPerDegreeWh || 99999;
        const bEff = b.energyPerDegreeWh || 99999;
        if (Math.abs(aEff - bEff) > 100) return aEff - bEff;
        return b.waitTimeMinutes - a.waitTimeMinutes;
      });
      
      // Sortierungs-Ergebnis loggen
      const heatingOrder = roomsWithPriority.map((rp, idx) => 
        `  ${idx + 1}. ${rp.room.name} (Prio ${rp.priority}, Defizit ${rp.tempDeficit.toFixed(1)}°C, Nachtbedarf ${rp.nachtBedarf ?? '–'}°C, ${rp.energyPerDegreeWh ? rp.energyPerDegreeWh + ' Wh/°C' : 'keine ML-Daten'}, ${rp.heatingPower}W, ${rp.isCurrentlyHeating ? 'HEIZT' : 'wartet ' + Math.round(rp.waitTimeMinutes) + ' Min'})`
      ).join('\n');
      console.log(`[PV-Automation] Heiz-Reihenfolge (${roomsWithPriority.length} Räume):\n${heatingOrder}`);
      
      // Tracking für Budget-Verbrauch
      let usedBudget = 0;
      let tolerantSavedCalls = 0;
      const roomBudgetStatus = new Map<string, { 
        allowedToHeat: boolean; 
        reason: string; 
        shouldRotate: boolean;
        targetLevel: 'eco' | 'comfort' | 'super_comfort' | 'none';
        // true = Raum hat echtes Heiz-Budget (PV/Mikro/Toleranz) bekommen.
        // false/fehlt = kein Budget → Ziel kommt aus dem Tagesmodus (Konzept 27.10.2026)
        budgeted?: boolean;
      }>();
      
      // ============= 2-PHASEN BUDGET-ZUWEISUNG =============
      // Phase 1: Eco-Runde — alle Räume unter eco auf eco bringen
      // Phase 2: Komfort-Runde — mit Restbudget Räume auf komfort bringen
      // Keine Batterie-Bedingung! Einzige Bedingung: Reicht das PV-Budget?
      
      // Erst Rotation/Pause prüfen für alle Räume
      for (const rp of roomsWithPriority) {
        if (rp.isCurrentlyHeating) {
          const shouldRotate = rp.heatingDurationMinutes >= roomRotationMinutes && 
            roomsWithPriority.some(other => {
              if (other.isCurrentlyHeating || other.tempDeficit <= 0.5 || other.waitTimeMinutes < minRoomPauseMinutes) return false;
              if (other.priority < rp.priority) return true;
              if (other.priority === rp.priority) {
                const otherEff = other.energyPerDegreeWh || 99999;
                const rpEff = rp.energyPerDegreeWh || 99999;
                return otherEff <= rpEff;
              }
              return false;
            });
          
          if (shouldRotate) {
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: false,
              reason: `Rotation nach ${Math.round(rp.heatingDurationMinutes)} Min`,
              shouldRotate: true,
              targetLevel: 'none'
            });
            continue;
          }
        }
        
        if (!rp.isCurrentlyHeating && rp.waitTimeMinutes < minRoomPauseMinutes && rp.room.last_heating_end) {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: false,
            reason: `Pause: noch ${Math.ceil(minRoomPauseMinutes - rp.waitTimeMinutes)} Min`,
            shouldRotate: false,
            targetLevel: 'none'
          });
        }
      }

      // ============= PARALLEL-KAPAZITÄTS-VORABBERECHNUNG =============
      // Zeigt VOR Phase 1, wie viele Räume mit dem aktuellen Budget gleichzeitig hochgeheizt
      // werden können — getrennt für Eco und Komfort. Persistiert für UI-Tooltip.
      try {
        const ecoCandidates: Array<{room_id:string, name:string, power_w:number}> = [];
        const comfortCandidates: Array<{room_id:string, name:string, power_w:number}> = [];
        for (const rp of roomsWithPriority) {
          if (roomBudgetStatus.has(rp.room.id)) continue;
          const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
          const comfortTemp = rp.room.comfort_temp || settings?.comfort_temp || 21;
          const cur = rp.room.current_temp || 0;
          if (cur < ecoTemp - 0.3) {
            ecoCandidates.push({ room_id: rp.room.id, name: rp.room.name, power_w: rp.heatingPower });
          } else if (cur < comfortTemp - 0.3) {
            comfortCandidates.push({ room_id: rp.room.id, name: rp.room.name, power_w: rp.heatingPower });
          }
        }
        let ecoFit = 0, ecoSum = 0;
        const plannedEco: string[] = [];
        for (const c of ecoCandidates) {
          if (ecoSum + c.power_w <= availableBudget) { ecoSum += c.power_w; ecoFit++; plannedEco.push(c.room_id); }
        }
        // Komfort-Plan nur wenn Eco-Plan vollständig (sequentielle 2-Phasen-Strategie)
        const ecoFitsAll = ecoCandidates.length === ecoFit;
        let comfortFit = 0, comfortSum = 0;
        const plannedComfort: string[] = [];
        if (ecoFitsAll) {
          for (const c of comfortCandidates) {
            if (comfortSum + c.power_w <= comfortBudget) { comfortSum += c.power_w; comfortFit++; plannedComfort.push(c.room_id); }
          }
        }
        const ctx = (globalThis as any).__parallelPlanCtx || {};
        const planPayload = {
          computed_at: new Date().toISOString(),
          grid_export_w: ctx.gridExport ?? gridExport,
          baseload_buffer_w: ctx.dynamicBaseloadBuffer ?? 0,
          trend_w_per_5min: ctx.pvTrend ?? pvTrend,
          trend_bonus_w: ctx.trendBonus ?? 0,
          lookahead_bonus_w: ctx.lookaheadBonus ?? 0,
          lookahead_factor: ctx.lookaheadFactor ?? 'neutral',
          next_hour_forecast_w: Math.round(ctx.nextHourForecastCorrected ?? 0),
          eco_budget_w: availableBudget,
          comfort_budget_w: comfortBudget,
          eco_candidates: ecoCandidates,
          comfort_candidates: comfortCandidates,
          max_parallel_eco: ecoFit,
          max_parallel_comfort: comfortFit,
          planned_eco_room_ids: plannedEco,
          planned_comfort_room_ids: plannedComfort,
          budget_mode: budgetMode,
        };
        await supabase.from('system_settings').upsert(
          { key: 'parallel_heating_capacity', value: planPayload, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        console.log(`[PARALLEL-PLAN] Export ${planPayload.grid_export_w}W, Puffer ${planPayload.baseload_buffer_w}W, Trend ${planPayload.trend_bonus_w >= 0 ? '+' : ''}${planPayload.trend_bonus_w}W, Lookahead +${planPayload.lookahead_bonus_w}W → Eco-Budget ${availableBudget}W (${ecoFit}/${ecoCandidates.length} Räume parallel), Komfort-Budget ${comfortBudget}W (${comfortFit}/${comfortCandidates.length} Räume parallel)`);
      } catch (e) {
        console.log(`[PARALLEL-PLAN] Persist fehlgeschlagen: ${e}`);
      }

      // Phase 1: ECO-Runde — Budget-basierte parallele Aktivierung nach Priorität (1→12)
      // currentlyHeatingPower ist bereits in availableBudget enthalten (siehe baseBudget Berechnung).
      // Räume die bereits warm/aktiv sind werden im Action-Loop via shouldSkip übersprungen (kein Tuya-Call).
      // Räume die nicht ins Budget passen werden als [QUEUE] geloggt — der nächste 2-min Heartbeat aktiviert sie
      // sobald Budget frei wird (anderer Raum fertig oder mehr Sonne).
      console.log(`[PV-Automation] === PHASE 1: ECO-RUNDE === Budget=${availableBudget}W (gridExport=${gridExport}W + heizend=${currentlyHeatingPower}W + Boni)`);
      for (const rp of roomsWithPriority) {
        if (roomBudgetStatus.has(rp.room.id)) continue; // Rotation/Pause
        
        const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
        const currentTemp = rp.room.current_temp || 0;
        
        // (27.10.2026) Phase 1 nur für Räume, die wirklich unter Eco liegen. Warme Räume mit
        // niedrigem Sollwert brauchen kein Budget – sie halten die Mindesttemperatur ohne PV
        // (Tagesmodus). Vorher: Vergleich mit night_temp und Sprung „Eco=Nacht → Komfort“.
        if (currentTemp < ecoTemp - 0.3) {
          // PV-Hysterese: Neue Aktivierungen erst ab pv_surplus_threshold_on; laufende Räume erst unter threshold_off stoppen.
          const hysteresisBlocksStart = !rp.isCurrentlyHeating && gridExport < pvThresholdOn;
          const hysteresisAllowsContinue = rp.isCurrentlyHeating && gridExport >= pvThresholdOff;
          if (hysteresisBlocksStart) {
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: false,
              reason: `Hysterese: Export ${gridExport}W < ${pvThresholdOn}W (Ein-Schwelle)`,
              shouldRotate: false,
              targetLevel: 'none'
            });
            console.log(`[HYSTERESIS] ${rp.room.name}: Start blockiert (Export ${gridExport}W < On=${pvThresholdOn}W)`);
            continue;
          }
          // Raum braucht eco
          if (usedBudget + rp.heatingPower <= availableBudget) {
            usedBudget += rp.heatingPower;
            const remaining = availableBudget - usedBudget;
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: true,
              reason: `Eco-Phase (${usedBudget}/${availableBudget}W)`,
              shouldRotate: false,
              targetLevel: 'eco',
              budgeted: true
            });
            console.log(`[ACTIVATE] Prio ${rp.priority} ${rp.room.name} → eco ${ecoTemp}°C (${currentTemp.toFixed(1)}°C, Bedarf ${rp.heatingPower}W, Budget-Rest ${remaining}W)${rp.isCurrentlyHeating ? ' [heizt bereits → kein neuer Call]' : ''}`);
          } else {
            // NEU: Tolerante Deaktivierung — bereits heizende Räume nicht bei kurzem Budget-Einbruch abschalten
            const overshoot = (usedBudget + rp.heatingPower) - availableBudget;
            const overshootTolerable = overshoot <= Math.max(300, Math.round(rp.heatingPower * 0.4));
            const trendStable = pvTrend >= -200;
            const tolerate = tolerantDeactivationEnabled
              && rp.isCurrentlyHeating
              && pvSufficientForEco
              && trendStable
              && overshootTolerable
              && !socGateBlocked;  // Gate aktiv → keine Toleranz mehr (schützt Batterie)

            if (tolerate) {
              usedBudget += rp.heatingPower;
              tolerantSavedCalls++;
              roomBudgetStatus.set(rp.room.id, {
                allowedToHeat: true,
                reason: `Eco-Toleranz (Overshoot ${overshoot}W, Trend ${pvTrend}W, Prognose ok)`,
                shouldRotate: false,
                targetLevel: 'eco',
                budgeted: true
              });
              console.log(`[TOLERANT-DEACTIVATION] ${rp.room.name}: Heizt weiter trotz Budget-Overshoot ${overshoot}W (Trend ${pvTrend}W ≥ -200, Prognose reicht, ${usedBudget}/${availableBudget}W)`);
            } else {
              const stillNeeded = (usedBudget + rp.heatingPower) - availableBudget;
              roomBudgetStatus.set(rp.room.id, {
                allowedToHeat: false,
                reason: `Eco kein Budget: ${usedBudget}+${rp.heatingPower}>${availableBudget}W`,
                shouldRotate: false,
                targetLevel: 'none'
              });
              console.log(`[QUEUE] Prio ${rp.priority} ${rp.room.name} wartet auf Budget (Bedarf ${rp.heatingPower}W, fehlen ${stillNeeded}W) — wird beim nächsten Heartbeat erneut geprüft`);
            }
          }
        }
        // Räume >= eco werden in Phase 1 nicht verarbeitet (kommen in Phase 2)
      }
      
      // Phase 1b: Räume die bereits >= eco sind aber target_temp noch auf night stehen → eco setzen (kein Extra-Budget)
      for (const rp of roomsWithPriority) {
        if (roomBudgetStatus.has(rp.room.id)) continue;
        const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
        const currentTemp = rp.room.current_temp || 0;
        
        // Raum ist warm genug für eco, Sollwert liegt noch darunter (Nacht/Mindesttemperatur).
        // (27.10.2026) Ohne Budget: Ziel kommt aus dem Tagesmodus (budgeted fehlt bewusst).
        if (currentTemp >= ecoTemp - 0.3 && rp.room.target_temp != null && rp.room.target_temp < ecoTemp - 0.3) {
          // Kein Budget nötig — Raum ist bereits warm, nur target_temp muss aktualisiert werden
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: true,
            reason: `Eco-Aktivierung (bereits ${currentTemp.toFixed(1)}°C, target war ${rp.room.target_temp}°C)`,
            shouldRotate: false,
            targetLevel: 'eco'
          });
          console.log(`[PV-Automation] Phase 1b: ${rp.room.name} → eco-Aktivierung (${currentTemp.toFixed(1)}°C >= ${ecoTemp}°C, target war ${rp.room.target_temp}°C)`);
        }
      }
      
      // ============= MIKRO-BUDGET MODUS (mit Soft-Rotation) =============
      // Wenn ecoBudget > 0, aber kleiner als kleinster Raum → rotierend einen Raum für N Min aktivieren.
      // Nach micro_heat_duration_min wird der aktive Mikro-Raum aktiv beendet (setpoint = night_temp).
      // Dann läuft Cooldown (room_rotation_minutes), dann nächster Raum.
      // Batterie SOC >= settings.micro_budget_min_battery_soc dient als Puffer.
      const microBudgetEnabled = settings?.micro_budget_enabled !== false; // default true
      // Mikro-Budget entlädt aktiv → SOC-Floor = heating_min_battery_soc + 5 (single source of truth)
      // micro_budget_min_battery_soc wird ignoriert (DB-Feld bleibt für Backwards-Compat).
      const microMinSocBase = heatingMinSoc + 5;
      const microMinSoc = Math.max(microMinSocBase, batteryReserveSoc + 20, heatingMinSoc);
      const microHeatDuration = settings?.micro_heat_duration_min ?? 5;

      // ── Soft-Rotation: aktiven Mikro-Raum nach Zeit-Limit beenden ──
      if (microBudgetEnabled) {
        const { data: lastMicroSetting } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'last_micro_rotation_at')
          .maybeSingle();
        const microValue = lastMicroSetting?.value as { ts?: string; room_id?: string; room_name?: string; ended?: boolean } | undefined;
        const activeMicroRoomId = microValue?.room_id;
        const activeMicroStart = microValue?.ts;
        const activeMicroEnded = microValue?.ended === true;

        if (activeMicroRoomId && activeMicroStart && !activeMicroEnded) {
          const minutesActive = (Date.now() - new Date(activeMicroStart).getTime()) / 60000;
          if (minutesActive >= microHeatDuration) {
            const microRoom = rooms.find(r => r.id === activeMicroRoomId);
            const hasOverride = microRoom?.manual_override_until && new Date(microRoom.manual_override_until).getTime() > Date.now();
            if (microRoom && !hasOverride) {
              // (27.10.2026) Ende der Mikro-Heizung: zurück auf Mindesttemperatur ohne PV (vorher night_temp)
              const nightTemp = getWaitMinTemp(microRoom, settings);
              if (microRoom.tuya_device_id) {
                const result = await setTemperatureForMode(microRoom.tuya_device_id, microRoom.id, nightTemp, 'stop', `Mikro-Heizen beendet → Untergrenze ${nightTemp}°C`);
                if (!result.success) {
                  console.error(`[MICRO-ROTATION] ❌ ${microRoom.name}: setTemperatureForMode failed - ${result.errorType}: ${result.errorMessage}`);
                }
              } else {
                console.error(`[MICRO-ROTATION] ❌ ${microRoom.name}: kein tuya_device_id`);
              }
              await supabase.from('rooms').update({
                target_temp: nightTemp,
                pv_auto_active: false,
                pv_auto_last_change: new Date().toISOString(),
                heating_paused_reason: `Mikro-Rotation beendet nach ${microHeatDuration}min`
              }).eq('id', microRoom.id);
              await supabase.from('system_settings').upsert({
                key: 'last_micro_rotation_at',
                value: { ts: activeMicroStart, room_id: activeMicroRoomId, room_name: microValue?.room_name, ended: true, ended_at: new Date().toISOString() }
              }, { onConflict: 'key' });
              console.log(`[MICRO-ROTATION] ${microRoom.name} nach ${minutesActive.toFixed(1)}min beendet (Setpoint→${nightTemp}°C, mode=${controlMode})`);
            } else if (hasOverride) {
              console.log(`[MICRO-ROTATION] ${microRoom?.name} hat Manual Override → Beendigung übersprungen`);
            }
          } else {
            console.log(`[MICRO-ROTATION] ${microValue?.room_name} läuft noch (${minutesActive.toFixed(1)}/${microHeatDuration}min)`);
          }
        }
      }

      if (microBudgetEnabled && availableBudget > 0) {
        // Kandidaten: Räume die noch kein Budget bekommen haben, < eco sind, kein Override
        const microCandidates = roomsWithPriority.filter(rp => {
          const status = roomBudgetStatus.get(rp.room.id);
          if (status?.allowedToHeat) return false; // schon allokiert
          if (status?.shouldRotate) return false; // rotiert gerade aus
          const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
          const currentTemp = rp.room.current_temp || 0;
          if (currentTemp >= ecoTemp - 0.2) return false; // schon warm genug
          if (rp.room.manual_override_until && new Date(rp.room.manual_override_until).getTime() > Date.now()) return false;
          if (rp.isCurrentlyHeating) return false;
          if (rp.waitTimeMinutes < minRoomPauseMinutes && rp.room.last_heating_end) return false;
          return true;
        });

        if (microCandidates.length > 0) {
          const minRoomPower = Math.min(...microCandidates.map(rp => rp.heatingPower));

          if (availableBudget < minRoomPower && batterySoc >= microMinSoc) {
            // Globaler Cooldown: läuft erst ab Beendigung des letzten Mikro-Raums (ended_at).
            // Wenn noch nicht beendet → kein neuer Raum (alter heizt noch).
            const { data: lastMicroSetting } = await supabase
              .from('system_settings')
              .select('value')
              .eq('key', 'last_micro_rotation_at')
              .maybeSingle();
            const microValue = lastMicroSetting?.value as { ts?: string; ended?: boolean; ended_at?: string } | undefined;
            // Cooldown-Anker = IMMER ein Beendigungszeitpunkt (echt oder rechnerisch ts+microHeatDuration).
            // Verhindert dass die rohe Aktivierungszeit als Anker dient.
            let cooldownAnchor: string | undefined;
            if (microValue?.ended && microValue.ended_at) {
              cooldownAnchor = microValue.ended_at;
            } else if (microValue?.ts) {
              cooldownAnchor = new Date(new Date(microValue.ts).getTime() + microHeatDuration * 60000).toISOString();
            }
            const stillRunning = microValue?.ts && microValue?.ended !== true;
            const minutesSinceLastMicro = cooldownAnchor
              ? (Date.now() - new Date(cooldownAnchor).getTime()) / 60000
              : 99999;

            // Hysterese-Guard: Mikro-Budget darf keine neuen Räume starten wenn gridExport < pvThresholdOn
            // (identische Logik wie Phase-1-Hysterese — kein Bypass durch Mikro-Budget-Pfad).
            const pvThresholdOnLocal = settings?.pv_surplus_threshold_on ?? DEFAULT_PV_SURPLUS_THRESHOLD_ON;
            if (gridExport < pvThresholdOnLocal) {
              console.log(`[MICRO-BUDGET] Hysterese blockiert: gridExport ${gridExport}W < On-Schwelle ${pvThresholdOnLocal}W → kein Mikro-Budget-Start`);
            } else if (stillRunning) {
              console.log(`[MICRO-BUDGET] Vorheriger Mikro-Raum heizt noch — kein neuer Raum`);
            } else if (minutesSinceLastMicro >= roomRotationMinutes) {
              // Wähle Raum: höchste Prio (kleinste Zahl) + größtes Defizit + längste Pause
              const picked = [...microCandidates].sort((a, b) => {
                const aEco = a.room.eco_temp || settings?.eco_temp || 19;
                const bEco = b.room.eco_temp || settings?.eco_temp || 19;
                const aPause = Date.now() - new Date(a.room.pv_auto_last_change || 0).getTime();
                const bPause = Date.now() - new Date(b.room.pv_auto_last_change || 0).getTime();
                const aScore = (12 - (a.priority || 12)) * 100
                  + (aEco - (a.room.current_temp || 0)) * 10
                  + aPause / 60000;
                const bScore = (12 - (b.priority || 12)) * 100
                  + (bEco - (b.room.current_temp || 0)) * 10
                  + bPause / 60000;
                return bScore - aScore;
              })[0];

              const pickedEco = picked.room.eco_temp || settings?.eco_temp || 19;
              roomBudgetStatus.set(picked.room.id, {
                allowedToHeat: true,
                reason: `Mikro-Budget (Budget ${availableBudget}W < min ${minRoomPower}W, SOC ${batterySoc}%, ${microHeatDuration}min)`,
                shouldRotate: false,
                targetLevel: 'eco',
                budgeted: true
              });
              usedBudget += picked.heatingPower;

              // Setze globalen Cooldown — ended:false → Soft-Rotation kann ihn nach microHeatDuration beenden
              await supabase.from('system_settings').upsert({
                key: 'last_micro_rotation_at',
                value: { ts: new Date().toISOString(), room_id: picked.room.id, room_name: picked.room.name, ended: false }
              }, { onConflict: 'key' });

              console.log(`[MICRO-BUDGET] ${picked.room.name} aktiviert (Budget=${availableBudget}W < ${minRoomPower}W, SOC=${batterySoc}%, Dauer=${microHeatDuration}min)`);
            } else {
              console.log(`[MICRO-BUDGET] Cooldown aktiv (${minutesSinceLastMicro.toFixed(1)}/${roomRotationMinutes} min seit Beendigung) — überspringe Rotation`);
            }
          } else if (availableBudget < minRoomPower) {
            console.log(`[MICRO-BUDGET] Pausiert: SOC ${batterySoc}% < ${microMinSoc}% (kein Batterie-Puffer)`);
          }
        }
      }

      // ============= PHASE-1-GATE: Eco vollständig? =============
      // Strikt sequentielle Strategie: Phase 2 (Komfort) startet erst, wenn JEDER Raum
      // entweder bereits ≥ eco_temp − 0.3 ist, in Phase 1 aktiviert wurde, oder durch
      // Pause/Rotation/Override blockiert ist. Räume die Eco anstreben aber kein Budget
      // bekommen haben → Phase 2 wartet bis zum nächsten Heartbeat.
      // Robustheit 2: Stale Räume (Thermostat offline > 2h) blockieren Phase 2 NICHT
      const STALE_ROOM_THRESHOLD_MS = 2 * 60 * 60 * 1000;
      const isRoomStale = (r: any) => {
        const sync = r?.last_thermostat_sync;
        if (!sync) return true;
        return (Date.now() - new Date(sync).getTime()) > STALE_ROOM_THRESHOLD_MS;
      };
      const phase1Complete = roomsWithPriority.every(rp => {
        if (isRoomStale(rp.room)) {
          const sync = rp.room.last_thermostat_sync;
          const ageMin = sync ? Math.round((Date.now() - new Date(sync).getTime()) / 60000) : -1;
          console.log(`[PHASE-1] Skipped stale room ${rp.room.name} (last sync ${ageMin}min ago)`);
          return true;
        }
        const ecoTempCheck = rp.room.eco_temp || settings?.eco_temp || 19;
        const curCheck = rp.room.current_temp || 0;
        if (curCheck >= ecoTempCheck - 0.3) return true; // bereits warm
        const status = roomBudgetStatus.get(rp.room.id);
        if (status && !status.allowedToHeat) return true; // blockiert (Pause/Override/Rotation)
        if (status?.targetLevel === 'eco' && status.allowedToHeat) return true; // in Phase 1 aktiviert
        return false; // Raum will Eco, hat aber kein Budget bekommen → blockiert Phase 2
      });
      console.log(`[PHASE-GATE] Phase 1 vollständig: ${phase1Complete}`);

      // ============= PHASE 2: KOMFORT-RUNDE (nur wenn Phase 1 fertig) =============
      const effectiveComfortBudget = comfortBudget;
      let usedComfortBudget = usedBudget;
      const budgetAfterEco = effectiveComfortBudget - usedBudget;

      // Heutiger Tagesstart in Wien (für Sättigungs-Reset-Check)
      const todayWienStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' }); // YYYY-MM-DD in Wien-Zeit
      const [twY, twM, twD] = todayWienStr.split('-').map(Number);
      const todayWienStart = new Date(twY, twM - 1, twD, 0, 0, 0, 0);

      // ============= KOMFORT IST DAS MAXIMUM (07.11.2026, Uli) =============
      // Der eigene Wert „Estrich laden bis“ / „Batterie voll“ (rooms.pv_boost_max_temp, aus der Lovable-Zeit)
      // ist abgeschafft. Bei PV-Überschuss: erst alle Räume auf Eco, dann Raum für Raum nach Priorität auf Komfort.
      // Ein Raum auf Komfort geht zurück auf Eco (Estrich speichert), damit der Überschuss zum nächsten Raum geht.
      // Ausnahme NUR, wenn ALLE Räume auf Komfort sind und die Batterie voll ist und trotzdem eingespeist wird:
      // dann bleiben die Räume auf Komfort statt zurück auf Eco. Über Komfort geht es nur über die
      // Super-Komfort-Deckelung weiter unten (ebenfalls nur, wenn alle Räume auf Komfort sind).
      const alleAufKomfort = roomsWithPriority.length > 0 && roomsWithPriority.every((rp) => {
        const ct = rp.room.comfort_temp || settings?.comfort_temp || 21;
        return (rp.room.current_temp || 0) >= ct - 0.3;
      });
      const batteryFullOverride =
        !isNight &&
        alleAufKomfort &&
        (batterySoc ?? 0) >= 95 &&
        gridExport >= 3000 &&
        (expectedPvKwh || 0) >= 5;
      if (batteryFullOverride) {
        console.log(`[ALLE-AUF-KOMFORT] 🔋✅ alle Räume auf Komfort, SOC ${batterySoc}% ≥ 95%, Export ${gridExport}W ≥ 3000W → Räume bleiben auf Komfort statt Eco`);
      }

      // Helper: Ist Raum heute komfort-gesättigt? (current_temp noch >= eco_temp - 0.5)
      const isComfortSaturated = (rp: typeof roomsWithPriority[0]) => {
        const sat = (rp.room as any).comfort_saturated_at;
        if (!sat) return false;
        const satTime = new Date(sat).getTime();
        if (satTime < todayWienStart.getTime()) return false; // Sättigung vom Vortag → ungültig
        const ecoT = rp.room.eco_temp || settings?.eco_temp || 19;
        const cur = rp.room.current_temp || 0;
        // Alle Räume auf Komfort + Batterie voll + Einspeisung: Raum bleibt auf Komfort (nicht gesättigt)
        if (batteryFullOverride) return false;
        return cur >= ecoT - 0.5; // Hysterese: erst unter eco-0.5°C wieder Komfort-fähig
      };

      // ============= KOMFORT-SÄTTIGUNG: Räume bei Komfort → zurück auf Eco-Setpoint =============
      // Sobald current_temp >= comfort_temp und target_temp == comfort: 1 Call zurück auf eco,
      // markiere als gesättigt. Estrich-Speicher gibt Wärme weiter ab; Thermostat heizt erst
      // wieder, wenn current_temp < eco_temp.
      for (const rp of roomsWithPriority) {
        if (roomBudgetStatus.has(rp.room.id)) continue;
        const comfortTemp = rp.room.comfort_temp || settings?.comfort_temp || 21;
        const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
        const currentTemp = rp.room.current_temp || 0;
        const currentTarget = Number(rp.room.target_temp) || 0;
        // Bedingung: Komfort erreicht UND Setpoint steht auf Komfort UND noch nicht gesättigt
        const reachedComfort = currentTemp >= comfortTemp - 0.1;
        const setpointIsComfort = currentTarget >= comfortTemp - 0.1;
        const alreadySaturated = isComfortSaturated(rp);
        // Alle Räume auf Komfort + Batterie voll + Einspeisung: NICHT auf Eco zurückfallen
        const overrideActive = batteryFullOverride;
        if (reachedComfort && setpointIsComfort && !alreadySaturated && !overrideActive) {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: false, // → führt zu deactivate auf eco_temp im Action-Loop
            reason: `Komfort-Sättigung: ${currentTemp.toFixed(1)}°C ≥ ${comfortTemp}°C → Eco (Estrich speichert)`,
            shouldRotate: false,
            targetLevel: 'eco',
          });
          // Markiere als gesättigt in DB (zusammen mit dem Tuya-Call der gleich folgt)
          await supabase.from('rooms').update({
            comfort_saturated_at: new Date().toISOString(),
          }).eq('id', rp.room.id);
          console.log(`[KOMFORT-SAT] ${rp.room.name}: ${currentTemp.toFixed(1)}°C ≥ ${comfortTemp}°C → Setpoint ${ecoTemp}°C, Estrich-Speicher aktiv`);
        } else if (reachedComfort && setpointIsComfort && overrideActive) {
          console.log(`[ALLE-AUF-KOMFORT] ${rp.room.name}: ${currentTemp.toFixed(1)}°C ≥ ${comfortTemp}°C, halte Komfort-Setpoint (alle Räume auf Komfort, Batterie voll)`);
        }
      }

      // Abwesend (30.10.2026): Komfort mit echtem PV-Überschuss wie bei Anwesenheit – Überschuss wird im Estrich gespeichert.
      if (phase1Complete) {
        console.log(`[PV-Automation] === PHASE 2: KOMFORT-RUNDE === comfortBudget=${effectiveComfortBudget}W, bereits verwendet=${usedBudget}W, Rest=${budgetAfterEco}W (nur echter gridExport, kein Prognose-/Trend-/Batterie-Bonus)`);
        for (const rp of roomsWithPriority) {
          // Robustheit 2: Stale Räume (Thermostat offline) bekommen keinen Komfort-Push (Quota schonen)
          if (isRoomStale(rp.room)) {
            if (!roomBudgetStatus.has(rp.room.id)) {
              roomBudgetStatus.set(rp.room.id, {
                allowedToHeat: false,
                reason: `Thermostat offline (kein Sync seit > 2h)`,
                shouldRotate: false,
                targetLevel: 'eco',
              });
            }
            continue;
          }
          // Komfort-gesättigte Räume sind tagsüber NICHT mehr Komfort-Kandidat
          if (isComfortSaturated(rp)) {
            if (!roomBudgetStatus.has(rp.room.id)) {
              roomBudgetStatus.set(rp.room.id, {
                allowedToHeat: false,
                reason: `Estrich-Speicher aktiv (heute schon Komfort erreicht)`,
                shouldRotate: false,
                targetLevel: 'eco',
              });
            }
            continue;
          }
          if (roomBudgetStatus.has(rp.room.id)) {
            const existing = roomBudgetStatus.get(rp.room.id)!;
            // Räume auf Eco dürfen auf Komfort upgraded werden (kein Extra-Budget nötig)
            if (existing.targetLevel === 'eco' && existing.allowedToHeat) {
              // Weiter zur Komfort-Prüfung — Budget bereits allokiert
            } else if (existing.targetLevel !== 'none' || !existing.allowedToHeat) {
              continue;
            }
          }

          const comfortTemp = rp.room.comfort_temp || settings?.comfort_temp || 21;
          const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
          const currentTemp = rp.room.current_temp || 0;

          // Raum ist >= eco aber < comfort → auf comfort upgraden
          if (currentTemp >= ecoTemp - 0.3 && (currentTemp < comfortTemp - 0.3 || (rp.room.target_temp != null && rp.room.target_temp < comfortTemp))) {
            // (27.10.2026) Nur Räume mit echtem Eco-Budget dürfen ohne Komfort-Budget upgraden.
            // Vorher reichte targetLevel 'eco' – auch Räume ohne Budget (Phase 1b) sprangen auf Komfort.
            const alreadyBudgeted = roomBudgetStatus.get(rp.room.id)?.budgeted === true &&
              roomBudgetStatus.get(rp.room.id)!.targetLevel === 'eco';

            // Komfort-Budget-Check: NUR echter Überschuss erlaubt
            if (alreadyBudgeted || usedComfortBudget + rp.heatingPower <= effectiveComfortBudget) {
              if (!alreadyBudgeted) { usedBudget += rp.heatingPower; usedComfortBudget += rp.heatingPower; }
              roomBudgetStatus.set(rp.room.id, {
                allowedToHeat: true,
                reason: `Komfort-Phase${alreadyBudgeted ? ' (Eco→Komfort Upgrade)' : ''} (${usedComfortBudget}/${effectiveComfortBudget}W)`,
                shouldRotate: false,
                targetLevel: 'comfort',
                budgeted: true
              });
              console.log(`[PV-Automation] Phase 2: ${rp.room.name} → komfort${alreadyBudgeted ? ' (Upgrade von Eco)' : ''} (${currentTemp.toFixed(1)}°C < ${comfortTemp}°C, Budget ${usedComfortBudget}/${effectiveComfortBudget}W)`);
            } else {
              // Kein Budget für Komfort — auf eco halten
              if (!roomBudgetStatus.has(rp.room.id)) {
                roomBudgetStatus.set(rp.room.id, {
                  allowedToHeat: true,
                  reason: `Eco halten (kein Komfort-Budget: ${usedBudget}+${rp.heatingPower}>${availableBudget}W)`,
                  shouldRotate: false,
                  targetLevel: 'eco'
                });
              }
            }
          } else if (currentTemp >= comfortTemp - 0.3) {
            // Raum ist bereits >= comfort → halten (Sättigung wird oben behandelt)
            if (!roomBudgetStatus.has(rp.room.id)) {
              roomBudgetStatus.set(rp.room.id, {
                allowedToHeat: true,
                reason: `Komfort erreicht (${currentTemp.toFixed(1)}°C)`,
                shouldRotate: false,
                targetLevel: 'comfort'
              });
            }
          }
        }
      } else {
        console.log(`[PV-Automation] === PHASE 2: ÜBERSPRUNGEN === Eco-Phase noch nicht abgeschlossen — Komfort wartet bis alle Räume auf Eco`);
        // Räume die noch keinen Status haben: Eco anstreben (kein Komfort-Upgrade)
        for (const rp of roomsWithPriority) {
          if (roomBudgetStatus.has(rp.room.id)) continue;
          const comfortTemp = rp.room.comfort_temp || settings?.comfort_temp || 21;
          const cur = rp.room.current_temp || 0;
          const saturated = isComfortSaturated(rp);
          // Gesättigte Räume → eco; bereits ≥ comfort → comfort halten; sonst → eco
          const targetLevel: 'eco' | 'comfort' = saturated ? 'eco' : (cur >= comfortTemp - 0.3 ? 'comfort' : 'eco');
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: true,
            reason: saturated ? `Estrich-Speicher aktiv` : (targetLevel === 'comfort' ? `Komfort erhalten (Phase 2 wartet)` : `Phase 2 wartet (Eco nicht komplett)`),
            shouldRotate: false,
            targetLevel,
          });
        }
      }

      // Räume die in keiner Phase verarbeitet wurden (z.B. bereits >= eco, Budget reicht nicht für komfort)
      for (const rp of roomsWithPriority) {
        if (!roomBudgetStatus.has(rp.room.id)) {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: true,
            reason: `Standard (${rp.room.current_temp?.toFixed(1)}°C)`,
            shouldRotate: false,
            targetLevel: 'eco'
          });
        }
      }
      
      // ============= TAGESMODUS (Konzept 27.10.2026, doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md) =============
      // Räume OHNE Budget fallen nicht mehr pauschal auf Eco zurück (Thermostat heizte dann aus
      // Batterie/Netz), sondern bekommen ihr Ziel aus dem Tagesmodus:
      //   battery_gate – SOC unter heating_min_battery_soc (strict): Mindesttemperatur ohne PV
      //   wait         – PV-Überschuss für den Eco-Bedarf ist heute noch absehbar: Mindesttemperatur
      //   evening      – nach Sonnenuntergang (seit 06.11.2026): wie Nacht, Ziel max(Nachtwert, Untergrenze), kein Eco
      //   grid         – kein Überschuss zu erwarten: Eco nach Priorität,
      //                  Summe der Raumleistungen ≤ max_grid_heating_power_w
      // Räume unter ihrer Mindesttemperatur werden in jedem Modus zuerst bis zur Mindesttemperatur
      // geheizt, ebenfalls nach Priorität innerhalb der Netzgrenze.
      // Seit 12.11.2026 keine KI-Verschiebung der Schwelle mehr (Mustergedächtnis abgeschaltet, Bereinigung Stufe 2)
      const maxGridHeatingW = Math.max(0, Number(settings?.max_grid_heating_power_w ?? 2000));
      let dayMode: 'wait' | 'grid' | 'battery_gate' | 'evening' = 'grid';
      if (afterSunset) {
        // Seit 06.11.2026: Abend = Nachtlogik. Ziel max(Nachtwert, Untergrenze), Grenze max_grid_heating_power_w, kein Eco.
        dayMode = 'evening';
      } else if (socGateBlocked && socGateMode === 'strict') {
        dayMode = 'battery_gate';
      } else if (isAway) {
        // Abwesend (Kalender-Eintrag): jeder Tag wie ein Wartetag – Netz nur bis Untergrenze, PV lädt bis Eco, dann Komfort.
        dayMode = 'wait';
      } else {
        // Sonnentag → warten auf Überschuss (Untergrenze halten); sonst Eco nach Priorität aus jeder Quelle.
        dayMode = sunnyDay ? 'wait' : 'grid';
      }

      const nowMsDay = Date.now();
      const unbudgetedRooms = roomsWithPriority.filter(rp => {
        if (roomBudgetStatus.get(rp.room.id)?.budgeted) return false;
        const ov = rp.room.manual_override_until && new Date(rp.room.manual_override_until).getTime() > nowMsDay;
        return !ov;
      });
      const modeText = dayMode === 'evening'
        ? 'Abend (nach Sonnenuntergang wie Nacht)'
        : dayMode === 'battery_gate'
        ? `Batterie-Gate (${batterySoc}% < ${heatingMinSoc}%)`
        : isAway
          ? 'Abwesend (Kalender)'
        : dayMode === 'wait'
          ? `Sonnentag (Überschuss nach Batterie ${(surplusAfterBatteryWh / 1000).toFixed(1)} kWh ≥ ${dayThreshold}× Eco-Bedarf)`
          : 'schlechter Tag → Eco aus Batterie/Netz';
      // Batterie-Schutz: eigene, kleinere Grenze nur für Notfall-Heizen (01.11.2026)
      const dayCapW = dayMode === 'battery_gate'
        ? Math.max(0, Number(settings?.battery_gate_max_power_w ?? 1000))
        : maxGridHeatingW;
      const dayState = await loadWaitState(supabase);
      const dayWaitPrev = dayState.rooms;
      await attachBands(supabase, unbudgetedRooms.map((rp: any) => rp.room));
      const { targets: dayFallback, gridUsedW, waiting: dayWaiting, capGranted: dayCapGranted } = allocateDayTargets(
        unbudgetedRooms.map(rp => ({ room: rp.room, heatingPower: rp.heatingPower })),
        { ...settings, _lokal: controlMode === 'local', _extraUsedW: ausserhalbHeizW }, dayMode, dayCapW, modeText, dayWaitPrev, nowMsDay, dayState.granted,
      );
      const nowIsoDay = new Date().toISOString();
      await saveWaitState(supabase, nextWaitState(dayWaitPrev, dayWaiting, nowIsoDay),
        nextGrantState(dayState.granted, dayCapGranted, nowIsoDay), 'tag');

      // Planer steuert (13.11.2026): Seine Entscheidung ersetzt Tagesmodus und PV-Budget für alle Räume im Plan.
      // Räume ohne Planeintrag behalten das Ziel aus dem Regelwerk (Rückfall).
      const planStand = await ladePlanerPlan(supabase, settings);
      const planerRaeume = new Set<string>();
      if (planStand.map) {
        const ohneOverride = roomsWithPriority.filter(rp => !(rp.room.manual_override_until && new Date(rp.room.manual_override_until).getTime() > nowMsDay));
        await attachBands(supabase, ohneOverride.map((rp: any) => rp.room));
        let heizW = 0;
        for (const rp of ohneOverride) {
          const e = planStand.map.get(rp.room.id);
          if (!e) continue;
          const z = planerSollwert(rp.room, e, settings);
          dayFallback.set(rp.room.id, { temp: z.temp, why: z.why });
          roomBudgetStatus.delete(rp.room.id);
          planerRaeume.add(rp.room.id);
          if (z.heizt) heizW += rp.heatingPower;
        }
        console.log(`[PLANER-STEUERT] ${planStand.grund}: ${planerRaeume.size} Räume nach Plan, heizen ${heizW} W`);
      } else if ((settings?.planer_modus ?? 'schatten') === 'steuern') {
        console.log(`[PLANER-STEUERT] ${planStand.grund}`);
      }

      console.log(`[TAGESMODUS] ${dayMode} | Ratio=${dayRatio === null ? '–' : dayRatio.toFixed(2)} Schwelle=${dayThreshold} | KI: ${kiInfo} | Netz ${gridUsedW}/${dayCapW}W | ${unbudgetedRooms.length} Räume ohne Budget`);
      for (const rp of unbudgetedRooms) {
        const fb = dayFallback.get(rp.room.id);
        if (fb) console.log(`[TAGESMODUS] ${rp.room.name}: ${fb.temp}°C (${fb.why})`);
      }
      try {
        await supabase.from('system_settings').upsert({
          key: 'heating_day_mode',
          value: {
            computed_at: new Date().toISOString(),
            mode: dayMode,
            ratio: dayRatio,
            sunny_day: sunnyDay,
            surplus_after_battery_wh: Math.round(surplusAfterBatteryWh),
            battery_need_wh: Math.round(batteryNeedWhForDay),
            threshold: dayThreshold,
            ki_adjust: kiAdjust,
            ki_info: kiInfo,
            grid_cap_w: dayCapW,
            grid_used_w: gridUsedW,
            away: isAway,
            presence_reason: presence.reason,
            presence_next_start: presence.nextStart,
            planer: planStand.map ? { steuert: true, stand: planStand.grund, raeume: planerRaeume.size } : { steuert: false, stand: planStand.grund },
            rooms: roomsWithPriority.filter((rp: any) => planerRaeume.has(rp.room.id) || unbudgetedRooms.includes(rp)).map((rp: any) => ({
              room_id: rp.room.id,
              name: rp.room.name,
              target: dayFallback.get(rp.room.id)?.temp ?? null,
              why: dayFallback.get(rp.room.id)?.why ?? null,
            })),
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      } catch (e) {
        console.log(`[TAGESMODUS] Persist fehlgeschlagen: ${e}`);
      }

      console.log(`[PV-Automation] Budget-Modus: ${budgetMode}, Budget: ${availableBudget}W (gridExport: ${gridExport}W), Verwendet: ${usedBudget}W`);
      console.log(`[PV-Automation] Surplus: ${surplus}W, GridExport: ${gridExport}W, SOC: ${batterySoc}%, PV: ${pvPower}W, Prognose: ${expectedPvKwh} kWh, Rooms: ${rooms.length}, ML-Features: ${latestMlFeatures.length}`);

      // ============= WARMWASSER-STATUS PRÜFEN =============
      // Warmwasser-Status und -Leistung für Budget-Berechnung
      let hotwaterActive = false;
      const hotwaterPower = settings?.hotwater_power_w || 2000;
      try {
        const { data: activeHotwater } = await supabase
          .from('consumer_logs')
          .select('id')
          .eq('consumer_type', 'hotwater')
          .eq('is_active', true)
          .limit(1);
        hotwaterActive = !!(activeHotwater && activeHotwater.length > 0);
        console.log(`[PV-Automation] Warmwasser aktiv: ${hotwaterActive} (Leistung: ${hotwaterPower}W)`);
      } catch (hwError) {
        console.warn('[PV-Automation] Warmwasser-Status nicht abrufbar:', hwError);
      }

      // WW-Reserve ENTFERNT: Warmwasser wird vollständig autonom über Smartfox gesteuert.
      // Der WW-Verbrauch reduziert gridExport bereits physikalisch → ein zusätzlicher
      // Software-Abzug vom Komfort-Budget würde Doppelbuchung verursachen.
      // hotwaterActive bleibt als Status für superComfortAllowed-Gate und Monitoring erhalten.

      // Prüfe ob alle Räume >= comfort_temp sind (für Super-Comfort)
      // Raum mit Fühler in der Sonne: wahre Temperatur unbekannt → zählt als „nicht auf Komfort“ (vorsichtig)
      const allRoomsAtComfort = fuehlerSonne.length === 0 && rooms.every(r => {
        const roomComfort = r.comfort_temp || settings?.comfort_temp || 21;
        return (r.current_temp || 0) >= roomComfort - 0.3;
      });
      console.log(`[PV-Automation] Alle Räume auf Komfort: ${allRoomsAtComfort}, Batterie: ${batterySoc}%, WW aktiv: ${hotwaterActive}`);

      // 13.11.2026: LLM-Entscheidung je Raum (Gemini über analyze-patterns, lief nur im Cloud-Modus mit Tuya-Schlüsseln)
      // entfernt – eine Sprach-KI steuert keine Thermostate (Uli 13.11.2026). Rechnen und Optimieren macht der Heizplaner.
      // doc/FIX-PLANER-MODELL-2026-11-13.md §Sprach-KI
      const mlDecisions: MLDecision[] = [];
      const usedMlDecision = false;

      // 12.11.2026: Gelernte Policies (learned_policies / update-learned-policies) entfernt – ersetzt durch den
      // rechnenden Heizplaner. Im Lokal-Modus haben Budget-Override und Tagesmodus ihr Ziel immer überschrieben (K4).
      // doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md

      // 8. Process decisions
      const results: Record<string, unknown>[] = [];
      // now ist bereits oben im Budget-Code definiert
      let tuyaApiCalls = 0; // Track API calls for logging

      // NOTE: Hourly mode-sync ('home') removed — TGP508 thermostats reject
      // the `mode` code with API error 2008 ("command not supported").
      // Setting only `temp_set` works reliably and is sufficient for control.

      // Early Return: Wenn Quota erschöpft UND kein PV-Priority-Modus, Raum-Loop überspringen
      if (quotaExhausted && controlMode === 'cloud' && !pvPriorityMode) {
        console.log(`[PV-Automation] ⚠️ Quota erschöpft (kein PV-Priority) - überspringe Raum-Verarbeitung komplett (${rooms.length} Räume)`);
        for (const room of rooms) {
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'skip',
            message: 'Quota erschöpft - keine API-Calls möglich',
            mlBased: false,
          });
        }
      }

      // ============= ML-EXPLORATION-THROTTLE =============
      // Schützt Tuya-Quota + Gemini-Rate-Limit: pro Raum max. 1× Exploration / 30 Min.
      const ML_EXPLORATION_THROTTLE_MIN = 30;
      let mlExplorationMap: Record<string, string> = {};
      try {
        const { data: thr } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'ml_exploration_throttle')
          .maybeSingle();
        if (thr?.value && typeof thr.value === 'object') {
          mlExplorationMap = thr.value as Record<string, string>;
        }
      } catch (_) { /* ignore */ }
      const mlExplorationUpdates: Record<string, string> = {};

      for (const room of rooms) {
        // automation_enabled ist der Hauptschalter: Räume mit false werden oben gar nicht geladen.
        // Hier ist es daher immer true; die Variable steuert nur noch die ML-Zweige.
        const useMLDecisions = room.automation_enabled === true;
        
        if (!useMLDecisions) {
          console.log(`[PV-Automation] Room ${room.name}: ML disabled, using time-based logic only`);
        }

        // Check manual override (temporary protection)
        if (room.manual_override_until) {
          const overrideUntil = new Date(room.manual_override_until);
          if (overrideUntil > now) {
            console.log(`[PV-Automation] Room ${room.name} has manual override until ${overrideUntil.toLocaleTimeString('de-DE')}`);
            results.push({
              roomId: room.id,
              roomName: room.name,
              action: 'skip',
              message: `Manueller Override bis ${overrideUntil.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
              mlBased: false
            });
            continue;
          }
        }

        const lastChange = room.pv_auto_last_change ? new Date(room.pv_auto_last_change) : null;
        const minutesSinceChange = lastChange ? (now.getTime() - lastChange.getTime()) / (1000 * 60) : 999;

        // ============= ÜBERTEMPERATUR-SICHERHEITSREGEL =============
        // HARTER STOP: Wenn Ist-Temp >= Ziel + Deadband → sofort deaktivieren
        // Umgeht Cooldown! Verhindert minutenlanges Weiterheizen über Zieltemperatur
        const OVER_TEMP_DEADBAND = 0.4; // °C
        const currentRoomTempSafety = room.current_temp || 0;
        const currentTargetTempSafety = Number(room.target_temp) || 0;
        const isOverTemp = currentRoomTempSafety > 0 && currentTargetTempSafety > 0 && 
          currentRoomTempSafety >= currentTargetTempSafety + OVER_TEMP_DEADBAND;
        
        // Lokal-Modus (10.11.2026, doc/FIX-REGELN-A-B-C-2026-11-10.md, A): Räume mit Tagesmodus-Ziel entscheidet allein
        // der Tagesmodus (Abschalten am Ziel, 09.11.). Dieser alte Schutz brach vorher mit „Soll ≤ Eco → kein Befehl“ ab,
        // das Thermostat heizte bis Soll + Band weiter und blockierte als Nachlauf die Leistungsgrenze (271× in 24 h).
        // Cloud-Modus und Räume mit PV-Budget: unverändert.
        const dayModeDecides = controlMode === 'local' && dayFallback.has(room.id);
        if (isOverTemp && room.is_heating && dayModeDecides) {
          console.log(`[ÜBERTEMP] ${room.name}: Ist ${currentRoomTempSafety}°C ≥ Soll ${currentTargetTempSafety}°C + ${OVER_TEMP_DEADBAND} → entscheidet der Tagesmodus (Abschalten am Ziel)`);
        }
        if (isOverTemp && room.is_heating && !dayModeDecides) {
          const ecoTempForGuard = room.eco_temp || settings?.eco_temp || 19;
          // Wenn Sollwert bereits auf Eco oder darunter → kein Tuya-Call nötig.
          // Das Thermostat hört eigenständig auf zu heizen sobald current >= target.
          // Wir korrigieren nur den DB-Heizstatus, damit UI/Logik stimmig sind.
          const targetAlreadyLowEnough = currentTargetTempSafety <= ecoTempForGuard + 0.1;

          if (targetAlreadyLowEnough) {
            console.log(`[CALL-SKIP] ${room.name}: Übertemperatur (Ist=${currentRoomTempSafety}°C ≥ Ziel=${currentTargetTempSafety}°C+${OVER_TEMP_DEADBAND}), Sollwert bereits ≤ Eco (${ecoTempForGuard}°C) → DB-only Status-Korrektur, kein Tuya-Call`);
            await supabase.from('rooms').update({
              // Lokal-Modus (08.11.2026): „erfolgreich“ heißt nur „eingereiht“ – Erreichbarkeit und Heizstatus schreibt allein der Thermostat-Dienst nach echter Lesung (FIX-LOKAL-ERREICHBARKEIT-2026-11-08).
              // Lokal: Heizt-Meldung (DP 5) ist gemessen – nicht überschreiben, sonst falsche Heizzyklen (Trigger 04).
              ...(controlMode === 'cloud' ? { is_heating: false } : {}),
              pv_auto_active: false,
              pv_auto_last_change: now.toISOString(),
              last_auto_change: now.toISOString(),
              heating_paused_reason: 'over_temp_db_only',
            }).eq('id', room.id);
            results.push({
              roomId: room.id,
              roomName: room.name,
              action: 'db_only_overtemp',
              targetTemp: currentTargetTempSafety,
              reasoning: `DB-Status korrigiert (Soll bereits ${currentTargetTempSafety}°C ≤ Eco)`,
              mlBased: false,
              skippedApiCall: true,
              overTempGuard: true,
            });
            continue;
          }

          // Sollwert noch über Eco → echte Senkung erforderlich (Tuya-Call mit STOP-Reserve)
          console.log(`[PV-Automation] ${room.name}: ⚠️ ÜBER-TEMPERATUR! Ist=${currentRoomTempSafety}°C >= Ziel=${currentTargetTempSafety}°C + ${OVER_TEMP_DEADBAND}°C → FORCE STOP auf Eco ${ecoTempForGuard}°C`);
          const safeTemp = ecoTempForGuard;

          if (room.tuya_device_id) {
            const result = await setTemperatureForMode(room.tuya_device_id, room.id, safeTemp, 'stop', `Über-Temperatur (Ist ${currentRoomTempSafety}°C) → Eco ${safeTemp}°C`);
            if (result.success) {
              await supabase.from('rooms').update({
                // Lokal-Modus (08.11.2026): „erfolgreich“ heißt nur „eingereiht“ – Erreichbarkeit und Heizstatus schreibt allein der Thermostat-Dienst nach echter Lesung (FIX-LOKAL-ERREICHBARKEIT-2026-11-08).
                ...(controlMode === 'cloud' ? { is_heating: false, last_thermostat_sync: now.toISOString() } : {}),
                pv_auto_active: false,
                pv_auto_last_change: now.toISOString(),
                last_auto_change: now.toISOString(),
                target_temp: safeTemp,
                heating_paused_reason: 'over_temp',
              }).eq('id', room.id);
              if (controlMode === 'cloud' && result.success) {
                tuyaApiCalls++;
                if (quotaData) {
                  const runningDaily = quotaData.calls_today + tuyaApiCalls;
                  const runningMonthly = quotaData.calls_this_month + tuyaApiCalls;
                  const effDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
                  if (runningDaily >= effDL || runningMonthly >= (quotaData.monthly_limit || 900)) {
                    quotaExhausted = true;
                    console.log(`[PV-Automation] ⚠️ Quota mid-run erschöpft nach ${tuyaApiCalls} Calls (over-temp stop)`);
                  }
                }
              }
            }
            results.push({
              roomId: room.id,
              roomName: room.name,
              action: 'deactivate',
              targetTemp: safeTemp,
              reasoning: `⚠️ Übertemperatur-Stop: ${currentRoomTempSafety.toFixed(1)}°C → Eco ${safeTemp}°C`,
              mlBased: false,
              success: result.success,
              overTempGuard: true,
            });
          }
          continue;
        }

        // Cooldown check - NUR für Aufheiz-Aktionen, NICHT für Sicherheits-Stops
        // Sicherheitsfälle (Übertemperatur oben bereits behandelt, Reduktionen werden unten geprüft)
        const inCooldown = minutesSinceChange < (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN);
        // Cooldown wird erst NACH der Entscheidung angewendet (s.u.), nicht als blindes continue

        let action = 'keep' as 'activate' | 'deactivate' | 'keep'; // as: Typ nicht auf 'keep' einengen (Zweige weiter unten)
        let targetTemp = room.target_temp || settings?.eco_temp || 19;
        let solarLimitTemp: number | null = null; // Solar-Limit: erlaubte Max-Temp bei Sonneneinstrahlung
        let reasoning = '';
        let expectedEnergyWh: number | undefined;
        let confidence: number | undefined;
        let mlDecision: MLDecision | null | undefined = null; // Außerhalb definiert für spätere Referenz
        // ML-Tracking: Was hat die Policy empfohlen, sind wir gefolgt?
        let mlRecommendationForTracking: { action: string; temp: number | null; confidence: number; sample_count: number } | null = null;
        let mlFollowedDecision: boolean | null = null;

        // WICHTIG: Nachtzeit-Check ZUERST - hat IMMER Priorität über ML!
        const nightStart = settings?.night_start_time || '22:00';
        const nightEnd = settings?.night_end_time || '08:00';
        const { isNight, wienTime, wienHour } = isNightTime(nightStart, nightEnd);
        
        const ecoTemp = room.eco_temp || settings?.eco_temp || 19;
        const comfortTemp = room.comfort_temp || settings?.comfort_temp || 21;
        const nightTemp = room.night_temp || settings?.night_temp || 17;
        const currentTargetTemp = Number(room.target_temp) || 0;
        
        console.log(`[PV-Automation] ${room.name}: Wien-Zeit ${wienTime}, Nacht=${isNight} (${nightStart}-${nightEnd})`);

        // 1. NACHTMODUS - hat absolute Priorität über ALLES (auch ML!)
        if (isNight) {
          // currentTargetTemp ist jetzt oben definiert (Zeile ~922)
          
          const needsCorrection = Math.abs(currentTargetTemp - nightTemp) >= 0.5 || room.pv_auto_active;
          
          console.log(`[PV-Automation] ${room.name} Nacht-Check: target=${currentTargetTemp}°C, nightTemp=${nightTemp}°C, pv_auto=${room.pv_auto_active}, needsCorrection=${needsCorrection}`);
          
          if (needsCorrection) {
            action = 'deactivate';
            targetTemp = nightTemp;
            solarLimitTemp = null; // Kein Solar-Limit nachts
            reasoning = `Nachtmodus bis ${nightEnd} (Wien: ${wienTime})`;
          }
          // Sättigungs-Reset: bei Nacht-Übergang comfort_saturated_at zurücksetzen
          if ((room as any).comfort_saturated_at) {
            await supabase.from('rooms').update({ comfort_saturated_at: null }).eq('id', room.id);
            console.log(`[KOMFORT-SAT] ${room.name}: Sättigung zurückgesetzt (Nacht-Modus)`);
          }
          // Skip ML and fallback logic during night
        } else {
          // TAGSÜBER: ML oder Fallback-Logik

          // ============= HARTER PV-GATE =============
          // KEINE Heizung ohne PV-Strom, unabhängig von ML/Learned Policies!
          // Dies ist die letzte Sicherheitsebene die NICHT übergangen werden kann.
          // Gate-Schwellen entschärft: Kurze Wolken (PV<500W) sollen nicht sofort alles stoppen.
          // Nur bei wirklich niedriger Momentanleistung UND niedriger Tagesprognose blockieren.
          const noPvAvailable = pvPower < 300;
          const lowForecast = expectedPvKwh < 8; // <8 kWh Tagesprognose = wirklich schlechter Tag
          const noPvHeatingAllowed = noPvAvailable && lowForecast;
          
          if (noPvHeatingAllowed) {
            console.log(`[PV-Automation] ${room.name}: ⛔ HARTER PV-GATE: Kein PV (${pvPower}W < 300W) + niedrige Prognose (${expectedPvKwh}kWh < 8kWh) → KEIN Heizen erlaubt`);
            // Sticky Eco: nur deaktivieren wenn Setpoint ÜBER Eco liegt (also Komfort-Niveau)
            // Räume auf Eco bleiben auf Eco — Thermostat selbst stoppt Heizung wenn current >= eco
            if (currentTargetTemp > ecoTemp + 0.5) {
              action = 'deactivate';
              targetTemp = ecoTemp;
              solarLimitTemp = null;
              reasoning = `⛔ Kein PV (${pvPower}W) + Prognose nur ${expectedPvKwh}kWh → zurück auf Eco`;
            }
            // Sonst: keep, Eco-Setpoint wird beibehalten
          } else {
            // ML decision (nur Cloud-Modus mit Tuya-Schlüsseln: LLM über analyze-patterns, gedrosselt).
            // 12.11.2026: Stufe „gelernte Policy“ entfernt (siehe oben).
            {
              const lastExpStr = mlExplorationMap[room.id];
              const lastExpMs = lastExpStr ? new Date(lastExpStr).getTime() : 0;
              const minsSinceLastExp = (Date.now() - lastExpMs) / 60000;
              const throttled = minsSinceLastExp < ML_EXPLORATION_THROTTLE_MIN;
              if (throttled) {
                console.log(`[PV-Automation] ${room.name}: ML-Exploration THROTTLED (letzte vor ${minsSinceLastExp.toFixed(1)}min, min ${ML_EXPLORATION_THROTTLE_MIN}min) → keep`);
                mlDecision = null;
              } else {
                mlDecision = useMLDecisions ? mlDecisions.find(d => d.room_id === room.id) : null;
                if (mlDecision) {
                  mlExplorationUpdates[room.id] = new Date().toISOString();
                }
              }
            }


            // (Solar-Gain-Erkennung und Morgen-Sperre entfernt — Thermostate regeln passiven Solargewinn selbst)

            // Only process ML/fallback if action is still 'keep' (not already set by morning wake-up or solar)
            if (action === 'keep') {
              if (mlDecision && usedMlDecision && useMLDecisions) {
                // Use ML/AI recommendation (nur tagsüber!)
                action = mlDecision.action;
                // ML-Temperatur auf comfort_temp deckeln — comfort ist das absolute Maximum
                targetTemp = Math.min(mlDecision.target_temp, comfortTemp);
                reasoning = mlDecision.reasoning + ' (KI)';
                expectedEnergyWh = mlDecision.expected_energy_wh;
                confidence = mlDecision.confidence;

                // ============= PV-GATE FÜR ML-ACTIVATE =============
                // ML darf NUR bei tatsächlichem PV-Überschuss aktivieren
                if (action === 'activate' && pvPower < 500) {
                  console.log(`[PV-Automation] ${room.name}: ⚠️ ML will activate, aber PV nur ${pvPower}W → BLOCKIERT`);
                  action = 'keep';
                  reasoning += ' → BLOCKIERT (kein PV)';
                }
              } else {
                // Basis-Zeitschaltung / Fallback (nur tagsüber)
                
                // 2. PV surplus/Solargewinn -> Solar-Modus aktivieren
                // ABER: Nur wenn tatsächlich genug PV-Leistung vorhanden!
                if (surplus >= thresholdOn && !room.pv_auto_active && pvPower >= 1000) {
                  action = 'activate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = comfortTemp;
                  reasoning = `PV-Überschuss: ${ecoTemp}°C (${surplus}W Überschuss, ${pvPower}W PV)`;
                }
                // 4. Low/no surplus -> Solar-Limit deaktivieren
                else if (surplus < thresholdOff && room.pv_auto_active) {
                  action = 'deactivate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = null;
                  reasoning = `Solar-Limit aus (Überschuss ${surplus}W < ${thresholdOff}W)`;
                } 
                // 5. Wenn Solar-Limit aktiv ist und Bedingungen noch gelten, beibehalten
                else if (room.pv_auto_active && surplus >= thresholdOff) {
                  targetTemp = ecoTemp;
                  solarLimitTemp = comfortTemp;
                }
                // 6. Daytime default: Eco-Temp nur setzen wenn PV verfügbar
                else if (!room.pv_auto_active && currentTargetTemp < ecoTemp && pvPower >= 500) {
                  action = 'activate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = null;
                  reasoning = `Eco-Modus (PV verfügbar: ${pvPower}W): ${currentTargetTemp}°C → ${ecoTemp}°C`;
                }
                
                // ============= ÜBERSCHUSS-UMLEITUNG =============
                if (action === 'keep' && gridExport > 1000 && !room.pv_auto_active) {
                  const currentRoomTemp = room.current_temp || 0;
                  const roomNeedsHeating = currentRoomTemp < (ecoTemp - 0.5);
                  
                  if (roomNeedsHeating) {
                    action = 'activate';
                    targetTemp = ecoTemp;
                    solarLimitTemp = comfortTemp;
                    reasoning = `⚡ Überschuss-Nutzung: ${gridExport}W Export → Raum heizen statt einspeisen (${currentRoomTemp.toFixed(1)}°C < ${ecoTemp}°C)`;
                    console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
                  }
                }
              }
            }
          }
        }

        // ============= LEISTUNGSBUDGET-OVERRIDE =============
        // Sequenzielles Heizen: Aktive Räume auf Comfort, Wartende auf Night-Temp
        // Das verhindert dass wartende Thermostate autonom heizen
        // Budget-Logik auch nachts bei leerem Akku aktiv (verhindert Netz-Heizen)
        let budgetOverrideApplied = false;  // K4: überschreibt Policy/LLM-Entscheidung
        if (powerBudgetEnabled && (budgetMode === 'pv_optimized' || budgetMode === 'grid_sequential')) {
          const budgetStatus = roomBudgetStatus.get(room.id);
          
          if (budgetStatus) {
            budgetOverrideApplied = true;
            if (budgetStatus.shouldRotate) {
              // Rotation: Raum hat zu lange geheizt, pausieren für andere
              // Tag → eco_temp (Raum bleibt komfortabel, Thermostat regelt selbst)
              // Nacht → night_temp (Energie sparen)
              action = 'deactivate';
              targetTemp = isNight ? nightTemp : ecoTemp;
              solarLimitTemp = null;
              reasoning = `🔄 ${budgetStatus.reason} → ${targetTemp}°C (Rotation-Stopp, ${isNight ? 'Nacht' : 'Tag'})`;
              console.log(`[PV-Automation] ${room.name}: ROTATION - ${reasoning}`);
              
              // Tracking aktualisieren
              await supabase
                .from('rooms')
                .update({ 
                  last_heating_end: now.toISOString(),
                  heating_paused_reason: 'rotation'
                })
                .eq('id', room.id);
            } else if (!budgetStatus.allowedToHeat) {
              // Budget reicht nicht
              // Tag → eco_temp halten (Thermostat-Hysterese regelt autonom)
              // Nacht → night_temp (Energie sparen)
              action = 'deactivate';
              targetTemp = isNight ? nightTemp : ecoTemp;
              solarLimitTemp = null;
              reasoning = `⏸️ ${budgetStatus.reason} → ${targetTemp}°C (Budget-Stopp, ${isNight ? 'Nacht' : 'Tag'})`;
              console.log(`[PV-Automation] ${room.name}: BUDGET-PAUSE - ${reasoning}`);
              
              // Tracking aktualisieren
              await supabase
                .from('rooms')
                .update({ heating_paused_reason: 'budget' })
                .eq('id', room.id);
            } else if (budgetStatus.allowedToHeat) {
              const currentRoomTemp = room.current_temp || 0;
              solarLimitTemp = null;
              
              if (budgetMode === 'grid_sequential') {
                // KEIN PV: Nur bis eco_temp heizen, dann stoppen
                if (currentRoomTemp < ecoTemp - 0.3) {
                  action = 'activate';
                  targetTemp = ecoTemp;
                  reasoning = `🔌 Grid-Heizen: ${ecoTemp}°C (Raum ${currentRoomTemp.toFixed(1)}°C, Budget: ${budgetStatus.reason})`;
                } else {
                  // Eco erreicht → nicht weiter heizen, auf eco_temp halten
                  action = 'keep';
                  targetTemp = ecoTemp;
                  reasoning = `✅ Eco erreicht (${currentRoomTemp.toFixed(1)}°C ≥ ${ecoTemp}°C) → kein Grid-Komfort-Heizen`;
                }
                console.log(`[PV-Automation] ${room.name}: GRID-HEIZEN - ${reasoning}`);
              } else {
                // ============= 2-PHASEN PV-HEIZLOGIK =============
                // targetLevel wurde in der Budget-Zuweisung bestimmt (eco oder comfort)
                // Keine Batterie-Bedingung! Budget = gridExport + heizende Räume + Toleranz
                const rp = roomsWithPriority.find(r => r.room.id === room.id);
                const roomHeatingPower = rp?.heatingPower || 800;
                const targetLevel = budgetStatus.targetLevel;
                console.log(`[PV-Automation] ${room.name}: 2-Phasen-Check → Level: ${targetLevel} (${budgetStatus.reason}, roomPower=${roomHeatingPower}W, comfortBudget=${comfortBudget}W, usedComfortBudget=${usedComfortBudget}W, ecoBudget=${availableBudget}W, usedEcoBudget=${usedBudget}W)`);
                
                if (targetLevel === 'comfort' || targetLevel === 'super_comfort') {
                  // Phase 2: Auf Komfort heizen
                  if (currentRoomTemp < comfortTemp - 0.3 || currentTargetTemp < comfortTemp) {
                    action = 'activate';
                    targetTemp = targetLevel === 'super_comfort' ? comfortTemp + 1 : comfortTemp;
                    reasoning = `☀️ Phase 2: Komfort ${targetTemp}°C (Raum ${currentRoomTemp.toFixed(1)}°C, Thermostat ${currentTargetTemp}°C, Budget OK: ${budgetStatus.reason})`;
                  } else {
                    action = 'keep';
                    targetTemp = comfortTemp;
                    reasoning = `✅ Komfort erreicht (${currentRoomTemp.toFixed(1)}°C ≥ ${comfortTemp}°C)`;
                  }
                } else if (targetLevel === 'eco') {
                  // Phase 1: Auf Eco heizen
                  // (27.10.2026) Sprung „Eco=Nacht → direkt Komfort“ entfernt: umging das Komfort-Budget.
                  if (currentRoomTemp < ecoTemp - 0.3 || currentTargetTemp < ecoTemp) {
                    action = 'activate';
                    targetTemp = ecoTemp;
                    reasoning = `☀️ Phase 1: Eco ${ecoTemp}°C (Raum ${currentRoomTemp.toFixed(1)}°C, Thermostat ${currentTargetTemp}°C, Budget OK: ${budgetStatus.reason})`;
                  } else {
                    // Eco erreicht, aber kein Budget für Komfort
                    action = 'keep';
                    targetTemp = ecoTemp;
                    reasoning = `✅ Eco erreicht (${currentRoomTemp.toFixed(1)}°C), kein Komfort-Budget`;
                  }
                } else {
                  // Fallback: Target-Korrektur wenn Thermostat zu niedrig
                  if (currentTargetTemp < ecoTemp - 1) {
                    action = 'activate';
                    targetTemp = ecoTemp;
                    reasoning = `🔧 Target-Korrektur: Thermostat bei ${currentTargetTemp}°C → ${ecoTemp}°C`;
                  } else {
                    action = 'keep';
                    targetTemp = currentRoomTemp >= ecoTemp ? ecoTemp : currentTargetTemp;
                    reasoning = `✅ Halten (${currentRoomTemp.toFixed(1)}°C)`;
                  }
                }
                console.log(`[PV-Automation] ${room.name}: PV-HEIZEN - ${reasoning}`);
              }
              
              // Tracking starten
              await supabase
                .from('rooms')
                .update({ 
                  last_heating_start: room.is_heating ? room.last_heating_start : now.toISOString(),
                  heating_paused_reason: null
                })
                .eq('id', room.id);
            }
          }
        }

        // ============= TAGESMODUS-ZIEL für Räume ohne Budget (27.10.2026) =============
        // Ersetzt für Räume ohne echtes Budget das bisherige „Tag → eco_temp halten“ (Budget-Stopp,
        // Rotation, Phase-2-wartet, Standard). Raum-Ziel kommt aus dem Tagesmodus (siehe oben).
        let dayModeApplied = false;
        const dayFb = dayFallback.get(room.id);
        if (!isNight && (powerBudgetEnabled || planerRaeume.has(room.id)) && dayFb && !roomBudgetStatus.get(room.id)?.budgeted) {
          dayModeApplied = true;
          targetTemp = dayFb.temp;
          solarLimitTemp = null;
          if (dayFb.temp < currentTargetTemp - 0.05) action = 'deactivate';
          else if (dayFb.temp > currentTargetTemp + 0.05) action = 'activate';
          else action = 'keep';
          reasoning = planerRaeume.has(room.id) ? `🧮 ${dayFb.why} → ${dayFb.temp}°C` : `🗓️ Tagesmodus ${dayMode}: ${dayFb.why} → ${dayFb.temp}°C`;
          console.log(`[PV-Automation] ${room.name}: ${reasoning} (Sollwert bisher ${currentTargetTemp}°C, Aktion ${action})`);
        }

        // ============= TEMPERATUR-DECKELUNG =============
        // Super-Comfort (comfort+1) nur erlaubt wenn: Batterie voll, kein WW, alle Räume auf comfort, Export reicht
        // Abwesend: seit 30.10.2026 kein Eco-Deckel mehr – Komfort mit PV-Überschuss wie bei Anwesenheit.
        const superComfortAllowed = allRoomsAtComfort && batterySoc >= 95 && !hotwaterActive;
        const maxAllowedTemp = superComfortAllowed ? comfortTemp + 1 : comfortTemp;
        
        if (targetTemp > maxAllowedTemp) {
          console.log(`[PV-Automation] ${room.name}: Zieltemp ${targetTemp}°C auf ${maxAllowedTemp}°C gedeckelt (SuperComfort=${superComfortAllowed})`);
          targetTemp = maxAllowedTemp;
        }

        // NACHT-HARDGUARD: Im Raum-Loop niemals 'activate' während Nacht — nur deactivate/keep.
        // Verhindert Race-Conditions an Tag/Nacht-Boundaries (z.B. exakt 22:00) wenn nachgelagerte
        // Logik (Budget/ML/Learned Policy) ein 'activate' setzen würde.
        if (isNight && action === 'activate') {
          console.log(`[PV-Automation] ${room.name}: 🌙 NACHT-HARDGUARD → activate blockiert, target=${nightTemp}°C`);
          action = 'deactivate';
          targetTemp = nightTemp;
          solarLimitTemp = null;
          reasoning = `🌙 Nacht-Hardguard: ${reasoning || 'kein activate erlaubt'}`;
        }
        if (isNight && targetTemp > nightTemp) {
          targetTemp = nightTemp;
        }


        if (syncFailed && action === 'activate') {
          console.log(`[PV-Automation] ${room.name}: SYNC-FAILED → activate blockiert, nur Reduktionen/Stops erlaubt`);
          action = 'keep';
          reasoning = 'Sync fehlgeschlagen, Aufheizen blockiert';
        }

        // ============= STALE-SYNC-CHECK: Force-Push wenn letzter Sync alt ist =============
        const lastSyncTime = room.last_thermostat_sync ? new Date(room.last_thermostat_sync).getTime() : 0;
        const syncAgeMs = Date.now() - lastSyncTime;
        const syncStale = syncAgeMs > 60 * 60 * 1000; // >60 Minuten (erhöht von 30 um Quota zu schonen)

        // Kritischer Sicherheitsfall: Bei wenig PV + altem Sync IMMER mindestens Eco/Nacht neu pushen
        // ABER: Nicht wenn Quota erschöpft — dann würde der API-Call sowieso blockiert
        const lowPvSafetyWindow = pvPower < 500 || expectedPvKwh < 5;
        // Nur Cloud-Modus (08.11.2026): Lokal liest der Thermostat-Dienst alle 5 min und Stufe 4 korrigiert Abweichungen.
        // Ein alter Zeitstempel heißt lokal „Gerät antwortet nicht“ – ein neuer Befehl hilft dann nicht und erzeugte
        // nur alle 5 min ein Lern-Ereignis.
        if (controlMode === 'cloud' && action === 'keep' && syncStale && lowPvSafetyWindow && !quotaExhausted) {
          action = 'deactivate';
          targetTemp = Math.min(currentTargetTemp || ecoTemp, ecoTemp);
          solarLimitTemp = null;
          reasoning = `🔁 Sicherheits-Resync: wenig PV (${pvPower}W), Prognose ${expectedPvKwh}kWh`;
          console.log(`[PV-Automation] ${room.name}: FORCE-RESYNC bei Low-PV (last sync ${Math.round(syncAgeMs / 60000)} min)`);
        }

        // ============= COOLDOWN-GATE =============
        // Cooldown NUR für Aufheiz-Aktionen (activate, Temp erhöhen)
        // Sicherheits-Aktionen (deactivate, Temp senken) umgehen Cooldown IMMER
        const isSafetyAction = action === 'deactivate' || 
          (Number(targetTemp) < currentTargetTemp - 0.3);
        
        if (action !== 'keep' && inCooldown && !isSafetyAction) {
          console.log(`[PV-Automation] ${room.name}: COOLDOWN - ${Math.ceil((settings?.min_switch_interval_min || 5) - minutesSinceChange)} min (nur für Aufheiz-Aktionen)`);
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'cooldown',
            message: `Wait ${Math.ceil((settings?.min_switch_interval_min || 5) - minutesSinceChange)} min (Aufheiz-Cooldown)`,
            mlBased: false
          });
          continue;
        }

        if (action === 'keep') {
          // DB-Sync: target_temp korrigieren wenn abweichend (ohne Tuya-Call)
          const dbTargetDrift = Math.abs(currentTargetTemp - Number(targetTemp));
          if (dbTargetDrift >= 0.5) {
            await supabase.from('rooms').update({
              target_temp: targetTemp
            }).eq('id', room.id);
            console.log(`[PV-Automation] ${room.name}: DB-Sync target_temp ${currentTargetTemp}→${targetTemp}°C (keep, kein API-Call)`);
          }
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'keep',
            currentState: room.pv_auto_active ? 'active' : 'inactive',
            mlBased: usedMlDecision && !!mlDecision
          });
          continue;
        }

        // ============= SKIP LOGIC: Check if Tuya API call is actually needed =============
        // currentTargetTemp already defined above (line ~922)
        const newTargetTemp = Number(targetTemp) || 0;
        const tempAlreadyCorrect = Math.abs(currentTargetTemp - newTargetTemp) < 0.5; // 0.5°C tolerance
        const stateAlreadyCorrect = (action === 'activate' && room.pv_auto_active) || 
                                     (action === 'deactivate' && !room.pv_auto_active);
        
        // WICHTIG: Bei JEDER Temperatur-Reduktion API aufrufen (für sequenzielles Heizen)
        const needsToReduceTemp = newTargetTemp < currentTargetTemp - 0.5;
        
        // ÜBER-TEMPERATUR-STOP: Wenn is_heating=true aber Ist > Ziel → niemals skippen
        const needsHeatingStop = room.is_heating === true && 
          (room.current_temp || 0) > 0 && newTargetTemp > 0 &&
          (room.current_temp || 0) >= newTargetTemp + 0.3;
        
        const shouldSkip = tempAlreadyCorrect && stateAlreadyCorrect && !needsToReduceTemp && !syncStale && !needsHeatingStop;
        
        if (shouldSkip) {
          // DB-Sync: target_temp korrigieren wenn abweichend (ohne Tuya-Call)
          const dbTargetDriftSkip = Math.abs(currentTargetTemp - newTargetTemp);
          if (dbTargetDriftSkip >= 0.5) {
            await supabase.from('rooms').update({
              target_temp: newTargetTemp
            }).eq('id', room.id);
            console.log(`[PV-Automation] ${room.name}: DB-Sync target_temp ${currentTargetTemp}→${newTargetTemp}°C (skip, kein API-Call)`);
          }
          console.log(`[PV-Automation] ${room.name}: SKIP - already at ${currentTargetTemp}°C, state=${room.pv_auto_active ? 'active' : 'inactive'}`);
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'skip',
            message: `Bereits korrekt: ${currentTargetTemp}°C`,
            mlBased: usedMlDecision && !!mlDecision,
            skippedApiCall: true
          });
          continue;
        }
        
        if (needsHeatingStop) {
          console.log(`[PV-Automation] ${room.name}: FORCE-STOP - is_heating=true but temp ${(room.current_temp || 0).toFixed(1)}°C >= target ${newTargetTemp}°C + 0.3°C`);
        }
        
        if (syncStale && tempAlreadyCorrect) {
          console.log(`[PV-Automation] ${room.name}: FORCE-SYNC - last sync ${Math.round(syncAgeMs / 60000)} min ago, pushing ${newTargetTemp}°C to device`);
        }
        
        // Log wenn wir einen Force-Push machen
        if (needsToReduceTemp) {
          console.log(`[PV-Automation] ${room.name}: FORCE-PUSH - reducing from ${currentTargetTemp}°C to ${newTargetTemp}°C (action: ${action})`);
        }

        // Log learning event BEFORE executing
        const eventContext = {
          surplus,
          battery_soc: batterySoc,
          pv_power: reading.pv_power,
          consumption: reading.consumption,
          room_temp: room.current_temp,
          outdoor_temp: weatherData?.temperature_c,
          cloud_cover: weatherData?.cloud_cover_percent,
          ml_confidence: confidence,
          ml_features: latestMlFeatures.find(f => f.room_id === room.id) || null
        };

        const eventAction: Record<string, unknown> = {
          target_temp: targetTemp,
          reasoning,
          expected_energy_wh: expectedEnergyWh,
          previous_state: room.pv_auto_active,
          ml_based: usedMlDecision && !!mlDecision,
        };
        // K4 (10.11.2026): Wer hat das ausgeführte Ziel wirklich bestimmt? Policy/LLM setzen Aktion und Ziel früh in der
        // Raumschleife; Budget-Override und Tagesmodus überschreiben das danach. Vorher stand dann trotzdem
        // ml_followed = true im Lern-Ereignis – die KI „lernte“ aus Entscheidungen, die gar nicht ausgeführt wurden.
        eventAction.entschieden_von = dayModeApplied ? 'tagesmodus'
          : budgetOverrideApplied ? 'budget' : (mlFollowedDecision ? 'policy' : 'regel');
        if (mlRecommendationForTracking) {
          eventAction.ml_recommendation = mlRecommendationForTracking;
          eventAction.ml_followed = mlFollowedDecision === true && !dayModeApplied && !budgetOverrideApplied;
        }

        // Learning-Event nur bei tatsächlichen Aktionen oder ML-Entscheidungen anlegen.
        // Vermeidet ~80% Volumen (skip/keep ohne Reward-Information).
        // K4: Prüfbefehl an ein nicht steuerbares Thermostat ist keine Entscheidung, aus der gelernt werden kann
        const shouldLogEvent = !room.nicht_steuerbar_seit
          && (action === 'activate' || action === 'deactivate' || (usedMlDecision && !!mlDecision));
        let eventData: { id: string } | null = null;
        if (shouldLogEvent) {
          const { data, error: eventError } = await supabase
            .from('learning_events')
            .insert({
              decision_type: action,
              room_id: room.id,
              context: eventContext,
              action: eventAction,
              is_evaluated: false
            })
            .select('id')
            .single();

          if (eventError) {
            console.error(`[PV-Automation] Learning event error for ${room.name}:`, eventError);
          } else {
            eventData = data;
            console.log(`[PV-Automation] Learning event ${data?.id} for ${room.name}`);
          }
        }

        // Execute action
        let success = false;
        let tuyaError: { errorType?: string; errorMessage?: string } | null = null;

        if (action === 'activate') {
          if (room.tuya_device_id) {
            const result = await setTemperatureForMode(room.tuya_device_id, room.id, targetTemp, 'normal', reasoning || undefined);
            success = result.success;
            if (!result.success) {
              tuyaError = { errorType: result.errorType, errorMessage: result.errorMessage };
            }
            if (controlMode === 'cloud' && result.success) {
              tuyaApiCalls++;
              if (quotaData) {
                const runningDaily = quotaData.calls_today + tuyaApiCalls;
                const runningMonthly = quotaData.calls_this_month + tuyaApiCalls;
                const effDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
                if (runningDaily >= effDL || runningMonthly >= (quotaData.monthly_limit || 900)) {
                  quotaExhausted = true;
                  console.log(`[PV-Automation] ⚠️ Quota mid-run erschöpft nach ${tuyaApiCalls} Calls (activate)`);
                }
              }
            }
          }

          if (success || !room.tuya_device_id) {
            // Clear any existing errors for this room on success
            // Lokal-Modus (08.11.2026): Erreichbarkeits-Fehler NICHT schließen – der Befehl ist nur eingereiht.
            // Die schließt auto-resolve-api-errors, sobald das Gerät wirklich gelesen wurde.
            {
              let clearQuery = supabase
                .from('api_errors')
                .update({ resolved_at: now.toISOString() })
                .eq('room_id', room.id)
                .is('resolved_at', null);
              if (controlMode !== 'cloud') clearQuery = clearQuery.not('error_type', 'in', '(device_offline,connection_error)');
              await clearQuery;
            }

            await supabase.from('rooms').update({
              // Tagesmodus-Ziel ist kein PV-Heizen → pv_auto_active bleibt aus
              pv_auto_active: !dayModeApplied,
              pv_auto_last_change: now.toISOString(),
              last_auto_change: now.toISOString(),
              // Lokal-Modus (08.11.2026): „erfolgreich“ heißt nur „eingereiht“ – Erreichbarkeit und Heizstatus schreibt allein der Thermostat-Dienst nach echter Lesung (FIX-LOKAL-ERREICHBARKEIT-2026-11-08).
              ...(controlMode === 'cloud' ? { last_thermostat_sync: now.toISOString() } : {}),
              target_temp: targetTemp,
              solar_limit_temp: solarLimitTemp
            }).eq('id', room.id);

            if (!dayModeApplied) {
              await supabase.from('room_heating_logs').insert({
                room_id: room.id,
                event_type: 'solar_limit_start',
                current_temp: room.current_temp,
                target_temp: targetTemp,
                pv_surplus_w: surplus,
                consumption_at_start_w: reading.consumption
              });
            }

            success = true;
          } else if (tuyaError) {
            // Log API error
            await supabase.from('api_errors').insert({
              source: 'pv-automation',
              room_id: room.id,
              room_name: room.name,
              error_type: tuyaError.errorType || 'tuya_api',
              error_message: tuyaError.errorMessage?.slice(0, 500),
              device_id: room.tuya_device_id,
            });
            console.error(`[PV-Automation] Tuya API error for ${room.name}: ${tuyaError.errorMessage}`);
          }

        } else if (action === 'deactivate') {
          // Verwende die bereits berechnete targetTemp (kann nightTemp oder ecoTemp sein)
          // Fallback auf eco_temp nur wenn targetTemp nicht gesetzt wurde
          const finalTemp = targetTemp || room.eco_temp || settings?.eco_temp || 18;
          
          console.log(`[PV-Automation] ${room.name} deactivate: Setze ${finalTemp}°C (targetTemp=${targetTemp}, nightTemp=${room.night_temp || settings?.night_temp})`);

          if (room.tuya_device_id) {
            const result = await setTemperatureForMode(room.tuya_device_id, room.id, finalTemp, 'stop', reasoning || undefined);
            success = result.success;
            if (!result.success) {
              tuyaError = { errorType: result.errorType, errorMessage: result.errorMessage };
            }
            if (controlMode === 'cloud' && result.success) {
              tuyaApiCalls++;
              if (quotaData) {
                const runningDaily = quotaData.calls_today + tuyaApiCalls;
                const runningMonthly = quotaData.calls_this_month + tuyaApiCalls;
                const effDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
                if (runningDaily >= effDL || runningMonthly >= (quotaData.monthly_limit || 900)) {
                  quotaExhausted = true;
                  console.log(`[PV-Automation] ⚠️ Quota mid-run erschöpft nach ${tuyaApiCalls} Calls (deactivate)`);
                }
              }
            }
          }

          if (success || !room.tuya_device_id) {
            // Clear any existing errors for this room on success
            // Lokal-Modus (08.11.2026): Erreichbarkeits-Fehler NICHT schließen – der Befehl ist nur eingereiht.
            // Die schließt auto-resolve-api-errors, sobald das Gerät wirklich gelesen wurde.
            {
              let clearQuery = supabase
                .from('api_errors')
                .update({ resolved_at: now.toISOString() })
                .eq('room_id', room.id)
                .is('resolved_at', null);
              if (controlMode !== 'cloud') clearQuery = clearQuery.not('error_type', 'in', '(device_offline,connection_error)');
              await clearQuery;
            }
            await supabase.from('rooms').update({
              pv_auto_active: false,
              pv_auto_last_change: now.toISOString(),
              last_auto_change: now.toISOString(),
              // Lokal-Modus (08.11.2026): „erfolgreich“ heißt nur „eingereiht“ – Erreichbarkeit und Heizstatus schreibt allein der Thermostat-Dienst nach echter Lesung (FIX-LOKAL-ERREICHBARKEIT-2026-11-08).
              ...(controlMode === 'cloud' ? { last_thermostat_sync: now.toISOString() } : {}),
              target_temp: finalTemp,
              solar_limit_temp: null // Solar-Limit zurücksetzen
            }).eq('id', room.id);

            // Tagesmodus-Ziel: kein PV-Steuerereignis, keine geschätzte Heizenergie protokollieren
            if (dayModeApplied) {
              results.push({ roomId: room.id, roomName: room.name, action, targetTemp, reasoning, mlBased: false, success: true, dayMode });
              continue;
            }

            // Calculate duration and energy for solar_limit_stop event
            let durationMinutes = 2; // Default fallback
            let energyEstimateWh = 0;

            // Find the last solar_limit_start event for this room
            const { data: lastStart } = await supabase
              .from('room_heating_logs')
              .select('timestamp, consumption_at_start_w')
              .eq('room_id', room.id)
              .eq('event_type', 'solar_limit_start')
              .order('timestamp', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (lastStart?.timestamp) {
              const startTime = new Date(lastStart.timestamp).getTime();
              const endTime = now.getTime();
              const calculatedDuration = Math.round((endTime - startTime) / 60000);
              
              // Plausibility check: Max 4 hours (240 min)
              if (calculatedDuration > 0 && calculatedDuration <= 240) {
                durationMinutes = calculatedDuration;
              }
            }

            // Calculate energy based on room power
            const effectivePower = room.heating_power_w || room.calculated_power_w || 
              (room.floor_area_m2 ? room.floor_area_m2 * 60 : 800);
            energyEstimateWh = Math.round((effectivePower * durationMinutes) / 60);

            console.log(`[PV-Automation] ${room.name} solar_limit_stop: duration=${durationMinutes}min, energy=${energyEstimateWh}Wh`);

            await supabase.from('room_heating_logs').insert({
              room_id: room.id,
              event_type: 'solar_limit_stop',
              current_temp: room.current_temp,
              target_temp: ecoTemp,
              pv_surplus_w: surplus,
              duration_minutes: durationMinutes,
              energy_estimate_wh: energyEstimateWh,
              consumption_at_start_w: lastStart?.consumption_at_start_w || null
            });

            // Delete the used solar_limit_start to prevent reuse
            if (lastStart) {
              await supabase
                .from('room_heating_logs')
                .delete()
                .eq('room_id', room.id)
                .eq('event_type', 'solar_limit_start')
                .eq('timestamp', lastStart.timestamp);
            }

            success = true;
          } else if (tuyaError) {
            // Log API error
            await supabase.from('api_errors').insert({
              source: 'pv-automation',
              room_id: room.id,
              room_name: room.name,
              error_type: tuyaError.errorType || 'tuya_api',
              error_message: tuyaError.errorMessage?.slice(0, 500),
              device_id: room.tuya_device_id,
            });
            console.error(`[PV-Automation] Tuya API error for ${room.name}: ${tuyaError.errorMessage}`);
          }
        }

        results.push({
          roomId: room.id,
          roomName: room.name,
          action,
          targetTemp,
          solarLimitTemp,
          reasoning,
          mlBased: usedMlDecision && !!mlDecision,
          confidence,
          learningEventId: eventData?.id,
          success
        });
      }

      // Trigger evaluation of old learning events (self-learning loop)
      let evaluationResult = null;
      try {
        const evalResponse = await fetch(`${supabaseUrl}/functions/v1/evaluate-decision`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ evaluate_all: true })
        });
        if (evalResponse.ok) {
          evaluationResult = await evalResponse.json();
          console.log(`[PV-Automation] Evaluated ${evaluationResult.evaluated || 0} old learning events`);
        }
      } catch (evalError) {
        console.error('[PV-Automation] Evaluation trigger error:', evalError);
      }

      // ============= QUOTA PERSISTIEREN =============
      if (quotaData && tuyaApiCalls > 0) {
        // Jeder tuyaApiCall = 1 command API call (Token ist gecached)
        quotaData.calls_this_month += tuyaApiCalls;
        quotaData.calls_today += tuyaApiCalls;
      }
      if (quotaData) {
        await supabase.from('system_settings')
          .update({ value: quotaData, updated_at: new Date().toISOString() })
          .eq('key', 'tuya_api_quota');
      }

      // ML-Exploration-Throttle persistieren
      if (typeof mlExplorationUpdates !== 'undefined' && Object.keys(mlExplorationUpdates).length > 0) {
        try {
          const merged: Record<string, string> = { ...(mlExplorationMap || {}), ...mlExplorationUpdates };
          // alte Einträge (>2h) ausräumen
          const cutoff = Date.now() - 2 * 60 * 60 * 1000;
          for (const [k, v] of Object.entries(merged)) {
            if (new Date(v).getTime() < cutoff) delete merged[k];
          }
          await supabase.from('system_settings').upsert(
            { key: 'ml_exploration_throttle', value: merged, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
          );
        } catch (e: any) {
          console.error(`[ML-THROTTLE] Persist-Fehler:`, e?.message ?? e);
        }
      }

      const quotaInfo = quotaData 
        ? ` | Quota: ${quotaData.calls_today}/${quotaData.daily_limit} heute, ${quotaData.calls_this_month}/${quotaData.monthly_limit} monatlich`
        : '';
      const pvPriorityInfo = pvPriorityMode ? ` | ⚡ PV-Priority: ${pvPriorityCalls}/${PV_PRIORITY_MAX_CALLS} Calls` : '';
      const tolerantInfo = typeof tolerantSavedCalls !== 'undefined' && tolerantSavedCalls > 0 ? ` | 🛡️ Tolerant gespart: ~${tolerantSavedCalls} Deaktivierungen` : '';
      console.log(`[TUYA-QUOTA-RUN] ${tuyaApiCalls} Tuya-Calls in diesem Run${tolerantInfo}`);
      console.log(`[PV-Automation] Complete. Tuya API calls: ${tuyaApiCalls}${quotaInfo}${pvPriorityInfo}${quotaExhausted && !pvPriorityMode ? ' ⚠️ QUOTA-FALLBACK aktiv' : ''}`);

      return new Response(JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        surplus,
        batterySoc,
        usedMlDecision,
        results,
        tuyaApiCalls,
        quotaExhausted,
        pvPriorityMode,
        pvPriorityCalls,
        quotaStatus: quotaData ? { today: quotaData.calls_today, dailyLimit: quotaData.daily_limit, month: quotaData.calls_this_month, monthlyLimit: quotaData.monthly_limit } : null,
        evaluatedEvents: evaluationResult?.evaluated || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[PV-Automation] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
