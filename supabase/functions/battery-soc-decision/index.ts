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

  let body: { suggestion_id?: string; ki_vorschlag_id?: string; action?: string; value?: number; notiz?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const suggestionId = body.suggestion_id;
  const kiId = body.ki_vorschlag_id;
  const action = body.action;
  if ((!suggestionId && !kiId) || !['accept', 'dismiss'].includes(String(action))) {
    return json({ error: 'invalid_body', expected: { suggestion_id: 'uuid | ki_vorschlag_id: uuid', action: 'accept|dismiss', value: 'optional 40–90' } }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const nowIso = new Date().toISOString();

  // Grenzen aus der Whitelist (Konzept KI-Vorschläge §3: 40–90 %)
  const { data: wl } = await sb.from('ai_parameter_whitelist').select('min_value, max_value')
    .eq('parameter_key', 'heating_min_battery_soc').maybeSingle();
  const lo = Number(wl?.min_value ?? 40), hi = Number(wl?.max_value ?? 90);
  const custom = body.value != null ? Number(body.value) : null;
  if (custom != null && (!Number.isFinite(custom) || custom < lo || custom > hi)) {
    return json({ error: `value_out_of_range`, min: lo, max: hi }, 400);
  }

  const writeSoc = async (v: number) => sb.from('heating_settings')
    .update({ heating_min_battery_soc: v })
    .gte('heating_min_battery_soc', 0); // matches all rows (single-row table)

  // ---- Rücknahme aus KI › Zu entscheiden (ki_vorschlaege, Parameter heating_min_battery_soc) ----
  if (kiId) {
    const { data: kv, error: kvErr } = await sb.from('ki_vorschlaege').select('*').eq('id', kiId).maybeSingle();
    if (kvErr) return json({ error: kvErr.message }, 500);
    if (!kv || kv.parameter_key !== 'heating_min_battery_soc') return json({ error: 'ki_vorschlag_not_found' }, 400);
    if (kv.status !== 'offen') return json({ error: 'not_open', status: kv.status }, 400);
    if (action === 'dismiss') {
      await sb.from('ki_vorschlaege').update({ status: 'abgelehnt', entschieden_at: nowIso, notiz: body.notiz ?? null }).eq('id', kiId);
      return json({ success: true });
    }
    const v = custom ?? Number(kv.neu_wert);
    const { error: hsErr } = await writeSoc(v);
    if (hsErr) return json({ error: hsErr.message }, 500);
    await sb.from('ki_vorschlaege').update({
      status: custom != null && custom !== Number(kv.neu_wert) ? 'geaendert' : 'genehmigt',
      entschieden_at: nowIso, entschieden_wert: v, notiz: body.notiz ?? null,
    }).eq('id', kiId);
    console.log(`[battery-soc-decision] KI-Vorschlag ${kiId}: heating_min_battery_soc → ${v}% by ${auth.decidedBy}`);
    return json({ success: true, new_value: v });
  }

  const { data: sug, error: sugErr } = await sb.from('battery_soc_suggestions')
    .select('*').eq('id', suggestionId).maybeSingle();
  if (sugErr) return json({ error: sugErr.message }, 500);
  if (!sug) return json({ error: 'suggestion_not_found' }, 400);
  // Idempotent: if already decided the same way, treat as success (stale UI / double-click)
  if (sug.status !== 'pending') {
    const already = (action === 'accept' && sug.status === 'accepted') ||
                    (action === 'dismiss' && sug.status === 'dismissed');
    if (already) return json({ success: true, new_value: sug.decided_value ?? sug.new_value, already: true });
    return json({ error: 'not_pending', status: sug.status }, 400);
  }

  if (action === 'accept') {
    // Authorisiertes Update auf heating_min_battery_soc — einziger erlaubter Pfad.
    // Seit 28.10.2026 NUR der Mindest-Ladestand. Die Nacht-Reserve (battery_reserve_for_night_soc)
    // ist ein eigener Wert (Batterie-Puffer, Mikro-Budget, Reserve-Validierung) und wurde vorher
    // still mit überschrieben – bei 90 % waren Puffer und Mikro-Budget dadurch praktisch aus.
    // Seit 04.11.2026: optional eigener Wert („Anderer Wert“ in KI › Zu entscheiden).
    const v = custom ?? Number(sug.new_value);
    const { error: hsErr } = await writeSoc(v);
    if (hsErr) {
      console.error('[battery-soc-decision] heating_settings update failed', hsErr);
      return json({ error: hsErr.message }, 500);
    }

    const { error: updErr } = await sb.from('battery_soc_suggestions')
      .update({ status: 'accepted', decided_at: nowIso, decided_by: auth.decidedBy, decided_value: v })
      .eq('id', suggestionId);
    if (updErr) return json({ error: updErr.message }, 500);

    // Für den Wirkungsbericht nach 3 Tagen (ki-tagesanalyse) als entschiedener Vorschlag festhalten
    const { error: kvErr } = await sb.from('ki_vorschlaege').insert({
      tag: nowIso.slice(0, 10), quelle: 'batterie', art: 'vorschlag',
      titel: `Batterie-Grenze fürs Heizen von ${sug.old_value} % auf ${sug.new_value} % ändern?`,
      warum: sug.reason_text, parameter_key: 'heating_min_battery_soc', scope: 'global',
      alt_wert: sug.old_value, neu_wert: sug.new_value, min_wert: lo, max_wert: hi, einheit: '%',
      status: v !== Number(sug.new_value) ? 'geaendert' : 'genehmigt', entschieden_at: nowIso, entschieden_wert: v,
      notiz: body.notiz ?? null, belege: { battery_soc_suggestion_id: suggestionId },
    });
    if (kvErr) console.warn('[battery-soc-decision] ki_vorschlaege insert failed (SQL 21 ausgeführt?)', kvErr.message);

    console.log(`[battery-soc-decision] ACCEPTED ${sug.old_value}% → ${v}% by ${auth.decidedBy}`);
    return json({ success: true, new_value: v });
  }

  // dismiss
  const { error: updErr } = await sb.from('battery_soc_suggestions')
    .update({ status: 'dismissed', decided_at: nowIso, decided_by: auth.decidedBy })
    .eq('id', suggestionId);
  if (updErr) return json({ error: updErr.message }, 500);

  console.log(`[battery-soc-decision] DISMISSED suggestion ${suggestionId} by ${auth.decidedBy}`);
  return json({ success: true });
});
