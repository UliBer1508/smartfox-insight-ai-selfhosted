// Haiku-Prüfer (26.11.2026) – doc/KONZEPT-KI-HAIKU-2026-11-26.md
//
// Läuft am Ende von ki-tagesanalyse, NACH den festen Regeln. Haiku bekommt dieselben Daten (7 Tage, Nächte,
// Raumwerte, Whitelist) plus das, was die Regeln heute gefunden haben, und die Wirkungsberichte früherer
// Vorschläge. Frage: Was erklären die Regeln NICHT?
//
// Haiku steuert nichts. Ergebnis:
//   - höchstens 2 Hinweise (art = info, quelle = haiku)
//   - höchstens 1 Vorschlag (art = vorschlag, quelle = haiku) – nur Werte aus der Whitelist (Stufe „suggest“),
//     geprüft und begrenzt wie die Regel-Vorschläge; Uli genehmigt wie gewohnt, der Wirkungsbericht läuft mit
//   - je Lauf eine Zeile in ki_haiku_lauf (Tokens, Dauer, Fehler) – für Kosten und Vergleich Haiku an/aus
//
// Schalter: system_settings.ki_haiku = { aktiv: true|false, modell: 'claude-haiku-5-5' }. Aus = nichts passiert.
// Fehler von Haiku stoppen die Tagesanalyse nie – die Regel-Ergebnisse sind dann schon geschrieben.

const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 60_000;
const MAX_INFOS = 2;

export interface HaikuKontext {
  gestern: string;
  tage: unknown[];             // TagInfo je Tag (Art, PV, Einspeisung, Note, Räume)
  naechte: unknown[];          // nacht_raum_kennzahlen (vollständige Nächte)
  rooms: any[];
  whitelist: Map<string, any>; // nur autonomy_level = suggest
  hs: any;                     // heating_settings (max_grid_heating_power_w …)
  regelVorschlaege: any[];     // was die Regeln heute vorschlagen
  regelInfos: any[];
  vorhanden: any[];            // ki_vorschlaege der letzten 60 Tage
  sperre: (key: string, roomId: string | null) => boolean;
}

const BERICHT_TOOL = {
  name: 'bericht',
  description: 'Ergebnis der täglichen Prüfung. Immer genau einmal aufrufen.',
  input_schema: {
    type: 'object',
    properties: {
      befunde: {
        type: 'array', maxItems: MAX_INFOS,
        description: 'Muster, die die festen Regeln nicht erklären. Leer lassen, wenn es nichts Neues gibt.',
        items: {
          type: 'object',
          properties: {
            titel: { type: 'string', description: 'Ein bis zwei Sätze für Uli, einfache Worte, mit Zahlen und Tagen.' },
            tage: { type: 'integer', description: 'An wie vielen Tagen/Nächten das Muster auftrat.' },
          },
          required: ['titel', 'tage'],
        },
      },
      vorschlag: {
        type: ['object', 'null'],
        description: 'Höchstens EIN Wert-Vorschlag, nur aus der Liste "erlaubte_werte", nur wenn mindestens 3 Tage dafür sprechen. Sonst null.',
        properties: {
          parameter_key: { type: 'string' },
          raum: { type: ['string', 'null'], description: 'Raumname genau wie in den Daten, bei Hauswerten null.' },
          neu_wert: { type: 'number' },
          titel: { type: 'string' },
          was: { type: 'string' },
          warum: { type: 'string' },
          wirkung_text: { type: 'string' },
          tage_basis: { type: 'integer' },
        },
        required: ['parameter_key', 'raum', 'neu_wert', 'titel', 'was', 'warum', 'wirkung_text', 'tage_basis'],
      },
      plateau: {
        type: 'boolean',
        description: 'true, wenn die letzten Wochen kaum noch Verbesserung zeigen und Haiku nur noch als Wächter nötig ist.',
      },
    },
    required: ['befunde', 'vorschlag', 'plateau'],
  },
};

const SYSTEM = `Du bist der Prüfer einer PV-gesteuerten Elektro-Fußbodenheizung (Haus Venediger, 12 Räume, Thermostate).
Feste Regeln steuern und machen täglich eigene Vorschläge. Deine Aufgabe: finde, was diese Regeln NICHT erklären.

Grundsätze des Hauses (nie dagegen vorschlagen):
- Ziel: so wenig Netzstrom wie möglich, PV-Überschuss zu 100 % nutzen. Der Estrich ist der Wärmespeicher, er wird
  tagsüber mit PV geladen, nachts wird nur Min gehalten.
- Je Raum drei Temperaturen: Min (nie unterschreiten), Normal, PV-Überschuss. Komfort ist das Maximum.
- Batterie ist für die Nacht. Warmwasser und Auto regelt der Smartfox, nicht die Heizung.
- Fester Stromtarif. Wetter verändert alles – vergleiche Tage nur mit ähnlichen Tagen (Tagesart, Außentemperatur).

Regeln für deine Antwort:
- Wiederhole nichts, was die Regeln heute schon melden oder was du in "fruehere_haiku_befunde" schon gesagt hast,
  außer es hat sich deutlich verändert.
- Nur Muster, die an mindestens 3 Tagen/Nächten auftreten. Einzelne Ausreißer nicht melden.
- Ein Vorschlag nur für Werte aus "erlaubte_werte" und innerhalb der angegebenen Grenzen. Lieber kein Vorschlag als
  ein schwacher. Ein Raum, der morgens unter Min liegt, braucht kein höheres Min (die Ursache liegt woanders).
- Beachte "wirkung_frueherer_vorschlaege": was nicht geholfen hat, nicht erneut vorschlagen.
- Schreibe Deutsch, einfache Worte, konkrete Zahlen und Daten (TT.MM.). Keine Fachbegriffe ohne Erklärung.
- Gibt es nichts Neues: befunde leer, vorschlag null. Das ist ein gutes Ergebnis.`;

const r1 = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

/** Daten kompakt für das Modell – nur, was zur Frage gehört. */
function datenpaket(k: HaikuKontext) {
  const name = (id: string) => k.rooms.find((r) => r.id === id)?.name ?? id;
  const erlaubt = [...k.whitelist.values()].map((w) => ({
    parameter_key: w.parameter_key, scope: w.scope, min: Number(w.min_value), max: Number(w.max_value),
    hinweis: w.parameter_key === 'wait_min_temp' ? 'Min je Raum, zusätzlich nur zwischen Normal − 2 und Normal'
      : w.parameter_key === 'max_grid_heating_power_w' ? 'Heizleistung ohne Sonne, ganzes Haus, aktuell ' + (k.hs?.max_grid_heating_power_w ?? '?') + ' W'
      : w.parameter_key === 'heating_power_w' ? 'gemessene Heizleistung je Raum (nur korrigieren, wenn Messung klar abweicht)' : '',
  }));
  const raeume = k.rooms.filter((r) => r.automation_enabled !== false).map((r) => ({
    raum: r.name, min: r1(r.wait_min_temp), normal: r1(r.eco_temp), pv_max: r1(r.comfort_temp),
  }));
  const wirkung = k.vorhanden.filter((v) => v.art === 'vorschlag' && v.status !== 'offen').slice(-20).map((v) => ({
    quelle: v.quelle, tag: v.tag, titel: v.titel, status: v.status, urteil: v.wirkung?.urteil ?? null,
    kwh_je_hgt: v.wirkung ? [v.wirkung.kwh_je_hgt_vorher, v.wirkung.kwh_je_hgt_nachher] : null,
  }));
  const frueher = k.vorhanden.filter((v) => v.quelle === 'haiku').slice(-10).map((v) => ({ tag: v.tag, art: v.art, titel: v.titel }));
  return {
    gestern: k.gestern,
    tage: k.tage,
    naechte: (k.naechte as any[]).map((x) => ({
      nacht: x.tag, raum: name(x.room_id), min: r1(x.min_temp), heiz_kwh: r1(x.heiz_kwh), t_morgen: r1(x.t_morgen),
      t_tief: r1(x.t_tief), abkuehl_c_h: x.abkuehl_c_h == null ? null : Math.round(Number(x.abkuehl_c_h) * 100) / 100, aussen: r1(x.aussen),
    })),
    raeume, erlaubte_werte: erlaubt,
    regeln_heute: [...k.regelVorschlaege.map((v) => `Vorschlag: ${v.titel}`), ...k.regelInfos.map((v) => `Hinweis: ${v.titel}`)],
    wirkung_frueherer_vorschlaege: wirkung,
    fruehere_haiku_befunde: frueher,
  };
}

/** Haiku-Vorschlag prüfen und begrenzen – dieselben Grenzen wie bei den Regeln. null = verworfen (mit Grund im Log). */
function pruefeVorschlag(v: any, k: HaikuKontext, log: string[]) {
  if (!v) return null;
  const wl = k.whitelist.get(v.parameter_key);
  if (!wl) { log.push(`Vorschlag verworfen: ${v.parameter_key} nicht freigegeben`); return null; }
  if (!(Number(v.tage_basis) >= 3)) { log.push('Vorschlag verworfen: weniger als 3 Tage'); return null; }
  let roomId: string | null = null, alt: number, lo = Number(wl.min_value), hi = Number(wl.max_value);
  let einheit = 'W';
  if (wl.scope === 'room') {
    const r = k.rooms.find((x) => x.name === v.raum);
    if (!r) { log.push(`Vorschlag verworfen: Raum „${v.raum}“ unbekannt`); return null; }
    roomId = r.id;
    if (v.parameter_key === 'wait_min_temp') {
      if (r.wait_min_temp == null || r.eco_temp == null) return null;
      alt = Number(r.wait_min_temp); einheit = '°C';
      lo = Math.max(lo, Number(r.eco_temp) - 2); hi = Math.min(hi, Number(r.eco_temp));
    } else if (v.parameter_key === 'heating_power_w') {
      if (r.heating_power_w == null) { log.push('Vorschlag verworfen: Raum ohne Heizleistung'); return null; }
      alt = Number(r.heating_power_w);
    } else { log.push(`Vorschlag verworfen: ${v.parameter_key} wird hier nicht unterstützt`); return null; }
  } else if (v.parameter_key === 'max_grid_heating_power_w') {
    if (k.hs?.max_grid_heating_power_w == null) return null;
    alt = Number(k.hs.max_grid_heating_power_w);
  } else { log.push(`Vorschlag verworfen: ${v.parameter_key} wird hier nicht unterstützt`); return null; }

  let neu = Math.min(hi, Math.max(lo, Number(v.neu_wert)));
  neu = einheit === '°C' ? Math.round(neu * 2) / 2 : Math.round(neu / 100) * 100;
  if (!Number.isFinite(neu) || neu === alt) { log.push('Vorschlag verworfen: kein neuer Wert'); return null; }
  if (k.sperre(v.parameter_key, roomId)) { log.push('Vorschlag verworfen: offen oder kürzlich abgelehnt'); return null; }
  if (k.regelVorschlaege.some((x) => x.parameter_key === v.parameter_key && (x.room_id ?? null) === roomId)) {
    log.push('Vorschlag verworfen: die Regeln schlagen denselben Wert schon vor'); return null;
  }
  return {
    quelle: 'haiku', art: 'vorschlag', titel: String(v.titel).slice(0, 200), was: String(v.was), warum: String(v.warum),
    wirkung_text: `${String(v.wirkung_text)} Nach 3 Tagen prüft der Wirkungsbericht, ob es geholfen hat.`,
    parameter_key: v.parameter_key, scope: wl.scope, room_id: roomId, alt_wert: alt, neu_wert: neu,
    min_wert: lo, max_wert: hi, einheit, tage_basis: Number(v.tage_basis), belege: { von: 'haiku' },
  };
}

/** Haiku-Prüfung ausführen. Gibt eine kurze Zeile für den Rückblick zurück (oder null). Wirft nie. */
export async function haikuPruefung(sb: any, k: HaikuKontext): Promise<string | null> {
  const { data: s } = await sb.from('system_settings').select('value').eq('key', 'ki_haiku').maybeSingle();
  const cfg = (s?.value ?? {}) as { aktiv?: boolean; modell?: string };
  if (cfg.aktiv !== true) return null;
  const modell = cfg.modell || 'claude-haiku-5-5';
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  const start = Date.now();
  const log: string[] = [];
  const lauf: Record<string, unknown> = { tag: k.gestern, modell, ok: false };

  try {
    if (!key) throw new Error('ANTHROPIC_API_KEY fehlt (Supabase › Edge Functions › Secrets)');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(API_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modell, max_tokens: 1500,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [BERICHT_TOOL], tool_choice: { type: 'tool', name: 'bericht' },
        messages: [{ role: 'user', content: `Daten (JSON):\n${JSON.stringify(datenpaket(k))}` }],
      }),
    }).finally(() => clearTimeout(t));
    const body = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body?.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
    lauf.input_tokens = body.usage?.input_tokens ?? null;
    lauf.output_tokens = body.usage?.output_tokens ?? null;
    const b = body.content?.find((c: any) => c.type === 'tool_use')?.input;
    if (!b) throw new Error('Haiku hat keinen Bericht geliefert');

    const infos = (Array.isArray(b.befunde) ? b.befunde : [])
      .filter((x: any) => x?.titel && Number(x.tage) >= 3).slice(0, MAX_INFOS)
      .map((x: any) => ({ quelle: 'haiku', art: 'info', titel: `Haiku: ${String(x.titel).slice(0, 400)}`, tage_basis: Number(x.tage), tag: k.gestern }));
    const vorschlag = pruefeVorschlag(b.vorschlag, k, log);
    const zeilen = [...(vorschlag ? [{ ...vorschlag, tag: k.gestern }] : []), ...infos];
    if (zeilen.length) {
      const { error } = await sb.from('ki_vorschlaege').insert(zeilen);
      if (error) throw new Error(`ki_vorschlaege insert: ${error.message}`);
    }
    Object.assign(lauf, { ok: true, befunde: infos.length, vorschlag: !!vorschlag, plateau: b.plateau === true,
      antwort: b, hinweis: log.join(' · ') || null });

    const teile: string[] = [];
    if (vorschlag) teile.push('einen Vorschlag');
    if (infos.length) teile.push(infos.length === 1 ? 'einen Hinweis' : `${infos.length} Hinweise`);
    return teile.length ? `Haiku hat zusätzlich ${teile.join(' und ')}.` : 'Haiku hat nichts Neues gefunden.';
  } catch (e) {
    lauf.fehler = String(e);
    console.error('[ki-tagesanalyse] Haiku', e);
    try { await sb.rpc('protokoll_add', { p_kind: 'fehler', p_room: null, p_title: 'Haiku-Prüfung fehlgeschlagen', p_detail: String(e) }); } catch { /* egal */ }
    return null;
  } finally {
    lauf.dauer_ms = Date.now() - start;
    try { await sb.from('ki_haiku_lauf').upsert(lauf, { onConflict: 'tag' }); } catch { /* egal */ }
  }
}
