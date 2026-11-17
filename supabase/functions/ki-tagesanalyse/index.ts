// ki-tagesanalyse (04.11.2026; Regel 3 „Estrich laden bis“ entfernt 07.11.2026;
// 17.11.2026 Nacht-Prüfung über nacht_raum_kennzahlen (SQL 47), Regel 5, Erfolgskontrolle „früh aus“ –
// doc/FIX-NACHT-NUR-MIN-2026-11-17.md)
// Konzept doc/KONZEPT-KI-VORSCHLAEGE-2026-11-02.md §9 – „KI › Zu entscheiden“, freigegeben 04.11.2026.
//
// Läuft täglich 10:00 Wiener Zeit (analysis-scheduler), nach der Tagesnote (09:55). Schaut auf die letzten
// 7 Tage und schreibt in einfachen Worten:
//   1. ki_tagespaket  – ein kurzer Rückblick auf gestern
//   2. ki_vorschlaege – höchstens 3 Vorschläge, nur Werte aus der Whitelist (Stufe „suggest“), nur wenn
//                       mindestens 3 Tage dafür sprechen; sonst höchstens eine Beobachtung (art = info)
//   3. Wirkungsbericht – 3 Tage nach jeder Genehmigung: Tagesnote vorher/nachher; wurde es schlechter,
//                       ein Rücknahme-Vorschlag
// Die KI ändert nichts selbst – geschrieben wird erst, wenn Uli in der App genehmigt.
//
// Aufruf: POST (ohne Body) · Test: POST ?tag=2026-11-03 (wertet diesen Tag als „gestern“ aus)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MIN_TAGE = 3;            // so viele Tage müssen für einen Vorschlag sprechen
const MAX_VORSCHLAEGE = 3;     // je Tag
const SPERRE_ABGELEHNT_TAGE = 7;
const WIRKUNG_TAGE = 3;
const UNTER_ECO_SCHWELLE_MIN = 120;   // „lange unter Eco“ = mehr als 2 Stunden am Tag

const LABEL: Record<string, string> = {
  wait_min_temp: 'Min',
  max_grid_heating_power_w: 'Heizleistung ohne Sonne',
  heating_min_battery_soc: 'Batterie-Grenze fürs Heizen',
};

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

const viennaDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const zahl = (v: number, stellen = 1) => v.toFixed(stellen).replace('.', ',');
const stunden = (min: number) => zahl(min / 60, 1);
const mittel = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const mitEinheit = (v: number, einheit: string) => (einheit === '°C' ? `${zahl(v)} °C` : `${Math.round(v)} ${einheit}`);

interface RaumTag {
  room_id: string; raum: string; prioritaet: number | null; eco: number | null; komfort: number | null;
  untergrenze: number | null; estrich_bis: number | null; min_unter_eco: number; t_max: number | null;
  t_morgen: number | null; heiz_min: number; messwerte: number;
}
interface TagInfo { tag: string; art: 'sonnig' | 'wechselhaft' | 'trueb'; pv: number | null; einsp: number | null; note: number | null; raeume: RaumTag[] }
interface Neu {
  quelle: string; art: string; titel: string; was?: string; warum?: string; wirkung_text?: string;
  parameter_key?: string; scope?: string; room_id?: string | null; alt_wert?: number; neu_wert?: number;
  min_wert?: number | null; max_wert?: number | null; einheit?: string; tage_basis?: number; belege?: unknown;
  bezug_id?: string; gewicht?: number;
}

// Tagesart aus PV-Menge und Einspeisung (04.11.: Sonnentage mit 40+ kWh speisten kaum ein, weil das Haus alles nahm –
// die Einspeisung allein reicht deshalb nicht).
function tagesart(pv: number | null, einsp: number | null): TagInfo['art'] {
  if ((pv ?? 0) >= 25 || (einsp ?? 0) >= 2) return 'sonnig';
  if (pv != null && pv < 15 && (einsp ?? 0) < 1) return 'trueb';
  return 'wechselhaft';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!(await authorize(req))) return json({ error: 'unauthorized' }, 401);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const url = new URL(req.url);
    const gestern = url.searchParams.get('tag') ?? addDays(viennaDate(new Date()), -1);
    const tage = Array.from({ length: 7 }, (_, i) => addDays(gestern, i - 6));   // ältester … gestern

    // ---- Daten laden -------------------------------------------------------------------------------
    const [{ data: tbRows }, { data: wlRows }, { data: hs }, { data: rooms }, { data: alte }, { data: etRows }] = await Promise.all([
      sb.from('tages_bewertung').select('tag, note, pv_kwh, einspeisung_kwh, nacht_min_unter, hinweis, aussen_avg')
        .gte('tag', addDays(gestern, -30)).lte('tag', gestern),
      sb.from('ai_parameter_whitelist').select('parameter_key, scope, min_value, max_value, autonomy_level').eq('enabled', true),
      sb.from('heating_settings').select('max_grid_heating_power_w, nacht_frueh_aus, nacht_frueh_aus_seit').limit(1).maybeSingle(),
      sb.from('rooms').select('id, name, eco_temp, comfort_temp, wait_min_temp, automation_enabled'),
      sb.from('ki_vorschlaege').select('*').gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()),
      sb.from('energie_tag').select('tag, heizung_kwh, stunden').gte('tag', addDays(gestern, -60)).lte('tag', gestern),
    ]);
    // Nacht-Kennzahlen je Raum (SQL 47, stündlich) – fehlt die Tabelle noch, läuft alles andere wie bisher
    const { data: nkRows, error: nkErr } = await sb.from('nacht_raum_kennzahlen')
      .select('tag, room_id, min_temp, heiz_kwh, zyklen, spitze_ueber_min, ueberlauf, abkuehl_c_h, t_morgen, t_tief, aussen, vollstaendig')
      .gte('tag', addDays(gestern, -30)).lte('tag', gestern);
    if (nkErr) console.log(`[ki-tagesanalyse] nacht_raum_kennzahlen nicht lesbar (SQL 47?): ${nkErr.message}`);
    const naechte = ((nkRows ?? []) as any[]).filter((x) => x.vollstaendig);
    const nachtVon = (roomId: string) => naechte.filter((x) => x.room_id === roomId).sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
    const hgtNacht = (x: any) => (x.aussen != null ? Math.max(1, 18 - Number(x.aussen)) : null);
    const tb = new Map<string, any>(((tbRows ?? []) as any[]).map((r) => [String(r.tag), r]));
    const wl = new Map<string, any>(((wlRows ?? []) as any[]).filter((w) => w.autonomy_level === 'suggest').map((w) => [w.parameter_key, w]));
    const raumById = new Map<string, any>(((rooms ?? []) as any[]).map((r) => [r.id, r]));
    const vorhanden = (alte ?? []) as any[];
    // Heizstrom je Tag (energie_tag, nur volle Tage) – für kWh je Heizgradtag im Wirkungsbericht
    const heiz = new Map<string, number>(((etRows ?? []) as any[])
      .filter((r) => r.heizung_kwh != null && Number(r.stunden ?? 24) >= 20).map((r) => [String(r.tag), Number(r.heizung_kwh)]));

    const tagInfos: TagInfo[] = [];
    for (const t of tage) {
      const { data, error } = await sb.rpc('ki_raum_tag', { p_tag: t });
      if (error) throw new Error(`ki_raum_tag(${t}): ${error.message}`);
      const raeume = ((data ?? []) as RaumTag[]).filter((r) => r.messwerte > 0);
      if (!raeume.length) continue;                       // Tag ohne Messwerte
      const b = tb.get(t);
      const einsp = b?.einspeisung_kwh != null ? Number(b.einspeisung_kwh) : null;
      const pvKwh = b?.pv_kwh != null ? Number(b.pv_kwh) : null;
      tagInfos.push({ tag: t, art: tagesart(pvKwh, einsp), pv: pvKwh, einsp,
                      note: b?.note != null ? Number(b.note) : null, raeume });
    }
    const n = tagInfos.length;

    // gesperrt: offen oder in den letzten 7 Tagen abgelehnt (gleicher Parameter + Raum)
    const sperre = (key: string, roomId: string | null) => vorhanden.some((v) =>
      v.parameter_key === key && (v.room_id ?? null) === roomId && v.art !== 'info' && (
        v.status === 'offen' ||
        (v.status === 'abgelehnt' && v.entschieden_at && Date.now() - new Date(v.entschieden_at).getTime() < SPERRE_ABGELEHNT_TAGE * 86400000)));

    // Nur Tage NACH der letzten genehmigten Änderung desselben Werts zählen – vorher galt ein anderer Wert
    const seit = (key: string, roomId: string | null): string => vorhanden
      .filter((v) => v.parameter_key === key && (v.room_id ?? null) === roomId && ['genehmigt', 'geaendert'].includes(v.status) && v.entschieden_at)
      .map((v) => viennaDate(new Date(v.entschieden_at))).sort().pop() ?? '0000-00-00';

    const kandidaten: Neu[] = [];
    const infos: Neu[] = [];

    // ---- Regel 1: Untergrenze je Raum ----------------------------------------------------------------
    // Raum hat morgens seine Untergrenze gehalten (± 0,3 °C), lag danach aber > 2 h unter Eco → seit 17.11.2026 nur Hinweis
    // (vorher Vorschlag Untergrenze + 0,5 °C, siehe unten).
    // 04.11.: Liegt der Raum morgens schon deutlich UNTER der Untergrenze, hilft ein höherer Wert nichts – dann
    // wird die Untergrenze gar nicht gehalten (Nacht auf Frostschutz, Heizleistung zu klein …) → nur Hinweis.
    const wlU = wl.get('wait_min_temp');
    const haeltNicht: Array<{ name: string; morgen: number; grenze: number; tage: number }> = [];
    if (wlU) {
      for (const r of (rooms ?? []) as any[]) {
        if (r.automation_enabled === false || r.eco_temp == null || r.wait_min_temp == null) continue;
        const eco = Number(r.eco_temp), alt = Number(r.wait_min_temp);
        const tageRaum = tagInfos.map((t) => ({ t, x: t.raeume.find((x) => x.room_id === r.id) }))
          .filter(({ x }) => x && x.t_morgen != null);
        const darunter = tageRaum.filter(({ x }) => Number(x!.t_morgen) < alt - 0.3);
        if (darunter.length >= MIN_TAGE) {
          haeltNicht.push({ name: r.name, morgen: mittel(darunter.map(({ x }) => Number(x!.t_morgen))), grenze: alt, tage: darunter.length });
        }
        // Auch eine Änderung der Heizleistung ohne Sonne (betrifft alle Räume) startet die Zählung neu
        const abU = [seit('wait_min_temp', r.id), seit('max_grid_heating_power_w', null)].sort().pop()!;
        const treffer = tageRaum.filter(({ t }) => t.tag > abU)
          .filter(({ x }) => x!.min_unter_eco >= UNTER_ECO_SCHWELLE_MIN && Number(x!.t_morgen) >= alt - 0.3 && Number(x!.t_morgen) <= alt + 0.5);
        if (!treffer.length) continue;
        const neu = Math.min(eco, alt + 0.5, Number(wlU.max_value ?? 99));
        const morgen = mittel(treffer.map(({ x }) => Number(x!.t_morgen)));
        const unterH = mittel(treffer.map(({ x }) => x!.min_unter_eco));
        // 17.11.2026 (Uli: nachts nur Min, Estrich nur mit PV): Lag der Raum morgens auf Min und tagsüber unter Normal,
        // ist nicht Min die Ursache, sondern die Leistung am Tag (Grenze, Regel 2) – ein höheres Min hieße nachts mehr
        // Netzstrom. Deshalb nur noch ein Hinweis, kein Vorschlag „wärmer“.
        if (treffer.length >= MIN_TAGE && neu > alt) {
          infos.push({ quelle: 'tagesanalyse', art: 'info', gewicht: treffer.length, room_id: r.id,
            titel: `${r.name}: hält morgens Min (${zahl(morgen)} °C), liegt tagsüber aber im Schnitt ${stunden(unterH)} h unter Normal – `
              + `an ${treffer.length} der letzten ${n} Tage. Ein höheres Min würde nachts mehr heizen; Ursache ist die Leistung am Tag (Grenze ohne Sonne).` });
        }
      }
    }

    // ---- Regel 2: Heizleistung ohne Sonne -----------------------------------------------------------
    // Trübe Tage, an denen mindestens 3 Räume > 2 h unter Eco lagen → Grenze um 500 W anheben
    const wlG = wl.get('max_grid_heating_power_w');
    if (wlG && hs?.max_grid_heating_power_w != null) {
      const alt = Number(hs.max_grid_heating_power_w);
      const abG = seit('max_grid_heating_power_w', null);
      const treffer = tagInfos.filter((t) => t.art === 'trueb' && t.tag > abG)
        .map((t) => ({ t, kalt: t.raeume.filter((x) => x.min_unter_eco >= UNTER_ECO_SCHWELLE_MIN) }))
        .filter(({ kalt }) => kalt.length >= 3);
      const neu = Math.min(alt + 500, Number(wlG.max_value ?? 6000));
      if (treffer.length >= MIN_TAGE && neu > alt && !sperre('max_grid_heating_power_w', null)) {
        const letzte = treffer[treffer.length - 1];
        kandidaten.push({
          quelle: 'tagesanalyse', art: 'vorschlag', gewicht: treffer.length,
          titel: 'An Tagen ohne Sonne mehr gleichzeitig heizen?',
          was: `Ohne Sonnen-Überschuss dürfen ${neu} W gleichzeitig heizen statt bisher ${alt} W – also etwas mehr Räume zur selben Zeit.`,
          warum: `An ${treffer.length} trüben Tagen kamen jeweils ${Math.round(mittel(treffer.map(({ kalt }) => kalt.length)))} Räume nicht auf Eco – zuletzt am ${dm(letzte.t.tag)}: ${letzte.kalt.map((x) => x.raum).join(', ')}.`,
          wirkung_text: 'Mehr Räume erreichen an trüben Tagen Eco. Der Strom dafür kommt an solchen Tagen aus Batterie oder Netz.',
          parameter_key: 'max_grid_heating_power_w', scope: 'global', room_id: null, alt_wert: alt, neu_wert: neu,
          min_wert: Number(wlG.min_value ?? 1000), max_wert: Number(wlG.max_value ?? 6000), einheit: 'W',
          tage_basis: treffer.length, belege: treffer.map(({ t, kalt }) => ({ tag: t.tag, einspeisung_kwh: t.einsp, raeume_unter_eco: kalt.map((x) => x.raum) })),
        });
        // Die Hausgrenze ist die Ursache – Untergrenzen je Raum erst wieder, wenn das geklärt ist
        for (let i = kandidaten.length - 1; i >= 0; i--) if (kandidaten[i].parameter_key === 'wait_min_temp') kandidaten.splice(i, 1);
      }
    }

    // ---- Regel 5: Nacht – Min halten kostet Netzstrom (17.11.2026) ------------------------------------
    // Grundsatz: nachts nur Min, Estrich nur mit PV. Hat ein Raum in ≥ 3 der letzten 7 Nächte geheizt, um Min zu halten,
    // und lag er zum Nachtende trotzdem auf Min, schlagen wir Min − 0,5 °C vor (nicht unter Normal − 2, Whitelist).
    // Grundlage sind die gemessenen Nächte (heiz_kwh, Abkühlen je Stunde) – nicht die Tagesstunden.
    if (wlU) {
      for (const r of (rooms ?? []) as any[]) {
        if (r.automation_enabled === false || r.eco_temp == null || r.wait_min_temp == null) continue;
        if (kandidaten.some((k) => k.parameter_key === 'wait_min_temp' && k.room_id === r.id)) continue;
        const eco = Number(r.eco_temp), alt = Number(r.wait_min_temp);
        const neu = Math.max(alt - 0.5, eco - 2, Number(wlU.min_value ?? 0));
        if (neu >= alt || sperre('wait_min_temp', r.id)) continue;
        const ab = seit('wait_min_temp', r.id);
        const letzte7 = nachtVon(r.id).filter((x) => String(x.tag) > ab && String(x.tag) >= addDays(gestern, -6));
        const treffer = letzte7.filter((x) => Number(x.heiz_kwh) >= 0.3 && x.t_morgen != null && Number(x.t_morgen) >= alt - 0.1);
        if (treffer.length < MIN_TAGE) continue;
        const kwh = mittel(treffer.map((x) => Number(x.heiz_kwh)));
        const abk = mittel(treffer.filter((x) => x.abkuehl_c_h != null && Number(x.abkuehl_c_h) > 0.02).map((x) => Number(x.abkuehl_c_h)));
        const spitze = mittel(treffer.filter((x) => x.spitze_ueber_min != null).map((x) => Number(x.spitze_ueber_min)));
        const laenger = Number.isFinite(abk) ? (alt - neu) / abk : NaN;
        kandidaten.push({
          quelle: 'tagesanalyse', art: 'vorschlag', gewicht: treffer.length + 1,
          titel: `${r.name}: Min auf ${zahl(neu)} °C senken – nachts weniger heizen?`,
          was: `${r.name} darf nachts bis ${zahl(neu)} °C abkühlen statt bis ${zahl(alt)} °C. Normal bleibt ${zahl(eco)} °C (Ziel ab Nachtende).`,
          warum: `${r.name} hat in ${treffer.length} der letzten ${letzte7.length} Nächte geheizt, um Min zu halten – im Schnitt ${zahl(kwh)} kWh je Nacht aus Batterie/Netz`
            + (Number.isFinite(spitze) ? `, und ist dabei im Schnitt auf Min + ${zahl(spitze)} °C gestiegen` : '')
            + `. Zum Nachtende lag er trotzdem auf Min. Grundsatz: nachts nur Min, Estrich nur mit PV.`,
          wirkung_text: (Number.isFinite(laenger)
              ? `Der Raum kühlt nachts gemessen um ${zahl(abk, 2)} °C je Stunde ab – mit ${zahl(neu)} °C kommt er etwa ${zahl(laenger, 1)} Stunden länger ohne Heizen aus. `
              : '')
            + `Was nachts nicht geheizt wird, holt an Sonnentagen die PV nach. Nach ${WIRKUNG_TAGE} Nächten prüfe ich Heiz-kWh je Nacht und ob ${zahl(neu)} °C gehalten wurde.`,
          parameter_key: 'wait_min_temp', scope: 'room', room_id: r.id, alt_wert: alt, neu_wert: neu,
          min_wert: Math.max(eco - 2, Number(wlU.min_value ?? 0)), max_wert: Math.min(eco, Number(wlU.max_value ?? 99)), einheit: '°C',
          tage_basis: treffer.length,
          belege: treffer.map((x) => ({ nacht: x.tag, heiz_kwh: x.heiz_kwh, t_morgen: x.t_morgen, spitze_ueber_min: x.spitze_ueber_min, abkuehl_c_h: x.abkuehl_c_h })),
        });
      }
    }

    // ---- Regel 4: Sparen – Spielraum zwischen Min und Normal (15.11.2026) ----------------------------
    // Uli: „Ich sollte Anweisungen bekommen, was wir ändern müssen, um zu optimieren.“ Bisher schlug die KI nur
    // „wärmer“ vor. Liegt Min nur ≤ 1 °C unter Normal, kann der Planer kaum Wärme in die Sonnenstunden verschieben
    // und muss nachts fast immer heizen. Hat der Raum an mindestens 3 Tagen Min gehalten und war tagsüber kaum
    // unter Normal (< 1 h), schlagen wir Min − 1 °C vor (nicht unter Normal − 2, innerhalb der Whitelist).
    // Nicht, wenn Regel 2 greift (dann ist es zu kalt im Haus) oder für denselben Raum schon „wärmer“ ansteht.
    const regel2 = kandidaten.some((k) => k.parameter_key === 'max_grid_heating_power_w');
    if (wlU && !regel2) {
      for (const r of (rooms ?? []) as any[]) {
        if (r.automation_enabled === false || r.eco_temp == null || r.wait_min_temp == null) continue;
        if (kandidaten.some((k) => k.parameter_key === 'wait_min_temp' && k.room_id === r.id)) continue;
        const eco = Number(r.eco_temp), alt = Number(r.wait_min_temp);
        if (eco - alt > 1.0) continue;                                   // genug Spielraum
        const neu = Math.max(alt - 1, eco - 2, Number(wlU.min_value ?? 0));
        if (neu >= alt || sperre('wait_min_temp', r.id)) continue;
        const ab = [seit('wait_min_temp', r.id), seit('max_grid_heating_power_w', null)].sort().pop()!;
        const treffer = tagInfos.filter((t) => t.tag > ab)
          .map((t) => ({ t, x: t.raeume.find((x) => x.room_id === r.id) }))
          .filter(({ x }) => x && x.t_morgen != null && Number(x.t_morgen) >= alt - 0.3 && x.min_unter_eco < 60);
        if (treffer.length < MIN_TAGE) continue;
        kandidaten.push({
          quelle: 'tagesanalyse', art: 'vorschlag', gewicht: treffer.length,
          titel: `${r.name}: Min auf ${zahl(neu)} °C senken, um Netzstrom zu sparen?`,
          was: `${r.name} darf nachts bis ${zahl(neu)} °C abkühlen statt bis ${zahl(alt)} °C. Normal bleibt ${zahl(eco)} °C.`,
          warum: `${r.name} hat an ${treffer.length} der letzten ${n} Tage Min gehalten und war tagsüber auf Normal. `
            + `Min liegt aber nur ${zahl(eco - alt)} °C unter Normal – so hat der Planer kaum Spielraum, Wärme in die Sonnenstunden zu verschieben, und muss nachts fast immer heizen.`,
          wirkung_text: 'Weniger Heizen nachts aus Batterie und Netz. Faustwert: etwa 6 % weniger Heizstrom je Grad in diesem Raum. '
            + `Nach ${WIRKUNG_TAGE} Tagen prüfe ich kWh je Heizgradtag und ob der Raum Min gehalten hat.`,
          parameter_key: 'wait_min_temp', scope: 'room', room_id: r.id, alt_wert: alt, neu_wert: neu,
          min_wert: Math.max(eco - 2, Number(wlU.min_value ?? 0)), max_wert: Math.min(eco, Number(wlU.max_value ?? 99)), einheit: '°C',
          tage_basis: treffer.length,
          belege: treffer.map(({ t, x }) => ({ tag: t.tag, morgens: x!.t_morgen, min_unter_eco: x!.min_unter_eco })),
        });
      }
    }

    // ---- Erfolgskontrolle „nachts früh aus“ (pv-automation, 17.11.2026) -------------------------------
    // Vergleich der Nächte vor und seit dem Einschalten: Spitze über Min und Heiz-kWh je Heizgradtag (alle Räume).
    const nachtSumme = (rows: any[]) => {
      const proNacht = new Map<string, { kwh: number; hgt: number | null; sp: number[] }>();
      for (const x of rows) {
        const k = String(x.tag);
        const e = proNacht.get(k) ?? { kwh: 0, hgt: hgtNacht(x), sp: [] };
        e.kwh += Number(x.heiz_kwh) || 0;
        if (x.spitze_ueber_min != null && Number(x.zyklen) > 0) e.sp.push(Number(x.spitze_ueber_min));
        proNacht.set(k, e);
      }
      const ns = [...proNacht.values()];
      const mitHgt = ns.filter((e) => e.hgt != null);
      return {
        naechte: ns.length,
        kwh: mittel(ns.map((e) => e.kwh)),
        kwhHgt: mitHgt.length >= 2 ? mitHgt.reduce((a, e) => a + e.kwh, 0) / mitHgt.reduce((a, e) => a + (e.hgt as number), 0) : NaN,
        spitze: mittel(ns.flatMap((e) => e.sp)),
      };
    };
    if (hs?.nacht_frueh_aus !== false && hs?.nacht_frueh_aus_seit) {
      const ab = viennaDate(new Date(hs.nacht_frueh_aus_seit));
      const vorher = nachtSumme(naechte.filter((x) => String(x.tag) < ab && String(x.tag) >= addDays(ab, -7)));
      const nachher = nachtSumme(naechte.filter((x) => String(x.tag) >= ab));
      if (nachher.naechte === 0) {
        // noch keine volle Nacht
      } else if (nachher.naechte < WIRKUNG_TAGE || !Number.isFinite(vorher.spitze)) {
        infos.push({ quelle: 'rueckblick', art: 'info', gewicht: 40,
          titel: `Nachts früh abschalten (seit ${dm(ab)}): ${nachher.naechte} von ${WIRKUNG_TAGE} Nächten gemessen – Räume im Schnitt Min + ${zahl(nachher.spitze)} °C `
            + `(vorher Min + ${zahl(vorher.spitze)} °C), ${zahl(nachher.kwh)} kWh je Nacht (vorher ${zahl(vorher.kwh)} kWh). Urteil nach ${WIRKUNG_TAGE} Nächten.` });
      } else {
        const dSp = nachher.spitze - vorher.spitze;
        const rel = Number.isFinite(vorher.kwhHgt) && Number.isFinite(nachher.kwhHgt) && vorher.kwhHgt > 0 ? (nachher.kwhHgt - vorher.kwhHgt) / vorher.kwhHgt : NaN;
        const urteil = dSp <= -0.15 && !(rel >= 0.05) ? 'wirkt' : dSp >= 0.05 || rel >= 0.05 ? 'schlechter' : 'keine klare Wirkung';
        infos.push({ quelle: 'rueckblick', art: 'info', gewicht: urteil === 'schlechter' ? 90 : 40,
          titel: `Nachts früh abschalten (seit ${dm(ab)}, ${nachher.naechte} Nächte): ${urteil}. Spitze über Min ${zahl(vorher.spitze)} → ${zahl(nachher.spitze)} °C, `
            + (Number.isFinite(rel) ? `Heizstrom je Heizgradtag ${zahl(vorher.kwhHgt, 2)} → ${zahl(nachher.kwhHgt, 2)} kWh (${rel <= 0 ? '' : '+'}${Math.round(rel * 100)} %).` : `Heizstrom je Nacht ${zahl(vorher.kwh)} → ${zahl(nachher.kwh)} kWh.`)
            + (urteil === 'schlechter' ? ' Abschalten in Einstellungen › Haus › Verteilung („Nachts früh abschalten“) prüfen.' : '') });
      }
    }

    // Räume, die nicht einmal ihre Untergrenze halten – ein Hinweis für alle zusammen
    if (haeltNicht.length) {
      haeltNicht.sort((a, b) => (a.morgen - a.grenze) - (b.morgen - b.grenze));
      infos.push({ quelle: 'tagesanalyse', art: 'info', gewicht: 50,
        titel: `Nicht einmal Min gehalten (an mindestens ${MIN_TAGE} der letzten ${n} Tage morgens darunter): `
          + haeltNicht.slice(0, 5).map((h) => `${h.name} morgens ${zahl(h.morgen)} °C statt ${zahl(h.grenze)} °C`).join(', ')
          + `${haeltNicht.length > 5 ? ` und ${haeltNicht.length - 5} weitere` : ''}. Ein höherer Wert hilft hier nicht – Ursache prüfen `
          + '(Nacht auf Frostschutz? Heizleistung ohne Sonne zu klein? Thermostat offline?).' });
    }

    // ---- Regel 3 (Estrich laden bis) ENTFERNT am 07.11.2026 ------------------------------------------
    // Uli: Komfort ist das Maximum, der Estrich speichert durch das Heizen bis Komfort. Einen eigenen Wert dafür
    // gibt es nicht mehr; die KI schlägt ihn nicht mehr vor. Ob Überschuss an andere Räume weitergegeben wird,
    // ist eine Frage der Steuerung (Priorität), nicht eines Raumwerts.

    // ---- Wirkungsbericht 3 Tage nach einer Genehmigung ----------------------------------------------
    const note = (t: string) => { const v = tb.get(t)?.note; return v != null ? Number(v) : null; };
    const ruecknahmen: Neu[] = [];
    const wirkungUpdates: Array<{ id: string; wirkung: any }> = [];
    for (const v of vorhanden) {
      if (!['genehmigt', 'geaendert'].includes(v.status) || v.wirkung || !v.entschieden_at || v.art !== 'vorschlag') continue;
      const d = viennaDate(new Date(v.entschieden_at));
      if (addDays(d, WIRKUNG_TAGE) > gestern) continue;    // noch keine 3 vollen Tage danach
      const vorher = [1, 2, 3].map((i) => note(addDays(d, -i))).filter((x): x is number => x != null);
      const nachher = [1, 2, 3].map((i) => note(addDays(d, i))).filter((x): x is number => x != null);
      const label = LABEL[v.parameter_key] ?? v.parameter_key;
      const raum = v.room_id ? `${raumById.get(v.room_id)?.name ?? 'Raum'}: ` : '';
      const wert = Number(v.entschieden_wert ?? v.neu_wert);
      const einheit = v.einheit ?? '';
      if (vorher.length < 2 || nachher.length < 2) {
        wirkungUpdates.push({ id: v.id, wirkung: { urteil: 'unklar', grund: 'zu wenige bewertete Tage' } });
        infos.push({ quelle: 'rueckblick', art: 'info', gewicht: 10, bezug_id: v.id,
          titel: `${raum}${label} vom ${dm(d)}: zu wenige bewertete Tage – Wirkung nicht messbar.` });
        continue;
      }
      const a = mittel(vorher), b = mittel(nachher), diff = b - a;
      // 15.11.2026: zusätzlich Heizstrom je Heizgradtag (wetterunabhängig) vorher/nachher.
      // Spar-Änderungen (neuer Wert kleiner) werden daran gemessen: besser = mind. 5 % weniger kWh je Heizgradtag,
      // ohne dass die Tagesnote um mehr als 10 fällt (Komfort/Min). Andere Änderungen weiter über die Tagesnote.
      const kh = (tage: string[]) => {
        const xs = tage.map((t) => ({ h: heiz.get(t), g: tb.get(t)?.aussen_avg != null ? Math.max(0, 18 - Number(tb.get(t).aussen_avg)) : null }))
          .filter((x): x is { h: number; g: number } => x.h != null && x.g != null && x.g > 0);
        const sg = xs.reduce((s, x) => s + x.g, 0);
        return xs.length >= 2 && sg > 0 ? xs.reduce((s, x) => s + x.h, 0) / sg : null;
      };
      let khVor = kh([1, 2, 3].map((i) => addDays(d, -i))), khNach = kh([1, 2, 3].map((i) => addDays(d, i)));
      const spar = v.alt_wert != null && wert < Number(v.alt_wert);
      // 17.11.2026: Min je Raum → die Nächte dieses Raums vergleichen (Heiz-kWh je Heizgradtag, Min gehalten?)
      let nachtText = '';
      if (spar && v.parameter_key === 'wait_min_temp' && v.room_id) {
        const rn = nachtVon(v.room_id);
        const vor = rn.filter((x) => String(x.tag) < d && String(x.tag) >= addDays(d, -3));
        const nach = rn.filter((x) => String(x.tag) >= d && String(x.tag) <= addDays(d, 2));
        const proHgt = (xs: any[]) => { const m = xs.filter((x) => hgtNacht(x) != null); return m.length >= 2 ? m.reduce((a, x) => a + Number(x.heiz_kwh), 0) / m.reduce((a, x) => a + (hgtNacht(x) as number), 0) : null; };
        const a2 = proHgt(vor), b2 = proHgt(nach);
        if (a2 != null && b2 != null && a2 > 0) {
          khVor = a2; khNach = b2;
          const gehalten = nach.filter((x) => x.t_morgen != null && Number(x.t_morgen) >= wert - 0.2).length;
          nachtText = ` Nächte dieses Raums: ${zahl(a2, 2)} → ${zahl(b2, 2)} kWh je Heizgradtag, neues Min zum Nachtende in ${gehalten} von ${nach.length} Nächten gehalten.`;
        }
      }
      let urteil = diff >= 5 ? 'besser' : diff <= -5 ? 'schlechter' : 'gleich';
      if (spar && khVor != null && khNach != null) {
        const rel = (khNach - khVor) / khVor;
        urteil = diff <= -10 ? 'schlechter' : rel <= -0.05 ? 'besser' : rel >= 0.05 ? 'schlechter' : 'gleich';
      }
      wirkungUpdates.push({ id: v.id, wirkung: { urteil, note_vorher: Math.round(a), note_nachher: Math.round(b), tage_vorher: vorher.length, tage_nachher: nachher.length,
        kwh_je_hgt_vorher: khVor != null ? Math.round(khVor * 100) / 100 : null, kwh_je_hgt_nachher: khNach != null ? Math.round(khNach * 100) / 100 : null, spar } });
      if (urteil === 'schlechter' && v.alt_wert != null) {
        ruecknahmen.push({
          quelle: 'rueckblick', art: 'ruecknahme', gewicht: 99, bezug_id: v.id,
          titel: `Rückblick: ${raum}${label} vom ${dm(d)} zurücknehmen?`,
          was: `${raum}${label} wieder auf ${mitEinheit(Number(v.alt_wert), einheit)} statt ${mitEinheit(wert, einheit)}.`,
          warum: spar && khVor != null && khNach != null
            ? `Am ${dm(d)} hast du ${mitEinheit(Number(v.alt_wert), einheit)} → ${mitEinheit(wert, einheit)} genehmigt, um zu sparen. Danach: ${zahl(khNach, 2)} statt ${zahl(khVor, 2)} kWh je Heizgradtag, Tagesnote ${Math.round(b)} statt ${Math.round(a)}. Gespart wurde nicht genug – oder es wurde zu kalt.${nachtText}`
            : `Am ${dm(d)} hast du ${mitEinheit(Number(v.alt_wert), einheit)} → ${mitEinheit(wert, einheit)} genehmigt. In den 3 Tagen danach lag die Tagesnote im Schnitt bei ${Math.round(b)}, vorher bei ${Math.round(a)}. Die Änderung hat nicht geholfen.`,
          wirkung_text: 'Es gilt wieder der alte Wert. Beachte: auch das Wetter verändert die Tagesnote – der Vergleich ist grob.',
          parameter_key: v.parameter_key, scope: v.scope, room_id: v.room_id, alt_wert: wert, neu_wert: Number(v.alt_wert),
          min_wert: v.min_wert, max_wert: v.max_wert, einheit, tage_basis: nachher.length,
          belege: { note_vorher: vorher, note_nachher: nachher },
        });
      } else {
        infos.push({ quelle: 'rueckblick', art: 'info', gewicht: 10, bezug_id: v.id,
          titel: spar && khVor != null && khNach != null
            ? (urteil === 'besser'
              ? `${raum}${label} vom ${dm(d)} hat gespart: ${zahl(khNach, 2)} statt ${zahl(khVor, 2)} kWh je Heizgradtag, Tagesnote ${Math.round(b)} statt ${Math.round(a)}.${nachtText}`
              : `${raum}${label} vom ${dm(d)}: keine klare Ersparnis (${zahl(khVor, 2)} → ${zahl(khNach, 2)} kWh je Heizgradtag). Bleibt so.${nachtText}`)
            : urteil === 'besser'
            ? `${raum}${label} vom ${dm(d)} hat geholfen: Tagesnote danach im Schnitt ${Math.round(b)} statt ${Math.round(a)}.`
            : `${raum}${label} vom ${dm(d)}: keine klare Wirkung (Tagesnote ${Math.round(a)} → ${Math.round(b)}). Bleibt so.` });
      }
    }

    // ---- Auswahl und Schreiben -----------------------------------------------------------------------
    // Rücknahmen zuerst, dann Hauswerte (betreffen alle Räume), dann Raumwerte nach Anzahl Tage
    const rang = (v: Neu) => (v.scope === 'global' ? 1000 : 0) + (v.gewicht ?? 0);
    const vorschlaege = [...ruecknahmen, ...kandidaten.sort((x, y) => rang(y) - rang(x))].slice(0, MAX_VORSCHLAEGE);
    const infoAuswahl = infos.sort((x, y) => (y.gewicht ?? 0) - (x.gewicht ?? 0)).slice(0, 3);

    for (const w of wirkungUpdates) {
      await sb.from('ki_vorschlaege').update({ wirkung: w.wirkung, wirkung_at: new Date().toISOString() }).eq('id', w.id);
    }
    // Infos dieses Tages ersetzen (wiederholter Lauf), Vorschläge nur neu, wenn nicht schon offen
    await sb.from('ki_vorschlaege').delete().eq('tag', gestern).eq('art', 'info');
    const zeilen = [...vorschlaege, ...infoAuswahl].map(({ gewicht: _g, ...v }) => ({ ...v, tag: gestern }));
    if (zeilen.length) {
      const { error } = await sb.from('ki_vorschlaege').insert(zeilen);
      if (error) throw new Error(`ki_vorschlaege insert: ${error.message}`);
    }

    // ---- Rückblick auf gestern ------------------------------------------------------------------------
    const g = tagInfos.find((t) => t.tag === gestern);
    const b = tb.get(gestern);
    const offenGesamt = vorhanden.filter((v) => v.status === 'offen' && v.art !== 'info').length + vorschlaege.length;
    const teile: string[] = [];
    if (!g || !b) {
      teile.push(`Für ${dm(gestern)} fehlen Messwerte oder die Tagesnote – kein Rückblick möglich.`);
    } else {
      const pv = g.pv != null ? ` (${zahl(g.pv, 0)} kWh Sonne)` : '';
      teile.push(g.art === 'sonnig' ? `Sonnentag${pv}.` : g.art === 'trueb' ? `Trüber Tag, kaum Sonnen-Überschuss${pv}.` : `Wechselhafter Tag${pv}.`);
      const nachtMin = Number(b.nacht_min_unter ?? 0);
      teile.push(nachtMin <= 0 ? 'Die Nacht war gut, alle Räume blieben über Min.'
        : `In der Nacht lagen Räume zusammen ${stunden(nachtMin)} Stunden unter Min.`);
      const nGestern = naechte.filter((x) => String(x.tag) === gestern);
      if (nGestern.length) {
        const s1 = nachtSumme(nGestern);
        const hoch = nGestern.filter((x) => x.spitze_ueber_min != null && Number(x.spitze_ueber_min) >= 0.6)
          .sort((x, y) => Number(y.spitze_ueber_min) - Number(x.spitze_ueber_min));
        teile.push(`Nachts geheizt: ${zahl(s1.kwh)} kWh, um Min zu halten`
          + (hoch.length ? ` – über Min hinaus gelaufen: ${hoch.slice(0, 3).map((x) => `${raumById.get(x.room_id)?.name ?? 'Raum'} +${zahl(Number(x.spitze_ueber_min))} °C`).join(', ')}.` : '.'));
      }
      const kalt = g.raeume.filter((x) => x.min_unter_eco >= 60).sort((x, y) => y.min_unter_eco - x.min_unter_eco);
      teile.push(kalt.length === 0 ? 'Tagsüber waren alle Räume auf Eco.'
        : `Länger unter Eco: ${kalt.slice(0, 4).map((x) => `${x.raum} (${stunden(x.min_unter_eco)} h)`).join(', ')}${kalt.length > 4 ? ` und ${kalt.length - 4} weitere` : ''}.`);
      if (g.art === 'sonnig' && (g.einsp ?? 0) >= 2) teile.push(`${zahl(g.einsp!)} kWh Sonnenstrom gingen ins Netz.`);
      if (g.note != null) teile.push(`Tagesnote ${Math.round(g.note)} von 100.`);
    }
    teile.push(vorschlaege.length ? `Dazu habe ich ${vorschlaege.length === 1 ? 'einen Vorschlag' : `${vorschlaege.length} Vorschläge`}.`
      : offenGesamt ? 'Neue Vorschläge gibt es heute keine.' : 'Es gibt nichts zu entscheiden.');
    const text = teile.join(' ');
    await sb.from('ki_tagespaket').upsert({
      tag: gestern, text, note: g?.note ?? null, vorschlaege: vorschlaege.length, erstellt_at: new Date().toISOString(),
      zahlen: g ? { art: g.art, pv_kwh: g.pv, einspeisung_kwh: g.einsp, raeume: g.raeume.map((x) => ({ raum: x.raum, min_unter_eco: x.min_unter_eco, t_morgen: x.t_morgen, t_max: x.t_max })) } : null,
    }, { onConflict: 'tag' });

    console.log(`[ki-tagesanalyse] ${gestern}: ${n} Tage, ${vorschlaege.length} Vorschläge, ${infoAuswahl.length} Infos, ${wirkungUpdates.length} Wirkungsberichte`);
    return json({ ok: true, tag: gestern, tage: n, vorschlaege: vorschlaege.length, infos: infoAuswahl.length, wirkung: wirkungUpdates.length, text });
  } catch (e) {
    console.error('[ki-tagesanalyse] fatal', e);
    try { await sb.rpc('protokoll_add', { p_kind: 'fehler', p_room: null, p_title: 'KI-Tagesanalyse fehlgeschlagen', p_detail: String(e) }); } catch { /* egal */ }
    return json({ ok: false, error: String(e) }, 500);
  }
});
