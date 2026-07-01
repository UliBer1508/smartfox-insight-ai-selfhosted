// ============================================================================
//  record-pv-accuracy
//  Zweck: Einmal täglich SPÄT (Tag komplett, Rohdaten noch nicht gelöscht)
//         die tatsächliche PV-Tagesproduktion gegen die Prognose festhalten.
//         Schreibt eine retentionsfeste Zeile nach pv_forecast_accuracy.
//
//  Warum: energy_readings (pv_power) wird nach 7 Tagen gelöscht. Damit das
//         System langfristig seinen Saisonfaktor aus echten Daten lernen kann,
//         muss Prognose-vs-Ist VOR der Löschung dauerhaft gesichert werden.
//         Vorbild-Logik: Trapez-Integration aus pv-automation (~Z.1336-1348),
//         Buckets aus compute-daily-score.
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

// --- Wetter-/PV-Buckets: identisch zu compute-daily-score ---
function bucketWeather(expected: number, peakPvW: number): 'sunny' | 'mixed' | 'cloudy' {
  if (expected <= 0) return 'cloudy';
  const ratio = (peakPvW / 1000) / Math.max(expected, 1); // kW peak / kWh expected
  if (ratio > 0.18) return 'sunny';
  if (ratio > 0.08) return 'mixed';
  return 'cloudy';
}
function bucketPv(expected: number): 'low' | 'mid' | 'high' {
  if (expected < 30) return 'low';
  if (expected < 60) return 'mid';
  return 'high';
}

// --- Auth: gleiches Muster wie compute-daily-score ---
async function authorize(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.replace('Bearer ', '');
  const known = [SERVICE_ROLE, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
  if (known.includes(token)) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return ['anon', 'authenticated', 'service_role'].includes(payload.role || payload.aud);
  } catch { return false; }
}

// --- Wien-Datum, sauberes en-CA-Muster (KEIN toISOString-Doppelcast) ---
function getTodayVienna(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' }); // YYYY-MM-DD
}

// --- Trapez-Integration über pv_power (W) -> kWh; Lücken >10min überspringen ---
//     Übernommen aus pv-automation (bewährte Logik).
function integrateKwh(samples: Array<{ t: Date; w: number }>): { kwh: number; peakW: number; n: number } {
  const pts = samples.slice().sort((a, b) => a.t.getTime() - b.t.getTime());
  let wh = 0;
  let peak = 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].w > peak) peak = pts[i].w;
    if (i === 0) continue;
    const dtH = (pts[i].t.getTime() - pts[i - 1].t.getTime()) / 3_600_000;
    if (dtH <= 0 || dtH > 10 / 60) continue; // Lücke >10min -> nicht integrieren
    wh += ((pts[i].w + pts[i - 1].w) / 2) * dtH;
  }
  return { kwh: wh / 1000, peakW: peak, n: pts.length };
}

async function recordOneDay(dateStr: string) {
  // Tagesgrenzen in Wien-Zeit (Sommer +02:00). Hinweis: bei Winterzeit +01:00;
  // für die Tages-Integration unkritisch, da wir alle Samples des Kalendertags nehmen.
  const dayStart = `${dateStr}T00:00:00+02:00`;
  const dayEnd = `${dateStr}T23:59:59+02:00`;

  // 1) pv_power-Samples des Tages laden
  const { data: rows, error } = await supabase
    .from('energy_readings')
    .select('timestamp, pv_power')
    .gte('timestamp', dayStart)
    .lte('timestamp', dayEnd)
    .order('timestamp', { ascending: true })
    .limit(5000); // Supabase-Default ist 1000 -> an vollen Tagen sonst abgeschnitten
  if (error) return { ok: false, reason: `energy_readings: ${error.message}` };
  if (!rows || rows.length === 0) return { ok: false, reason: 'keine energy_readings für Tag' };

  const samples = rows
    .filter((r: any) => r.pv_power != null)
    .map((r: any) => ({ t: new Date(r.timestamp), w: Number(r.pv_power) }));
  const { kwh: actualKwh, peakW, n } = integrateKwh(samples);

  // 2) Prognose für diesen Tag holen
  const { data: fc } = await supabase
    .from('pv_forecasts')
    .select('expected_kwh')
    .eq('date', dateStr)
    .maybeSingle();
  const forecastKwh = fc?.expected_kwh != null ? Number(fc.expected_kwh) : null;

  // 3) Kennzahlen
  const abweichung = forecastKwh != null ? actualKwh - forecastKwh : null;
  const ratio = forecastKwh != null && forecastKwh > 0 ? actualKwh / forecastKwh : null;
  const monat = parseInt(dateStr.slice(5, 7), 10);
  const sigWeather = bucketWeather(forecastKwh ?? 0, peakW);
  const sigPv = bucketPv(forecastKwh ?? 0);

  // 4) Upsert (idempotent über date)
  const { error: upErr } = await supabase.from('pv_forecast_accuracy').upsert({
    date: dateStr,
    forecast_kwh: forecastKwh,
    actual_kwh: Number(actualKwh.toFixed(2)),
    abweichung_kwh: abweichung != null ? Number(abweichung.toFixed(2)) : null,
    ratio: ratio != null ? Number(ratio.toFixed(3)) : null,
    saison_monat: monat,
    sig_weather: sigWeather,
    sig_pv_bucket: sigPv,
    samples: n,
  }, { onConflict: 'date' });
  if (upErr) return { ok: false, reason: `upsert: ${upErr.message}` };

  return {
    ok: true,
    date: dateStr,
    forecast_kwh: forecastKwh,
    actual_kwh: Number(actualKwh.toFixed(2)),
    ratio: ratio != null ? Number(ratio.toFixed(3)) : null,
    samples: n,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!await authorize(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  try {
    // optionaler body.date für manuelle Nachläufe; Default = heute (Wien)
    let body: { date?: string } = {};
    try { body = await req.json(); } catch { /* leerer body ok */ }
    const dateStr = body.date || getTodayVienna();

    const result = await recordOneDay(dateStr);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 422,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('record-pv-accuracy error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

