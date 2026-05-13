import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Find unevaluated decisions older than 18h, younger than 7d
    const { data: pending, error } = await sb
      .from('ai_parameter_decisions')
      .select('id,created_at,parameter_key,expected_outcome,context_snapshot')
      .is('outcome_evaluated_at', null)
      .lt('created_at', new Date(Date.now() - 18 * 3600 * 1000).toISOString())
      .gt('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
      .limit(500);

    if (error) throw error;
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, evaluated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pull KPIs for the day after each decision
    let evaluated = 0;
    for (const d of pending) {
      const day = new Date(d.created_at);
      const dayStr = day.toISOString().slice(0, 10);

      const { data: scoreRow } = await sb
        .from('daily_pattern_scores')
        .select('kpi_self_consumption_ratio,kpi_pv_heating_coverage,kpi_grid_import_kwh,score')
        .eq('date', dayStr)
        .maybeSingle();

      const actual = scoreRow ?? null;

      // Naive scoring: did SCR / coverage move in the predicted direction?
      let score: number | null = null;
      if (actual && d.expected_outcome && typeof d.expected_outcome === 'object') {
        const eo: any = d.expected_outcome;
        const scrDeltaPredicted = parseFloat(String(eo.scr_delta ?? '0').replace('+', ''));
        // Compare against the previous day baseline
        const { data: prevRow } = await sb
          .from('daily_pattern_scores')
          .select('kpi_self_consumption_ratio')
          .lt('date', dayStr)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();
        const prevScr = prevRow?.kpi_self_consumption_ratio ?? null;
        const currScr = actual.kpi_self_consumption_ratio ?? null;
        if (prevScr != null && currScr != null) {
          const actualDelta = Number(currScr) - Number(prevScr);
          if (Number.isFinite(scrDeltaPredicted) && scrDeltaPredicted !== 0) {
            // +1 if same sign + similar magnitude, -1 if opposite
            score = Math.sign(scrDeltaPredicted) === Math.sign(actualDelta)
              ? Math.min(1, Math.abs(actualDelta) / Math.max(0.01, Math.abs(scrDeltaPredicted)))
              : -Math.min(1, Math.abs(actualDelta) / Math.max(0.01, Math.abs(scrDeltaPredicted)));
          } else {
            score = actualDelta >= 0 ? Math.min(1, actualDelta * 5) : Math.max(-1, actualDelta * 5);
          }
        }
      }

      await sb
        .from('ai_parameter_decisions')
        .update({
          outcome_evaluated_at: new Date().toISOString(),
          actual_outcome: actual,
          outcome_score: score,
        })
        .eq('id', d.id);
      evaluated++;
    }

    return new Response(JSON.stringify({ ok: true, evaluated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[ai-parameter-evaluator]', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
