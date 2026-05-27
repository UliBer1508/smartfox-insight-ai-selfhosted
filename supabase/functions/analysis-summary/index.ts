import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RangeType = 'day' | 'week' | 'month';

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!key) throw new Error('GOOGLE_AI_API_KEY not configured');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 800 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

function rangeDays(type: RangeType): number {
  if (type === 'day') return 2;     // today + yesterday
  if (type === 'week') return 7;
  return 30;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const type: RangeType = (body?.type as RangeType) || 'day';
    const days = rangeDays(type);

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days + 1);
    const sinceISO = sinceDate.toISOString().slice(0, 10);

    const { data: scores, error } = await supabase
      .from('daily_pattern_scores')
      .select('date, kpi_self_consumption_ratio, kpi_pv_heating_coverage, kpi_grid_import_kwh, score, pv_kwh, heating_kwh, sig_weather, sig_pv_bucket')
      .gte('date', sinceISO)
      .order('date', { ascending: true });
    if (error) throw error;

    const rows = scores || [];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, summary: 'Noch keine Tagesscores vorhanden. Bitte Backfill starten.', stats: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const scrVals = rows.map((r: any) => Number(r.kpi_self_consumption_ratio || 0));
    const avgSCR = scrVals.reduce((a, b) => a + b, 0) / scrVals.length;
    const bestSCR = Math.max(...scrVals);
    const worstSCR = Math.min(...scrVals);
    const latest = rows[rows.length - 1];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const delta = previous ? Number(latest.kpi_self_consumption_ratio || 0) - Number(previous.kpi_self_consumption_ratio || 0) : 0;
    const totalPV = rows.reduce((a, r: any) => a + Number(r.pv_kwh || 0), 0);
    const totalGrid = rows.reduce((a, r: any) => a + Number(r.kpi_grid_import_kwh || 0), 0);
    const avgScore = rows.reduce((a, r: any) => a + Number(r.score || 0), 0) / rows.length;

    // ML learning trend
    const { data: events } = await supabase
      .from('learning_events')
      .select('reward, created_at')
      .gte('created_at', sinceDate.toISOString())
      .not('reward', 'is', null)
      .limit(500);
    const rewards = (events || []).map((e: any) => Number(e.reward));
    const avgReward = rewards.length ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null;

    const stats = {
      type,
      days_in_range: rows.length,
      latest_scr: Number(latest.kpi_self_consumption_ratio || 0),
      latest_coverage: Number(latest.kpi_pv_heating_coverage || 0),
      latest_grid_import_kwh: Number(latest.kpi_grid_import_kwh || 0),
      latest_score: Number(latest.score || 0),
      delta_scr: delta,
      avg_scr: avgSCR,
      best_scr: bestSCR,
      worst_scr: worstSCR,
      avg_score: avgScore,
      total_pv_kwh: totalPV,
      total_grid_kwh: totalGrid,
      ml_avg_reward: avgReward,
      ml_event_count: rewards.length,
      series: rows.map((r: any) => ({
        date: r.date,
        scr: Number(r.kpi_self_consumption_ratio || 0),
        score: Number(r.score || 0),
      })),
    };

    const systemPrompt = `Du bist ein Energiemanagement-Coach für ein Haus mit PV (15.8 kWp), Batterie (13.8 kWh) und 12 Heizräumen. Antworte AUSSCHLIESSLICH auf Deutsch, in 3 bis 5 kurzen Sätzen, ohne Markdown-Listen. Ziel ist 100 % PV-Eigenverbrauch. Bewerte den Fortschritt, nenne den größten Verlust-Treiber und gib eine konkrete Empfehlung.`;

    const userPrompt = `Zeitraum: ${type === 'day' ? 'heute vs gestern' : type === 'week' ? 'letzte 7 Tage' : 'letzte 30 Tage'}
Aktueller Eigenverbrauch: ${(stats.latest_scr * 100).toFixed(1)}% (Δ ${(delta * 100).toFixed(1)}pp)
Heizung aus PV: ${(stats.latest_coverage * 100).toFixed(1)}%
Netzbezug heute: ${stats.latest_grid_import_kwh.toFixed(2)} kWh
Score: ${stats.latest_score.toFixed(0)}/100
Ø Eigenverbrauch im Zeitraum: ${(avgSCR * 100).toFixed(1)}% (Best ${(bestSCR * 100).toFixed(0)}%, Schlechtester ${(worstSCR * 100).toFixed(0)}%)
ML-Reward Ø: ${avgReward !== null ? avgReward.toFixed(2) : 'n/a'} bei ${rewards.length} Events
Wetter heute: ${latest.sig_weather}, PV-Bucket: ${latest.sig_pv_bucket}`;

    let summary = '';
    try {
      summary = await callGemini(systemPrompt, userPrompt);
    } catch (e) {
      console.error('Gemini failed, fallback summary:', e);
      summary = `Aktueller Eigenverbrauch ${(stats.latest_scr * 100).toFixed(0)} %, ${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta * 100).toFixed(1)} pp gegenüber Vorperiode. Ø im Zeitraum ${(avgSCR * 100).toFixed(0)} % bei ${stats.days_in_range} Tagen. Netzbezug heute ${stats.latest_grid_import_kwh.toFixed(1)} kWh. Heizung aus PV ${(stats.latest_coverage * 100).toFixed(0)} %.`;
    }

    // Cache in system_settings
    await supabase.from('system_settings').upsert({
      key: `analysis_summary_${type}`,
      value: { summary, stats, generated_at: new Date().toISOString() },
    }, { onConflict: 'key' });

    return new Response(
      JSON.stringify({ ok: true, summary, stats, generated_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('analysis-summary error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
