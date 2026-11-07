// KI › Zu entscheiden (04.11.2026, Konzept KI-Vorschläge §9; Grenzen aus aktuellen Raumwerten: 07.11.2026).
// Lädt alles, was auf Ulis Entscheidung wartet, aus einer Quelle zusammen:
//   - ki_vorschlaege (ki-tagesanalyse, täglich 10:00: Vorschläge, Rücknahmen, Infos)
//   - battery_soc_suggestions (Batterie-Empfehlung, täglich 21:00) – in dasselbe Format gebracht
//   - ki_tagespaket (Rückblick auf gestern)
//   - system_settings.battery_soc_suggestion_last (letzte Batterie-Rechnung, auch ohne Vorschlag)
// und schreibt Entscheidungen auf den bestehenden Wegen (aiParameters.ts bzw. battery-soc-decision).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { applyParameterValue, loadWhitelist } from '@/lib/aiParameters';

export interface KiVorschlag {
  id: string;
  quelle: 'tagesanalyse' | 'batterie' | 'rueckblick';
  art: 'vorschlag' | 'ruecknahme' | 'info';
  titel: string;
  was: string | null;
  warum: string | null;
  wirkung_text: string | null;
  details: string | null;
  parameter_key: string | null;
  scope: string | null;
  room_id: string | null;
  alt_wert: number | null;
  neu_wert: number | null;
  min_wert: number | null;
  max_wert: number | null;
  einheit: string;
  tage_basis: number | null;
  created_at: string;
  /** Batterie-Empfehlung: Zeile in battery_soc_suggestions statt ki_vorschlaege */
  batterieId?: string;
}

export interface Tagespaket { tag: string; text: string; note: number | null; erstellt_at: string }

const db = supabase as any; // neue Tabellen (SQL 21) noch nicht in types.ts

function batterieAlsVorschlag(s: any): KiVorschlag {
  const alt = Number(s.old_value), neu = Number(s.new_value);
  const runter = neu < alt;
  const kern = String(s.reason_text ?? '').split(/(?<=\.)\s/)[0] || null;
  return {
    id: `batterie-${s.id}`, batterieId: s.id, quelle: 'batterie', art: 'vorschlag',
    titel: `Batterie: Grenze fürs Heizen von ${alt} % auf ${neu} % ${runter ? 'senken' : 'anheben'}?`,
    was: `Solange die Batterie unter ${neu} % geladen ist, heizt die Steuerung nur mit echtem Sonnen-Überschuss – die Sonne lädt zuerst die Batterie. Bisher lag diese Grenze bei ${alt} %.`,
    warum: kern ? `Die Batterie braucht für die Nacht etwa so viel: ${kern}` : 'Neu berechnet aus dem gemessenen Nachtbedarf.',
    wirkung_text: runter
      ? 'Mittags wird früher mit Sonne geheizt statt die Batterie weiter vollzuladen. Die Nacht bleibt laut Messung gedeckt.'
      : 'Mehr Reserve für die Nacht. Dafür wird tagsüber erst später mit Sonne geheizt.',
    details: s.reason_text ?? null,
    parameter_key: 'heating_min_battery_soc', scope: 'global', room_id: null,
    alt_wert: alt, neu_wert: neu, min_wert: 40, max_wert: 90, einheit: '%',
    tage_basis: null, created_at: s.created_at,
  };
}

/**
 * 07.11.2026: Raumwerte-Grenzen gelten so, wie die Raumwerte JETZT sind – nicht wie um 10:00, als die
 * Tagesanalyse lief. Sonst blockiert ein gespeicherter Mindestwert (z. B. alter Komfort 23 °C) die Übernahme,
 * obwohl Uli Komfort inzwischen geändert hat.
 *   Estrich laden bis (pv_boost_max_temp): Komfort … Komfort + 2
 *   Untergrenze (wait_min_temp):           Eco − 2 … Eco
 * jeweils zusätzlich innerhalb der Whitelist.
 */
function aktuelleGrenzen(
  v: KiVorschlag,
  raum: { eco_temp: number | null; comfort_temp: number | null } | undefined,
  wl: { min_value: number | null; max_value: number | null } | undefined,
): { min_wert: number | null; max_wert: number | null } {
  const wlMin = wl?.min_value != null ? Number(wl.min_value) : -Infinity;
  const wlMax = wl?.max_value != null ? Number(wl.max_value) : Infinity;
  if (v.parameter_key === 'pv_boost_max_temp' && raum?.comfort_temp != null) {
    const k = Number(raum.comfort_temp);
    return { min_wert: Math.max(k, wlMin), max_wert: Math.min(k + 2, wlMax) };
  }
  if (v.parameter_key === 'wait_min_temp' && raum?.eco_temp != null) {
    const e = Number(raum.eco_temp);
    return { min_wert: Math.max(e - 2, wlMin), max_wert: Math.min(e, wlMax) };
  }
  return { min_wert: v.min_wert, max_wert: v.max_wert };
}

export function useKiVorschlaege(pollMs = 60_000) {
  const [offen, setOffen] = useState<KiVorschlag[]>([]);
  const [infos, setInfos] = useState<KiVorschlag[]>([]);
  const [paket, setPaket] = useState<Tagespaket | null>(null);
  const [batterieLetzte, setBatterieLetzte] = useState<{ at: string; old: number; proposed: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [kv, bat, tp, last, rm, wlAll] = await Promise.all([
      db.from('ki_vorschlaege').select('*').or('status.eq.offen,art.eq.info')
        .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('battery_soc_suggestions').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(1),
      db.from('ki_tagespaket').select('*').order('tag', { ascending: false }).limit(1),
      supabase.from('system_settings').select('value').eq('key', 'battery_soc_suggestion_last').maybeSingle(),
      supabase.from('rooms').select('id, eco_temp, comfort_temp'),
      loadWhitelist(),
    ]);
    const raumMap = new Map<string, any>(((rm.data ?? []) as any[]).map((r) => [r.id, r]));
    const wlMap = new Map<string, any>(wlAll.map((w) => [w.parameter_key, w]));
    if (kv.error) setFehler(kv.error.message.includes('ki_vorschlaege') ? 'SQL 21 ist noch nicht ausgeführt.' : kv.error.message);
    else setFehler(null);
    const rows = (kv.data ?? []) as KiVorschlag[];
    const neuesterTag = rows.filter((r) => r.art === 'info').map((r: any) => r.tag).sort().pop();
    const batterie = (bat.data ?? []).map(batterieAlsVorschlag);
    const offeneKi = rows.filter((r) => r.art !== 'info' && (r as any).status === 'offen')
      .map((r) => (r.scope === 'room' && r.room_id
        ? { ...r, ...aktuelleGrenzen(r, raumMap.get(r.room_id), wlMap.get(r.parameter_key ?? '')) }
        : r))
      .sort((a, b) => (a.art === 'ruecknahme' ? -1 : 0) - (b.art === 'ruecknahme' ? -1 : 0));
    setOffen([...offeneKi, ...batterie]);
    setInfos(rows.filter((r: any) => r.art === 'info' && r.tag === neuesterTag));
    setPaket((tp.data ?? [])[0] ?? null);
    const v = last.data?.value as any;
    setBatterieLetzte(v?.at ? { at: v.at, old: Number(v.old), proposed: Number(v.proposed) } : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  /** Ja / Anderer Wert. Gibt eine Fehlermeldung zurück oder null. */
  const genehmigen = useCallback(async (v: KiVorschlag, wert?: number, notiz?: string): Promise<string | null> => {
    const ziel = wert ?? Number(v.neu_wert);
    let grenzen = { min_wert: v.min_wert, max_wert: v.max_wert };
    if (v.scope === 'room' && v.room_id) {
      const [{ data: raum }, wlAktuell] = await Promise.all([
        supabase.from('rooms').select('eco_temp, comfort_temp').eq('id', v.room_id).maybeSingle(),
        loadWhitelist(),
      ]);
      grenzen = aktuelleGrenzen(v, (raum ?? undefined) as any, wlAktuell.find((w) => w.parameter_key === v.parameter_key));
    }
    const f = (x: number) => (v.einheit === '°C' ? x.toFixed(1).replace('.', ',') : String(Math.round(x)));
    if (grenzen.min_wert != null && ziel < Number(grenzen.min_wert)) return `Mindestens ${f(Number(grenzen.min_wert))} ${v.einheit} (Grenze nach den aktuellen Raumwerten)`;
    if (grenzen.max_wert != null && ziel > Number(grenzen.max_wert)) return `Höchstens ${f(Number(grenzen.max_wert))} ${v.einheit} (Grenze nach den aktuellen Raumwerten)`;

    // Batterie-Grenze schreibt nur battery-soc-decision (gesperrter Parameter)
    if (v.parameter_key === 'heating_min_battery_soc') {
      const body = v.batterieId
        ? { suggestion_id: v.batterieId, action: 'accept', value: wert, notiz }
        : { ki_vorschlag_id: v.id, action: 'accept', value: wert, notiz };
      const { data, error } = await supabase.functions.invoke('battery-soc-decision', { body });
      if (error || data?.error) return data?.error ?? error?.message ?? 'Fehler';
      await load();
      return null;
    }

    const wl = (await loadWhitelist()).find((w) => w.parameter_key === v.parameter_key && w.scope === v.scope);
    if (!wl) return 'Dieser Wert ist nicht mehr freigegeben (Whitelist).';
    const res = await applyParameterValue({ wl, proposed: String(ziel), roomId: v.room_id, expectedCurrent: v.alt_wert });
    if (res.ok === false) return res.error;
    const now = new Date().toISOString();
    await db.from('ki_vorschlaege').update({
      status: wert != null && wert !== Number(v.neu_wert) ? 'geaendert' : 'genehmigt',
      entschieden_at: now, entschieden_wert: ziel, notiz: notiz ?? null,
    }).eq('id', v.id);
    // gemeinsames Entscheidungs-Protokoll (wie Analyse › Das Wichtigste)
    await supabase.from('ai_parameter_decisions').insert({
      parameter_scope: wl.scope, room_id: v.room_id, parameter_key: wl.parameter_key,
      current_value: v.alt_wert == null ? null : String(v.alt_wert), proposed_value: String(ziel),
      reasoning: [v.was, v.warum].filter(Boolean).join(' '), confidence: null,
      context_snapshot: { source: 'KI › Zu entscheiden', ki_vorschlag_id: v.id } as never,
      expected_outcome: {} as never, decision_mode: 'applied', applied_at: now,
      applied_by: 'user (KI › Zu entscheiden)', auto_applied: false,
    });
    await load();
    return null;
  }, [load]);

  const ablehnen = useCallback(async (v: KiVorschlag, notiz?: string): Promise<string | null> => {
    if (v.batterieId) {
      const { data, error } = await supabase.functions.invoke('battery-soc-decision', { body: { suggestion_id: v.batterieId, action: 'dismiss' } });
      if (error || data?.error) return data?.error ?? error?.message ?? 'Fehler';
    } else {
      const { error } = await db.from('ki_vorschlaege').update({ status: 'abgelehnt', entschieden_at: new Date().toISOString(), notiz: notiz ?? null }).eq('id', v.id);
      if (error) return error.message;
    }
    await load();
    return null;
  }, [load]);

  return { offen, infos, paket, batterieLetzte, loading, fehler, genehmigen, ablehnen, reload: load };
}
