import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const TZ = 'Europe/Vienna';

function nowVienna() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday as string);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour as string),
    minute: parseInt(parts.minute as string),
    dom: parseInt(parts.day as string),
    dow, // 0=Sun..6=Sat
  };
}

function timeToMin(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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

async function invokeFn(name: string, body: any) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

async function getLastRun(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  return (data?.value as any)?.last_run_date ?? null;
}
async function setLastRun(key: string, dateStr: string, extra: Record<string, unknown> = {}) {
  await supabase.from('system_settings').upsert({
    key,
    value: { last_run_date: dateStr, last_run_at: new Date().toISOString(), ...extra },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!await authorize(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get('force'); // 'daily'|'weekly'|'monthly'|'match_today'

    const { data: hs } = await supabase.from('heating_settings').select('*').limit(1).maybeSingle();
    if (!hs) {
      return new Response(JSON.stringify({ error: 'no heating_settings' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const t = nowVienna();
    const nowMin = t.hour * 60 + t.minute;
    const triggered: Array<{ job: string; status: number }> = [];

    // Slot von 30 min ab konfigurierter Zeit (cron läuft alle 15 min → 2 chances)
    const within = (target: string | null) => {
      const m = timeToMin(target);
      return nowMin >= m && nowMin < m + 30;
    };

    // 1) Daily score (gestern)
    if (force === 'daily' || (hs.analysis_daily_enabled && within(hs.analysis_daily_time))) {
      const last = await getLastRun('scheduler_daily');
      if (force === 'daily' || last !== t.date) {
        const r = await invokeFn('compute-daily-score', {});
        triggered.push({ job: 'daily', status: r.status });
        await setLastRun('scheduler_daily', t.date);
      }
    }

    // 2) Match today
    if (force === 'match_today' || (hs.analysis_match_today_enabled && within(hs.analysis_match_today_time))) {
      const last = await getLastRun('scheduler_match_today');
      if (force === 'match_today' || last !== t.date) {
        const r = await invokeFn('analyze-patterns', { type: 'match_today' });
        triggered.push({ job: 'match_today', status: r.status });
        await setLastRun('scheduler_match_today', t.date);
      }
    }

    // 3) Weekly (am konfigurierten Wochentag)
    if (force === 'weekly' || (hs.analysis_weekly_enabled && t.dow === (hs.analysis_weekly_weekday ?? 0) && within(hs.analysis_weekly_time))) {
      const last = await getLastRun('scheduler_weekly');
      if (force === 'weekly' || last !== t.date) {
        const r = await invokeFn('analyze-patterns', { type: 'weekly_comparison_auto' });
        triggered.push({ job: 'weekly', status: r.status });
        await setLastRun('scheduler_weekly', t.date);
      }
    }

    // 4) Monthly (am konfigurierten Tag des Monats)
    if (force === 'monthly' || (hs.analysis_monthly_enabled && t.dom === (hs.analysis_monthly_dom ?? 1) && within(hs.analysis_monthly_time))) {
      const last = await getLastRun('scheduler_monthly');
      if (force === 'monthly' || last !== t.date) {
        const r = await invokeFn('analyze-patterns', { type: 'monthly_pattern' });
        triggered.push({ job: 'monthly', status: r.status });
        await setLastRun('scheduler_monthly', t.date);
      }
    }

    // 5) Battery-SOC-Vorschlag täglich 21:00 (force='suggest_battery_soc' für Test)
    const socSuggestTimeMin = 21 * 60; // 21:00 Europe/Vienna, fester Slot 30 min
    const withinSocSuggestSlot = nowMin >= socSuggestTimeMin && nowMin < socSuggestTimeMin + 30;
    if (force === 'suggest_battery_soc' || withinSocSuggestSlot) {
      const last = await getLastRun('scheduler_suggest_battery_soc');
      if (force === 'suggest_battery_soc' || last !== t.date) {
        // Sub-Route am ai-parameter-advisor
        const url = `${SUPABASE_URL}/functions/v1/ai-parameter-advisor/suggest-battery-soc`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
          body: '{}',
        });
        triggered.push({ job: 'suggest_battery_soc', status: res.status });
        await setLastRun('scheduler_suggest_battery_soc', t.date);
      }
    }

      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('analysis-scheduler error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
