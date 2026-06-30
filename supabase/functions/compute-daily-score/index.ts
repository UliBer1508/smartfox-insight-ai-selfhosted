import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

type Sig = {
  sig_weather: 'sunny' | 'mixed' | 'cloudy';
  sig_pv_bucket: 'low' | 'mid' | 'high';
  sig_temp_bucket: 'cold' | 'mild' | 'warm';
  sig_weekday: 'workday' | 'weekend';
};

function bucketWeather(expected: number, peakPV: number): Sig['sig_weather'] {
  // Verhältnis tatsächlicher Peak zu erwartetem kWh als grober Wetter-Proxy
  if (expected <= 0) return 'cloudy';
  const ratio = peakPV / 1000 / Math.max(expected, 1); // kW peak / kWh expected
  if (ratio > 0.18) return 'sunny';
  if (ratio > 0.08) return 'mixed';
  return 'cloudy';
}
function bucketPv(expected: number): Sig['sig_pv_bucket'] {
  if (expected < 30) return 'low';
  if (expected < 60) return 'mid';
  return 'high';
}
function bucketTemp(c: number | null): Sig['sig_temp_bucket'] {
  if (c == null) return 'mild';
  if (c < 5) return 'cold';
  if (c < 15) return 'mild';
  return 'warm';
}
function bucketWeekday(d: Date): Sig['sig_weekday'] {
  const wd = d.getUTCDay(); // good enough — date level
  return (wd === 0 || wd === 6) ? 'weekend' : 'workday';
}

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

async function scoreOneDay(dateStr: string): Promise<{ ok: boolean; reason?: string; score?: number }> {
  // Anzahl Tage zurück bis zum Zieltag (max 90)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00Z');
  const daysBack = Math.max(1, Math.min(90, Math.round((today.getTime() - target.getTime()) / 86400000) + 1));

  // 1) Tageskennzahlen
  const { data: weekly, error: wErr } = await supabase.rpc('get_weekly_energy_summary', { days_back: daysBack });
  if (wErr) return { ok: false, reason: `RPC error: ${wErr.message}` };
  const row = (weekly as any[]).find((r) => String(r.date).slice(0, 10) === dateStr);
  if (!row) return { ok: false, reason: 'no data row for date' };

  // 2) Forecast (expected kWh)
  const { data: fc } = await supabase
    .from('pv_forecasts')
    .select('expected_kwh, hourly_watts')
    .eq('date', dateStr)
    .maybeSingle();
  const expected_pv_kwh = Number(fc?.expected_kwh ?? row.pv_kwh ?? 0);

  // 3) Heizung-PV-Coverage: Anteil Heiz-Logs mit pv_surplus_w > 0
  const dayStart = `${dateStr}T00:00:00+02:00`;
  const dayEnd = `${dateStr}T23:59:59+02:00`;
  const { data: heatLogs } = await supabase
    .from('room_heating_logs')
    .select('energy_estimate_wh, pv_surplus_w, event_type')
    .gte('timestamp', dayStart)
    .lte('timestamp', dayEnd)
    .in('event_type', ['heating_stop', 'solar_limit_stop']);
  let heatTotal = 0, heatPv = 0;
  for (const l of (heatLogs ?? [])) {
    const wh = Number(l.energy_estimate_wh ?? 0);
    heatTotal += wh;
    if ((l.pv_surplus_w ?? 0) > 0) heatPv += wh;
  }
  const kpi_pv_heating_coverage = heatTotal > 0 ? heatPv / heatTotal : 0;

  // 4) End-Battery-SoC
  const { data: lastReading } = await supabase
    .from('energy_readings')
    .select('battery_soc')
    .gte('timestamp', dayStart)
    .lte('timestamp', dayEnd)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  const kpi_battery_end_soc = Number(lastReading?.battery_soc ?? 0);

  // 5) KPI Eigenverbrauchsquote
  const pv_kwh = Number(row.pv_kwh ?? 0);
  const feed_in_kwh = Number(row.feed_in_kwh ?? row.energy_out_kwh ?? 0);
  const kpi_self_consumption_ratio = pv_kwh > 0
    ? Math.max(0, Math.min(1, (pv_kwh - feed_in_kwh) / pv_kwh))
    : 0;
  const kpi_grid_import_kwh = Number(row.energy_in_kwh ?? 0);

  // 6) Signatur
  const sig: Sig = {
    sig_weather: bucketWeather(expected_pv_kwh, Number(row.peak_power ?? 0)),
    sig_pv_bucket: bucketPv(expected_pv_kwh),
    sig_temp_bucket: bucketTemp(row.avg_outdoor_c == null ? null : Number(row.avg_outdoor_c)),
    sig_weekday: bucketWeekday(target),
  };

  // 7) Settings-Snapshot
  const { data: hs } = await supabase.from('heating_settings').select('*').limit(1).maybeSingle();
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, name, comfort_temp, eco_temp, night_temp, priority, automation_enabled, pv_auto_enabled');
  const settings_snapshot = {
    heating_min_battery_soc: hs?.heating_min_battery_soc,
    pv_surplus_threshold_on: hs?.pv_surplus_threshold_on,
    pv_surplus_threshold_off: hs?.pv_surplus_threshold_off,
    comfort_temp: hs?.comfort_temp,
    eco_temp: hs?.eco_temp,
    night_temp: hs?.night_temp,
    night_heating_mode: hs?.night_heating_mode,
    night_start_time: hs?.night_start_time,
    night_end_time: hs?.night_end_time,
    rooms: (rooms ?? []).map((r) => ({
      id: r.id, name: r.name,
      comfort: r.comfort_temp, eco: r.eco_temp, night: r.night_temp,
      priority: r.priority, auto: r.automation_enabled, pv_auto: r.pv_auto_enabled,
    })),
  };

  // 8) Score: 60% Eigenverbrauch + 40% PV-Heizungsanteil; Penalty wenn viel Netzbezug
  const baseScore = (kpi_self_consumption_ratio * 60) + (kpi_pv_heating_coverage * 40);
  const importPenalty = Math.min(20, kpi_grid_import_kwh * 0.5); // 0.5 Punkte pro kWh, max 20
  const score = Math.max(0, Math.min(100, baseScore - importPenalty));

  // 9) Upsert
  const { error: upErr } = await supabase.from('daily_pattern_scores').upsert({
    date: dateStr,
    ...sig,
    kpi_self_consumption_ratio,
    kpi_pv_heating_coverage,
    kpi_grid_import_kwh,
    kpi_battery_end_soc,
    pv_kwh,
    feed_in_kwh,
    heating_kwh: Number(row.heating_kwh ?? 0),
    expected_pv_kwh,
    avg_outdoor_c: row.avg_outdoor_c,
    score,
    settings_snapshot,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'date' });
  if (upErr) return { ok: false, reason: `upsert error: ${upErr.message}` };

  // 10) Rank in signature aktualisieren
  const { data: sigDays } = await supabase
    .from('daily_pattern_scores')
    .select('date, score')
    .eq('sig_weather', sig.sig_weather)
    .eq('sig_pv_bucket', sig.sig_pv_bucket)
    .eq('sig_temp_bucket', sig.sig_temp_bucket)
    .eq('sig_weekday', sig.sig_weekday)
    .order('score', { ascending: false });
  if (sigDays) {
    for (let i = 0; i < sigDays.length; i++) {
      await supabase
        .from('daily_pattern_scores')
        .update({ rank_in_signature: i + 1 })
        .eq('date', sigDays[i].date);
    }
  }

  return { ok: true, score };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!await authorize(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    let body: { date?: string; backfill?: number } = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dates: string[] = [];
    if (body.backfill && body.backfill > 0) {
      const n = Math.min(90, body.backfill);
      for (let i = 1; i <= n; i++) {
        const d = new Date(today.getTime() - i * 86400000);
        dates.push(d.toISOString().slice(0, 10));
      }
    } else if (body.date) {
      dates.push(body.date);
    } else {
      // Default: gestern + automatischer Self-Backfill für die letzten 7 Tage,
      // damit Lücken (z. B. Edge Function pausiert) ohne manuellen Eingriff
      // nachgeholt werden.
      const candidates: string[] = [];
      for (let i = 1; i <= 7; i++) {
        const d = new Date(today.getTime() - i * 86400000);
        candidates.push(d.toISOString().slice(0, 10));
      }
      const { data: existing } = await supabase
        .from('daily_pattern_scores')
        .select('date')
        .in('date', candidates);
      const have = new Set((existing ?? []).map((r: any) => String(r.date).slice(0, 10)));
      const missing = candidates.filter((d) => !have.has(d));
      // „Gestern" garantiert dabei (Idempotent durch Upsert), zusätzlich alle fehlenden Tage
      const yesterday = candidates[0];
      const set = new Set<string>([yesterday, ...missing]);
      dates.push(...Array.from(set).sort().reverse()); // neuester zuerst
      console.log(`[compute-daily-score] auto-run: ${dates.length} dates (missing: ${missing.length})`);
    }

    const results: Array<{ date: string; ok: boolean; reason?: string; score?: number }> = [];
    for (const d of dates) {
      const r = await scoreOneDay(d);
      results.push({ date: d, ...r });
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('compute-daily-score error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});