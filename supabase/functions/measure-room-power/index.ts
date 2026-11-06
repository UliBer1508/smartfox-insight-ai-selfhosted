// measure-room-power (06.11.2026) – doc/FIX-HEIZLEISTUNG-2026-11-06.md
//
// Misst die echte Heizleistung je Raum. Uli 06.11.2026: „wir haben keine Kontrolle über den Stromverbrauch
// der Heizung“ – die Steuerung rechnete mit geschätzten Leistungen (Wirtschaftsraum 700 W statt ~2050 W,
// Haustür/Toilette leer → 800 W angenommen).
//
// Methode: Für jeden Fronius-Messwert OHNE PV (dann laufen Warmwasser und Auto nicht) ist
//   Hausverbrauch ≈ Grundlast + Σ (Raum heizt × Raumleistung)
// „Raum heizt“ ist der Anteil 0 / 0,5 / 1 aus den Thermostat-Abfragen davor und danach (SQL raum_leistung_daten).
// Lineare Regression (kleinste Quadrate), drei Durchläufe; Ausreißer (Espressomaschine, Herd …) fallen raus.
//
// Ergebnis:
//   raum_leistung_messung  – je Raum Watt, Messpunkte, Sicherheit (+ Zeile „Grundlast“)
//   ki_vorschlaege         – nur wenn die Messung sicher ist und deutlich vom eingestellten Wert abweicht.
//                            Die Messung ändert nichts selbst – Uli genehmigt in KI › Zu entscheiden.
//
// Aufruf: POST (täglich 09:30 über analysis-scheduler) · Test: POST ?tage=14&dry=1 (nur rechnen, nichts schreiben)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TAGE_STANDARD = 14;
const MIN_VOLL_PUNKTE_VORSCHLAG = 30;   // so viele ganze 5-Minuten-Werte „heizt“ braucht ein Vorschlag (≈ 2,5 h)
const MIN_PUNKTE_SPALTE = 5;            // darunter wird der Raum nicht mitgerechnet (zu wenig Daten)
const ABWEICHUNG_MIN_W = 150;           // Vorschlag erst ab 150 W …
const ABWEICHUNG_MIN_ANTEIL = 0.15;     // … und 15 % Abweichung
const SPERRE_ABGELEHNT_TAGE = 14;       // abgelehnter Vorschlag kommt so lange nicht wieder (bei ähnlichem Wert)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function authorize(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.replace('Bearer ', '');
  const known = [SERVICE_KEY, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
  if (known.includes(token)) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return ['authenticated', 'service_role'].includes(payload.role || payload.aud);
  } catch { return false; }
}

/** Löst A·x = b (Gauß mit Spaltenpivot). A ist n×n. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

/** Kleinste Quadrate mit kleiner Dämpfung (λ) gegen schlecht bestimmte Spalten. */
function leastSquares(X: number[][], y: number[], lambda = 1e-3): number[] {
  const m = X[0].length;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i];
    for (let j = 0; j < m; j++) {
      if (xi[j] === 0) continue;
      b[j] += xi[j] * y[i];
      for (let k = 0; k < m; k++) A[j][k] += xi[j] * xi[k];
    }
  }
  for (let j = 0; j < m; j++) A[j][j] += lambda;
  return solve(A, b);
}

const runde50 = (w: number) => Math.round(w / 50) * 50;
const sicherheitVon = (voll: number) => voll >= 60 ? 'hoch' : voll >= MIN_VOLL_PUNKTE_VORSCHLAG ? 'mittel' : voll >= MIN_PUNKTE_SPALTE ? 'gering' : 'keine';
const viennaDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!await authorize(req)) return json({ error: 'Unauthorized' }, 401);

  try {
    const url = new URL(req.url);
    const tage = Math.min(30, Math.max(3, Number(url.searchParams.get('tage')) || TAGE_STANDARD));
    const dry = url.searchParams.get('dry') === '1';
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: daten, error: dErr } = await sb.rpc('raum_leistung_daten', { p_tage: tage });
    if (dErr) throw new Error(`raum_leistung_daten: ${dErr.message} (SQL 24 ausgeführt?)`);
    const rooms = (daten?.rooms ?? []) as Array<{ id: string; name: string; heating_power_w: number | null }>;
    const rows = (daten?.rows ?? []) as Array<[number, number, Array<number | null> | null]>;

    // Nur Messwerte, in denen jeder Raum einen Wert hat
    const voll = rows.filter(r => Array.isArray(r[2]) && r[2].length === rooms.length && r[2].every(v => v !== null));
    if (voll.length < 50) return json({ ok: false, grund: `zu wenig Messwerte ohne PV (${voll.length})` });

    // Räume mit zu wenig „heizt“ nicht als eigene Spalte rechnen (sonst ist die Rechnung nicht bestimmt)
    const heizPunkte = rooms.map((_, j) => voll.filter(r => (r[2] as number[])[j] > 0).length);
    const spalten = rooms.map((_, j) => j).filter(j => heizPunkte[j] >= MIN_PUNKTE_SPALTE);

    const X = voll.map(r => [...spalten.map(j => (r[2] as number[])[j]), 1]);
    const y = voll.map(r => r[1]);

    // Drei Durchläufe, Ausreißer raus (Espressomaschine ~1,5 kW, Herd, Wasserkocher …)
    let keep = y.map(() => true);
    let coef: number[] = [];
    let mae = 0;
    for (let lauf = 0; lauf < 3; lauf++) {
      const Xk = X.filter((_, i) => keep[i]);
      const yk = y.filter((_, i) => keep[i]);
      coef = leastSquares(Xk, yk);
      const res = X.map((x, i) => y[i] - x.reduce((s, v, k) => s + v * coef[k], 0));
      const resK = res.filter((_, i) => keep[i]);
      const sd = Math.sqrt(resK.reduce((s, v) => s + v * v, 0) / Math.max(1, resK.length));
      const grenze = Math.max(600, 3 * sd);
      keep = res.map(v => Math.abs(v) < grenze);
      mae = resK.reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, resK.length);
    }
    const genutzt = keep.filter(Boolean).length;
    const grundlast = Math.round(coef[coef.length - 1]);

    const ergebnis = rooms.map((r, j) => {
      const k = spalten.indexOf(j);
      const vollPunkte = voll.filter((row, i) => keep[i] && (row[2] as number[])[j] === 1).length;
      const punkte = voll.filter((row, i) => keep[i] && (row[2] as number[])[j] > 0).length;
      const watt = k >= 0 ? Math.max(0, Math.round(coef[k])) : null;
      return { room_id: r.id, raum: r.name, watt, punkte, voll_punkte: vollPunkte,
               eingestellt_w: r.heating_power_w == null ? null : Math.round(Number(r.heating_power_w)),
               sicherheit: watt == null ? 'keine' : sicherheitVon(vollPunkte) };
    });

    if (!dry) {
      const jetzt = new Date().toISOString();
      const zeilen = [
        ...ergebnis.map(e => ({ ...e, gemessen_at: jetzt, tage, mittl_abweichung_w: Math.round(mae) })),
        { gemessen_at: jetzt, tage, room_id: null, raum: 'Grundlast', watt: grundlast, punkte: genutzt, voll_punkte: genutzt,
          eingestellt_w: null, sicherheit: 'hoch', mittl_abweichung_w: Math.round(mae) },
      ];
      const { error: insErr } = await sb.from('raum_leistung_messung').insert(zeilen);
      if (insErr) throw new Error(`raum_leistung_messung: ${insErr.message}`);
    }

    // ---- Vorschläge (nur Vorschlag – Uli genehmigt) ----
    const { data: wlRow } = await sb.from('ai_parameter_whitelist').select('min_value, max_value, enabled, autonomy_level')
      .eq('parameter_key', 'heating_power_w').eq('scope', 'room').maybeSingle();
    const vorschlaege: any[] = [];
    if (wlRow?.enabled && wlRow.autonomy_level === 'suggest') {
      const seit = new Date(Date.now() - SPERRE_ABGELEHNT_TAGE * 86400000).toISOString();
      const { data: bisher } = await sb.from('ki_vorschlaege').select('room_id, status, neu_wert, created_at')
        .eq('parameter_key', 'heating_power_w').gte('created_at', seit);
      for (const e of ergebnis) {
        if (e.watt == null || e.voll_punkte < MIN_VOLL_PUNKTE_VORSCHLAG) continue;
        const neu = Math.min(Number(wlRow.max_value ?? 8000), Math.max(Number(wlRow.min_value ?? 50), runde50(e.watt)));
        const alt = e.eingestellt_w;
        const diff = alt == null ? Infinity : Math.abs(neu - alt);
        if (alt != null && (diff < ABWEICHUNG_MIN_W || diff < ABWEICHUNG_MIN_ANTEIL * alt)) continue;
        const frueher = (bisher ?? []).filter((b: any) => b.room_id === e.room_id);
        if (frueher.some((b: any) => b.status === 'offen')) continue;
        if (frueher.some((b: any) => b.status === 'abgelehnt' && Math.abs(Number(b.neu_wert) - neu) <= 0.1 * neu)) continue;
        const stunden = (e.voll_punkte * 5 / 60).toFixed(1).replace('.', ',');
        vorschlaege.push({
          tag: viennaDate(new Date()), quelle: 'leistungsmessung', art: 'vorschlag',
          titel: alt == null
            ? `${e.raum}: Heizleistung ${neu} W eintragen?`
            : `${e.raum}: Heizleistung von ${alt} W auf ${neu} W ${neu > alt ? 'anheben' : 'senken'}?`,
          was: `Die Steuerung rechnet für ${e.raum} künftig mit ${neu} W${alt == null ? ' (bisher leer, angenommen wurden 800 W)' : ` statt ${alt} W`}. `
            + `Damit stimmt die Leistungsgrenze und die Anzeige „Heizung jetzt“.`,
          warum: `Gemessen in den letzten ${tage} Tagen ohne PV: Wenn ${e.raum} heizt, steigt der Hausverbrauch um etwa ${e.watt} W `
            + `(${e.voll_punkte} volle Messwerte, rund ${stunden} h Heizen; Sicherheit ${e.sicherheit}). `
            + `Die Rechnung trifft den Verbrauch im Mittel auf ${Math.round(mae)} W genau.`,
          wirkung_text: alt != null && neu > alt
            ? 'Die Steuerung plant mit mehr Leistung – unter der Grenze heizen dann weniger Räume gleichzeitig, dafür wird die Grenze wirklich eingehalten.'
            : 'Die Steuerung plant mit weniger Leistung – unter der Grenze haben mehr Räume gleichzeitig Platz.',
          parameter_key: 'heating_power_w', scope: 'room', room_id: e.room_id,
          alt_wert: alt, neu_wert: neu, min_wert: Number(wlRow.min_value ?? 50), max_wert: Number(wlRow.max_value ?? 8000),
          einheit: 'W', tage_basis: tage,
          belege: { gemessen_w: e.watt, punkte: e.punkte, voll_punkte: e.voll_punkte, grundlast_w: grundlast, mittl_abweichung_w: Math.round(mae) },
        });
      }
      if (!dry && vorschlaege.length > 0) {
        const { error: vErr } = await sb.from('ki_vorschlaege').insert(vorschlaege);
        if (vErr) throw new Error(`ki_vorschlaege: ${vErr.message}`);
      }
    }

    console.log(`[LEISTUNG] ${voll.length} Messwerte, ${genutzt} genutzt, mittl. Abw. ${Math.round(mae)} W, Grundlast ${grundlast} W, ${vorschlaege.length} Vorschläge${dry ? ' (dry)' : ''}`);
    return json({ ok: true, dry, tage, messwerte: voll.length, genutzt, mittl_abweichung_w: Math.round(mae), grundlast_w: grundlast,
                  raeume: ergebnis, vorschlaege: vorschlaege.map(v => v.titel) });
  } catch (e) {
    console.error('measure-room-power:', e);
    return json({ error: String(e) }, 500);
  }
});
