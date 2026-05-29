// battery-soc-decision
// Einziger Edge-Function-Pfad, der heating_min_battery_soc schreiben darf
// (neben manuellem UI-Save). Locked-Param guard — siehe mem://security/ki-locked-core-params
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function authorize(req: Request): Promise<{ ok: boolean; decidedBy: string }> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return { ok: false, decidedBy: 'unknown' };
  const token = auth.replace('Bearer ', '');
  const known = [SERVICE_KEY, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
  if (known.includes(token)) return { ok: true, decidedBy: 'service' };
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const role = payload.role || payload.aud;
    if (['authenticated', 'service_role', 'anon'].includes(role)) {
      return { ok: true, decidedBy: payload.sub ? `user:${payload.sub}` : 'user' };
    }
  } catch { /* ignore */ }
  return { ok: false, decidedBy: 'unknown' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = await authorize(req);
  if (!auth.ok) return json({ error: 'unauthorized' }, 401);

  let body: { suggestion_id?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const suggestionId = body.suggestion_id;
  const action = body.action;
  if (!suggestionId || !['accept', 'dismiss'].includes(String(action))) {
    return json({ error: 'invalid_body', expected: { suggestion_id: 'uuid', action: 'accept|dismiss' } }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: sug, error: sugErr } = await sb.from('battery_soc_suggestions')
    .select('*').eq('id', suggestionId).maybeSingle();
  if (sugErr) return json({ error: sugErr.message }, 500);
  if (!sug) return json({ error: 'suggestion_not_found' }, 400);
  // Idempotent: if already decided the same way, treat as success (stale UI / double-click)
  if (sug.status !== 'pending') {
    const already = (action === 'accept' && sug.status === 'accepted') ||
                    (action === 'dismiss' && sug.status === 'dismissed');
    if (already) return json({ success: true, new_value: sug.new_value, already: true });
    return json({ error: 'not_pending', status: sug.status }, 400);
  }

  const nowIso = new Date().toISOString();

  if (action === 'accept') {
    // Authorisiertes Update auf heating_min_battery_soc — einziger erlaubter Pfad.
    const { error: hsErr } = await sb.from('heating_settings')
      .update({ heating_min_battery_soc: sug.new_value, battery_reserve_for_night_soc: sug.new_value })
      .gte('heating_min_battery_soc', 0); // matches all rows (single-row table)
    if (hsErr) {
      console.error('[battery-soc-decision] heating_settings update failed', hsErr);
      return json({ error: hsErr.message }, 500);
    }

    const { error: updErr } = await sb.from('battery_soc_suggestions')
      .update({ status: 'accepted', decided_at: nowIso, decided_by: auth.decidedBy })
      .eq('id', suggestionId);
    if (updErr) return json({ error: updErr.message }, 500);

    console.log(`[battery-soc-decision] ACCEPTED ${sug.old_value}% → ${sug.new_value}% by ${auth.decidedBy}`);
    return json({ success: true, new_value: sug.new_value });
  }

  // dismiss
  const { error: updErr } = await sb.from('battery_soc_suggestions')
    .update({ status: 'dismissed', decided_at: nowIso, decided_by: auth.decidedBy })
    .eq('id', suggestionId);
  if (updErr) return json({ error: updErr.message }, 500);

  console.log(`[battery-soc-decision] DISMISSED suggestion ${suggestionId} by ${auth.decidedBy}`);
  return json({ success: true });
});
