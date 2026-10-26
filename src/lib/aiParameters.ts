// Gemeinsamer Weg, einen Parameter-Vorschlag anzuwenden (Stand 26.10.2026).
//
// Genutzt von:
//   - KI › Parameter-Vorschläge (Vorschläge des ai-parameter-advisor)
//   - Analyse › "Das Wichtigste" (regelbasierte Vorschläge aus der Tagesauswertung)
//
// Regeln:
//   - Nur Parameter aus ai_parameter_whitelist (enabled) und innerhalb min/max/allowed.
//   - SOC-Parameter nie hier – die laufen ausschließlich über die KI-Batterie-Empfehlung.
//   - Vor dem Schreiben wird der aktuelle DB-Wert gelesen: weicht er von dem ab, was dem
//     Nutzer angezeigt wurde, wird NICHT geschrieben (jemand anderes hat inzwischen geändert).
//   - Es wird nur die eine Spalte geschrieben.
//   - Jede Übernahme wird in ai_parameter_decisions protokolliert (ai-parameter-evaluator bewertet
//     sie nach ~18 h wie jede andere Entscheidung).

import { supabase } from '@/integrations/supabase/client';
import { sameValue } from '@/lib/safeSave';

export const SOC_LOCKED_KEYS = new Set<string>([
  'heating_min_battery_soc',
  'battery_reserve_for_night_soc',
  'micro_budget_min_battery_soc',
]);

/**
 * Whitelist-Einträge, die NICHT als einstellbarer Wert taugen:
 * system_settings.parallel_heating_capacity ist der von pv-automation bei jedem Lauf neu
 * geschriebene Heizplan (Objekt), kein Grenzwert – ein Zahlwert dort würde sofort überschrieben.
 */
export const NOT_A_SETTING_KEYS = new Set<string>(['parallel_heating_capacity']);

export type AutonomyLevel = 'shadow' | 'suggest' | 'auto';

export interface WhitelistRow {
  id: string;
  parameter_key: string;
  scope: 'global' | 'room';
  storage_table: string;
  storage_column: string;
  data_type: 'number' | 'integer' | 'boolean' | 'text';
  min_value: number | null;
  max_value: number | null;
  allowed_values: unknown[] | null;
  autonomy_level: AutonomyLevel;
  enabled: boolean;
  description?: string | null;
}

export function parseValue(raw: string, type: WhitelistRow['data_type']): number | string | boolean | null {
  if (type === 'boolean') return raw === 'true';
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    if (Number.isNaN(n)) return null;
    return type === 'integer' ? Math.round(n) : n;
  }
  return raw;
}

export function validateValue(raw: string, wl: WhitelistRow): { ok: true; value: number | string | boolean } | { ok: false; error: string } {
  const v = parseValue(raw, wl.data_type);
  if (v === null) return { ok: false, error: `Ungültiger Wert für ${wl.data_type}` };
  if (wl.data_type === 'number' || wl.data_type === 'integer') {
    const n = v as number;
    if (wl.min_value != null && n < wl.min_value) return { ok: false, error: `Wert ${n} < min ${wl.min_value}` };
    if (wl.max_value != null && n > wl.max_value) return { ok: false, error: `Wert ${n} > max ${wl.max_value}` };
  }
  if (wl.allowed_values && wl.allowed_values.length > 0) {
    const cmp = String(v);
    if (!wl.allowed_values.map(String).includes(cmp)) return { ok: false, error: `Wert nicht erlaubt: ${cmp}` };
  }
  return { ok: true, value: v };
}

export async function loadWhitelist(): Promise<WhitelistRow[]> {
  const { data } = await supabase.from('ai_parameter_whitelist').select('*').eq('enabled', true);
  return (data ?? []) as unknown as WhitelistRow[];
}

/** Liest den aktuellen Wert eines Whitelist-Parameters aus seiner Speicherstelle. */
export async function readCurrentValue(wl: WhitelistRow, roomId?: string | null): Promise<unknown> {
  if (wl.storage_table === 'rooms') {
    if (!roomId) throw new Error('Raum-ID fehlt');
    const { data, error } = await supabase.from('rooms').select(wl.storage_column).eq('id', roomId).single();
    if (error) throw error;
    return (data as unknown as Record<string, unknown>)[wl.storage_column];
  }
  if (wl.storage_table === 'heating_settings') {
    const { data, error } = await supabase.from('heating_settings').select(`id, ${wl.storage_column}`).limit(1).single();
    if (error) throw error;
    return (data as unknown as Record<string, unknown>)[wl.storage_column];
  }
  if (wl.storage_table === 'system_settings') {
    const { data } = await supabase.from('system_settings').select('value').eq('key', wl.storage_column).maybeSingle();
    return data?.value ?? null;
  }
  throw new Error(`Unbekannte storage_table: ${wl.storage_table}`);
}

async function writeValue(wl: WhitelistRow, value: number | string | boolean, roomId?: string | null) {
  if (wl.storage_table === 'rooms') {
    if (!roomId) throw new Error('Raum-ID fehlt');
    const { error } = await supabase.from('rooms').update({ [wl.storage_column]: value } as never).eq('id', roomId);
    if (error) throw error;
  } else if (wl.storage_table === 'heating_settings') {
    const { data: s, error: se } = await supabase.from('heating_settings').select('id').limit(1).single();
    if (se || !s) throw se ?? new Error('heating_settings nicht gefunden');
    const { error } = await supabase.from('heating_settings').update({ [wl.storage_column]: value } as never).eq('id', s.id);
    if (error) throw error;
  } else if (wl.storage_table === 'system_settings') {
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: wl.storage_column, value: value as never }, { onConflict: 'key' });
    if (error) throw error;
  } else {
    throw new Error(`Unbekannte storage_table: ${wl.storage_table}`);
  }
}

/**
 * Schreibt den Wert, wenn der aktuelle DB-Wert noch `expectedCurrent` entspricht.
 * `expectedCurrent === undefined` überspringt die Prüfung (nur für bereits geprüfte Altpfade).
 */
export async function applyParameterValue(args: {
  wl: WhitelistRow;
  proposed: string;
  roomId?: string | null;
  expectedCurrent?: unknown;
}): Promise<{ ok: true; previous: unknown } | { ok: false; error: string }> {
  const { wl, proposed, roomId } = args;
  if (SOC_LOCKED_KEYS.has(wl.parameter_key)) return { ok: false, error: 'SOC-Parameter nur über die KI-Batterie-Empfehlung' };
  if (NOT_A_SETTING_KEYS.has(wl.parameter_key)) return { ok: false, error: `${wl.parameter_key} ist kein einstellbarer Wert` };
  const v = validateValue(proposed, wl);
  if (v.ok === false) return { ok: false, error: v.error };
  const current = await readCurrentValue(wl, roomId);
  if (args.expectedCurrent !== undefined && !sameValue(current, args.expectedCurrent)) {
    return { ok: false, error: `Inzwischen geändert (jetzt ${String(current)}). Bitte neu laden und prüfen.` };
  }
  await writeValue(wl, v.value, roomId);
  return { ok: true, previous: current };
}

/** Wendet einen neuen, regelbasierten Vorschlag an und protokolliert ihn. */
export async function applyAndLogProposal(args: {
  wl: WhitelistRow;
  roomId?: string | null;
  current: unknown;
  proposed: string;
  reasoning: string;
  source: string;
  evidence: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await applyParameterValue({ wl: args.wl, proposed: args.proposed, roomId: args.roomId, expectedCurrent: args.current });
  if (res.ok === false) return res;
  const now = new Date().toISOString();
  const { error } = await supabase.from('ai_parameter_decisions').insert({
    parameter_scope: args.wl.scope,
    room_id: args.roomId ?? null,
    parameter_key: args.wl.parameter_key,
    current_value: args.current == null ? null : String(args.current),
    proposed_value: args.proposed,
    reasoning: args.reasoning,
    confidence: null,
    context_snapshot: { source: args.source, ...args.evidence } as never,
    expected_outcome: {} as never,
    decision_mode: 'applied',
    applied_at: now,
    applied_by: `user (${args.source})`,
    auto_applied: false,
  });
  // Der Wert ist geschrieben; ein fehlgeschlagenes Protokoll darf das nicht verschweigen.
  if (error) return { ok: false, error: `Wert übernommen, aber nicht protokolliert: ${error.message}` };
  return { ok: true };
}

/**
 * Der ai-parameter-advisor legt einen noch nicht übernommenen Vorschlag bei jedem Lauf (stündlich)
 * erneut an. Als "offen" zählt daher nur der NEUESTE Vorschlag je Parameter + Raum, und nur, wenn
 * dieser weder übernommen, automatisch angewendet noch abgelehnt ist. Ältere Wiederholungen gelten
 * als überholt. Erwartet die Liste absteigend nach created_at sortiert.
 */
export function latestOpenDecisionIds<T extends {
  id: string; parameter_key: string; parameter_scope: string; room_id: string | null;
  applied_at: string | null; auto_applied?: boolean | null; decision_mode: string;
}>(rowsNewestFirst: T[], suggestKeys: Set<string>): Set<string> {
  const seen = new Set<string>();
  const open = new Set<string>();
  for (const d of rowsNewestFirst) {
    const k = `${d.parameter_scope}:${d.parameter_key}:${d.room_id ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (d.applied_at || d.auto_applied || d.decision_mode === 'rejected') continue;
    if (!suggestKeys.has(`${d.parameter_scope}:${d.parameter_key}`)) continue;
    if (SOC_LOCKED_KEYS.has(d.parameter_key) || NOT_A_SETTING_KEYS.has(d.parameter_key)) continue;
    open.add(d.id);
  }
  return open;
}
