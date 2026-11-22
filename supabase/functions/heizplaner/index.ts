// heizplaner (06.11.2026) – doc/KONZEPT-PLANER-2026-11-06.md
//
// Statt fester Regeln rechnet der Planer: Für die nächsten 24 h sucht er je Raum und halbe Stunde „heizen ja/nein“,
// sodass möglichst wenig Netzstrom gebraucht wird und die Räume ihre Ziele halten (Eco tags, Nachtwert nachts,
// Min hart – seit 14.11.2026 kein Sicherheitsabstand mehr unter Min). Eingaben: gelerntes Raummodell, gelernte PV-Vorhersage
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
//   emhass_eingabe tag=…           – Eingaben für EMHASS (Österreich-PC) zur Gegenrechnung des Tages (22.11.2026)
//   emhass_bewerten tag=… plan=…   – EMHASS-Plan mit unserem Maßstab bewerten → heizplan_vergleich.emhass
//   highs_eingabe tag=…            – Planungsproblem des Tages als LP für HiGHS (Österreich-PC) (22.11.2026)
//   highs_bewerten tag=… werte=…   – HiGHS-Lösung bewerten → heizplan_vergleich.planer_highs
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { PLAN_AUFBEWAHREN_TAGE, kurzErgebnis, lerneAus, planAus, pvLernenAus, r1, vergleichAus, vergleichBasis, type Abwesenheit } from './rechnen.ts';
import type { PruefStand, RaumPruefung } from './pruefung.ts';
import { emhassBewerten, emhassEingabe } from './emhass.ts';
import { baueLp, heizenAusLoesung } from './highs.ts';
import { bewerte } from './modell.ts';

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
  const abw = await abwesenheiten(sb);
  const { zeile, antwort, pruefung, stand } = planAus(d, nichtSteuerbar, abw);
  const { error: insErr } = await sb.from('heizplan').insert(zeile);
  if (insErr) throw new Error(`heizplan: ${insErr.message}`);
  await sb.from('heizplan').delete().lt('erstellt_at', new Date(Date.now() - PLAN_AUFBEWAHREN_TAGE * 86400000).toISOString());
  await pruefungMelden(sb, d, pruefung, stand);
  return { ...antwort, auffaellig: Object.entries(pruefung).filter(([, p]) => !p.ok).map(([id, p]) => `${name(d, id)}: ${p.gruende.join('; ')}`) };
}

const name = (d: any, id: string) => (d.raeume ?? []).find((r: any) => r.id === id)?.name ?? id;

/**
 * Plan-Prüfung (13.11.2026, doc/FIX-PLANER-PRUEFUNG-2026-11-13.md): Stand merken, Wechsel ins Protokoll,
 * Hinweise nach KI › Zu entscheiden. Der Modus (aus/schatten/steuern) wird NIE geändert – den schaltet nur Uli.
 * Fehler hier dürfen den Plan nicht verhindern.
 */
async function pruefungMelden(sb: any, d: any, pruefung: Record<string, RaumPruefung>, stand: PruefStand) {
  try {
    const vorher: PruefStand = d.pruefung?.stand ?? {};
    const steuert = (d.settings?.planer_modus ?? 'schatten') === 'steuern';
    const wer = steuert ? 'Regel-Steuerung übernimmt diesen Raum' : 'im Modus „steuern“ übernähme die Regel-Steuerung';
    for (const [id, p] of Object.entries(pruefung)) {
      const neu = !p.ok && !vorher[id], frei = p.ok && !!vorher[id];
      if (neu) await sb.rpc('protokoll_add', { p_kind: 'modus', p_room: id, p_title: `Planer-Prüfung: auffällig → ${wer}`,
        p_detail: p.gruende.join(' · '), p_data: { geplant_h: p.geplant_h, erlaubt_h: p.erlaubt_h, arten: p.arten } });
      if (frei) await sb.rpc('protokoll_add', { p_kind: 'modus', p_room: id, p_title: 'Planer-Prüfung: wieder unauffällig → Planer steuert',
        p_detail: `vorher: ${(vorher[id].gruende ?? []).join(' · ')}`, p_data: null });
    }
    await sb.from('system_settings').upsert({ key: 'planer_pruefung',
      value: { stand, at: new Date().toISOString(),
               raeume: Object.fromEntries(Object.entries(pruefung).map(([id, p]) => [id, { ok: p.ok, gruende: p.gruende, hinweis: p.hinweis ?? null, geplant_h: p.geplant_h, erlaubt_h: p.erlaubt_h }])) },
      updated_at: new Date().toISOString() }, { onConflict: 'key' });
    // Hinweise und neue Sperren als Info unter KI › Zu entscheiden – je Raum und Tag nur einmal
    const tag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const { data: schon } = await sb.from('ki_vorschlaege').select('room_id, titel').eq('quelle', 'planer_pruefung').eq('tag', tag);
    const gibt = new Set(((schon ?? []) as any[]).map(x => `${x.room_id}|${x.titel}`));
    const zeilen: any[] = [];
    for (const [id, p] of Object.entries(pruefung)) {
      const raum = name(d, id);
      if (!p.ok && !p.arten.every(a => a === 'wartezeit')) {
        const titel = `${raum}: Plan passt nicht – Regel-Steuerung übernimmt`;
        if (!gibt.has(`${id}|${titel}`)) zeilen.push({ tag, quelle: 'planer_pruefung', art: 'info', titel, room_id: id,
          was: 'Der Planer steuert diesen Raum vorerst nicht, die Regel-Steuerung übernimmt (mindestens 2 h, bis der Plan wieder passt).',
          warum: p.gruende.join(' · '), belege: { geplant_h: p.geplant_h, erlaubt_h: p.erlaubt_h, arten: p.arten }, status: 'offen' });
      }
      if (p.hinweis) {
        const titel = `${raum}: erreicht sein Ziel nicht`;
        if (!gibt.has(`${id}|${titel}`)) zeilen.push({ tag, quelle: 'planer_pruefung', art: 'info', titel, room_id: id,
          was: 'Bitte prüfen: Heizleistung, Lage des Fühlers oder Eco-Wert dieses Raums.', warum: p.hinweis, status: 'offen' });
      }
    }
    if (zeilen.length) await sb.from('ki_vorschlaege').insert(zeilen);
  } catch (e) {
    console.error('pruefungMelden:', e);
  }
}

/** Abwesenheiten wie in pv-automation (getPresence): Kalender-Einträge = Haus leer, Vorlauf vor der Rückkehr = anwesend.
 *  Fail-safe: Steuerung aus oder Kalender nicht lesbar → keine Abwesenheit. */
async function abwesenheiten(sb: any): Promise<Abwesenheit> {
  try {
    const { data: hs } = await sb.from('heating_settings').select('presence_control_enabled, presence_lead_hours').limit(1).maybeSingle();
    if (hs?.presence_control_enabled === false) return [];
    const leadH = Math.max(0, Math.min(72, Number(hs?.presence_lead_hours ?? 6) || 0));
    const { data } = await sb.from('presence_periods').select('start_at, end_at').gt('end_at', new Date().toISOString()).limit(50);
    return ((data ?? []) as any[]).map(r => [new Date(r.start_at).getTime() / 1000, new Date(r.end_at).getTime() / 1000 - leadH * 3600] as [number, number])
      .filter(([v, b]) => b > v);
  } catch { return []; }
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
  // 22.11.2026: so viele Tage laden, wie der Tag zurückliegt (vorher fest 3 → ältere Tage ließen sich nicht neu rechnen)
  const { d, nichtSteuerbar } = await datenFuerTag(sb, tag);
  const zeile = vergleichAus(d, tag, nichtSteuerbar);
  if (!zeile.ok) return zeile;
  const { ok: _ok, ...daten } = zeile;
  const { error: upErr } = await sb.from('heizplan_vergleich').upsert(daten, { onConflict: 'tag' });
  if (upErr) throw new Error(`heizplan_vergleich: ${upErr.message}`);
  // Tagesprüfung (13.11.2026): braucht der Planer mehr Netz als die Steuerung, ohne wärmer zu sein → Hinweis
  try {
    const pl = zeile.planer, st = zeile.steuerung;
    const netzPl = Number(pl?.netz_bereinigt_kwh ?? pl?.netz_kwh), netzSt = Number(st?.netz_kwh);
    if (Number.isFinite(netzPl) && Number.isFinite(netzSt) && netzPl > netzSt * 1.1 + 1
        && Number(pl?.unter_ziel_gradstd) >= Number(st?.unter_ziel_gradstd) * 0.9) {
      const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      await sb.from('ki_vorschlaege').delete().eq('quelle', 'planer_pruefung').eq('tag', heute).is('room_id', null);
      await sb.from('ki_vorschlaege').insert({ tag: heute, quelle: 'planer_pruefung', art: 'info', status: 'offen',
        titel: `Planer am ${tag}: mehr Netzstrom als die Regel-Steuerung`,
        was: 'Der Modus bleibt, wie du ihn eingestellt hast. Prüfen, ob der Planer weiter steuern soll.',
        warum: `Gegenrechnung ${tag}: Planer ${netzPl.toFixed(1)} kWh Netz, Regel-Steuerung ${netzSt.toFixed(1)} kWh – bei nicht besserem Komfort.`,
        belege: { planer: pl, steuerung: st } });
    }
  } catch (e) { console.error('Tagesprüfung:', e); }
  return zeile;
}

// ---------------------------------------------------------------- EMHASS (22.11.2026, doc/EMHASS-VERGLEICH-2026-11-22.md)
async function datenFuerTag(sb: any, tag: string) {
  // so viele Tage laden, dass der Tag samt Vorlauf (Estrich-Start: 12 h) drin ist; Raumdaten gibt es 14 Tage
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const tage = Math.min(14, Math.max(3, Math.round((Date.parse(heute) - Date.parse(tag)) / 86400000) + 2));
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: tage });
  if (error) throw new Error(`heizplaner_daten: ${error.message}`);
  const { data: zusatz } = await sb.from('rooms').select('id, nicht_steuerbar_seit');
  const nichtSteuerbar = new Set(((zusatz ?? []) as any[]).filter(x => x.nicht_steuerbar_seit).map(x => x.id));
  return { d, nichtSteuerbar };
}

async function emhassEingabeAktion(sb: any, tag: string) {
  const { d, nichtSteuerbar } = await datenFuerTag(sb, tag);
  return emhassEingabe(d, tag, nichtSteuerbar);
}

async function emhassBewertenAktion(sb: any, tag: string, plan: any) {
  if (!plan?.raeume || !plan?.leistung_w) throw new Error('plan.raeume und plan.leistung_w fehlen');
  const { data: da } = await sb.from('heizplan_vergleich').select('tag').eq('tag', tag).maybeSingle();
  if (!da) await vergleich(sb, tag);                                   // Gegenrechnung des Tages zuerst
  const { d, nichtSteuerbar } = await datenFuerTag(sb, tag);
  const erg = emhassBewerten(d, tag, nichtSteuerbar, plan);
  if (!erg.ok) return erg;
  const { error } = await sb.from('heizplan_vergleich').update({ emhass: erg.emhass }).eq('tag', tag);
  if (error) throw new Error(`heizplan_vergleich.emhass: ${error.message} (SQL 51 ausgeführt?)`);
  return erg;
}

// ---------------------------------------------------------------- HiGHS-Prüfstein (22.11.2026, doc/FIX-PLANER-HIGHS-2026-11-22.md)
async function highsEingabeAktion(sb: any, tag: string) {
  const { d, nichtSteuerbar } = await datenFuerTag(sb, tag);
  const { b, bat, g } = vergleichBasis(d, tag, nichtSteuerbar);
  if (b.raeume.length === 0) return { ok: false, grund: 'keine Temperaturen um Mitternacht' };
  return { ok: true, tag, slots: b.slots.length, raeume: b.raeume.map(r => ({ id: r.id, name: r.name })), lp: baueLp(b.raeume, b.slots, bat, g) };
}

async function highsBewertenAktion(sb: any, tag: string, body: any) {
  const werte: Record<string, number> = body?.werte ?? {};
  const { data: da } = await sb.from('heizplan_vergleich').select('tag').eq('tag', tag).maybeSingle();
  if (!da) await vergleich(sb, tag);
  const { d, nichtSteuerbar } = await datenFuerTag(sb, tag);
  const { b, bat, g, eIst } = vergleichBasis(d, tag, nichtSteuerbar);
  if (!eIst) return { ok: false, grund: 'keine Temperaturen um Mitternacht' };
  const heizen = heizenAusLoesung(b.raeume, b.slots.length, n => Number(werte[n] ?? 0));
  const e = bewerte(b.raeume, b.slots, bat, g, heizen);
  const planer_highs = { ...kurzErgebnis(e), netz_bereinigt_kwh: r1(e.netzKwh - (e.waermeKwh - eIst.waermeKwh)),
    kosten: Math.round(e.kosten * 100) / 100, status: body?.status ?? null, luecke: body?.luecke ?? null,
    rechenzeit_s: body?.rechenzeit_s ?? null, bewertet_at: new Date().toISOString() };
  const { error } = await sb.from('heizplan_vergleich').update({ planer_highs }).eq('tag', tag);
  if (error) throw new Error(`heizplan_vergleich.planer_highs: ${error.message} (SQL 53 ausgeführt?)`);
  return { ok: true, tag, planer_highs };
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
    else if (aktion === 'emhass_eingabe') res = await emhassEingabeAktion(sb, body.tag ?? url.searchParams.get('tag') ?? gestern);
    else if (aktion === 'emhass_bewerten') res = await emhassBewertenAktion(sb, body.tag ?? gestern, body.plan);
    else if (aktion === 'highs_eingabe') res = await highsEingabeAktion(sb, body.tag ?? url.searchParams.get('tag') ?? gestern);
    else if (aktion === 'highs_bewerten') res = await highsBewertenAktion(sb, body.tag ?? gestern, body);
    else return json({ error: `unbekannte aktion ${aktion}` }, 400);
    console.log(`[HEIZPLANER] ${aktion}: ${JSON.stringify(res).slice(0, 400)}`);
    return json(res);
  } catch (e) {
    console.error('heizplaner:', e);
    return json({ error: String(e) }, 500);
  }
});
