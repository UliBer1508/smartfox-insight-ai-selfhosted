// heizplaner (06.11.2026) – doc/KONZEPT-PLANER-2026-11-06.md
//
// Statt fester Regeln rechnet der Planer: Für die nächsten 24 h sucht er je Raum und halbe Stunde „heizen ja/nein“,
// sodass möglichst wenig Netzstrom gebraucht wird und die Räume ihre Ziele halten (Eco tags, Nachtwert nachts,
// Untergrenze, nie unter Untergrenze − Sicherheitsabstand). Eingaben: gelerntes Raummodell, gelernte PV-Vorhersage
// (an der gemessenen PV nachgeführt), Batterie, Grundlast, Leistungsgrenze.
//
// Modus (heating_settings.planer_modus): „schatten“ – der Planer schreibt seinen Plan nur auf; „steuern“ (13.11.2026) –
// `pv-automation` setzt die Sollwerte nach dem jüngsten Plan (≤ 30 min alt), die Sicherheitsregeln bleiben.
// Jeden Tag Gegenrechnung mit der tatsächlichen Steuerung (`heizplan_vergleich`).
// Raummodell mit Estrich-Speicher und Nachbarräumen: doc/FIX-PLANER-MODELL-2026-11-13.md
//
// Aufrufe (POST, Body oder Query `aktion`):
//   planen            – alle 15 min (analysis-scheduler)
//   lernen  raum=<id> – Raummodell eines Raums lernen (03:00, je Raum ein Aufruf wegen der Rechenzeit-Grenze)
//   pv_lernen         – PV-Vorhersage je Stunde lernen (03:00)
//   vergleich tag=…   – Gegenrechnung eines Tages (Standard: gestern)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { PLAN_AUFBEWAHREN_TAGE, lerneAus, planAus, pvLernenAus, vergleichAus } from './rechnen.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

// ---------------------------------------------------------------- Aktionen
async function planen(sb: any) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: 2 });
  if (error) throw new Error(`heizplaner_daten: ${error.message} (SQL 25 ausgeführt?)`);
  if ((d.settings?.planer_modus ?? 'schatten') === 'aus') return { ok: true, aus: true };
  // Räume, die keine Befehle annehmen (SQL 30), plant der Planer nicht – sie heizen, wie sie gerade heizen.
  const { data: zusatz } = await sb.from('rooms').select('id, nicht_steuerbar_seit');
  const nichtSteuerbar = new Set(((zusatz ?? []) as any[]).filter(x => x.nicht_steuerbar_seit).map(x => x.id));
  const { zeile, antwort } = planAus(d, nichtSteuerbar);
  const { error: insErr } = await sb.from('heizplan').insert(zeile);
  if (insErr) throw new Error(`heizplan: ${insErr.message}`);
  await sb.from('heizplan').delete().lt('erstellt_at', new Date(Date.now() - PLAN_AUFBEWAHREN_TAGE * 86400000).toISOString());
  return antwort;
}

async function lernen(sb: any, raumId: string, tage: number) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: tage });
  if (error) throw new Error(`heizplaner_daten: ${error.message}`);
  const erg = lerneAus(d, raumId, tage);
  if (!erg.ok) return erg;
  const { error: upErr } = await sb.from('heizmodell').upsert(erg.zeile, { onConflict: 'room_id' });
  if (upErr) throw new Error(`heizmodell: ${upErr.message}`);
  return { ok: true, ...erg.zeile, fenster: erg.fenster };
}

async function pvLernen(sb: any, tage: number) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: tage });
  if (error) throw new Error(`heizplaner_daten: ${error.message}`);
  const coef = pvLernenAus(d);
  await sb.from('system_settings').upsert({ key: 'planer_pv_modell', value: { coef, tage, gelernt_at: new Date().toISOString() },
    updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return { ok: true, stunden: Object.keys(coef).length };
}

async function vergleich(sb: any, tag: string) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: 3 });
  if (error) throw new Error(`heizplaner_daten: ${error.message}`);
  const { data: zusatz } = await sb.from('rooms').select('id, nicht_steuerbar_seit');
  const nichtSteuerbar = new Set(((zusatz ?? []) as any[]).filter(x => x.nicht_steuerbar_seit).map(x => x.id));
  const zeile = vergleichAus(d, tag, nichtSteuerbar);
  if (!zeile.ok) return zeile;
  const { ok: _ok, ...daten } = zeile;
  const { error: upErr } = await sb.from('heizplan_vergleich').upsert(daten, { onConflict: 'tag' });
  if (upErr) throw new Error(`heizplan_vergleich: ${upErr.message}`);
  return zeile;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!await authorize(req)) return json({ error: 'Unauthorized' }, 401);
  try {
    const url = new URL(req.url);
    let body: any = {};
    try { body = await req.json(); } catch { /* ohne Body */ }
    const aktion = body.aktion ?? url.searchParams.get('aktion') ?? 'planen';
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const gestern = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    let res: unknown;
    if (aktion === 'planen') res = await planen(sb);
    else if (aktion === 'lernen') res = await lernen(sb, body.raum ?? url.searchParams.get('raum'), Number(body.tage ?? url.searchParams.get('tage')) || 30);
    else if (aktion === 'pv_lernen') res = await pvLernen(sb, Number(body.tage ?? url.searchParams.get('tage')) || 30);
    else if (aktion === 'vergleich') res = await vergleich(sb, body.tag ?? url.searchParams.get('tag') ?? gestern);
    else return json({ error: `unbekannte aktion ${aktion}` }, 400);
    console.log(`[HEIZPLANER] ${aktion}: ${JSON.stringify(res).slice(0, 400)}`);
    return json(res);
  } catch (e) {
    console.error('heizplaner:', e);
    return json({ error: String(e) }, 500);
  }
});
