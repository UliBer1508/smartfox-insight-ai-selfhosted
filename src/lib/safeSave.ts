/**
 * Hilfsfunktionen für "sicheres Speichern" (Stand 23.10.2026).
 *
 * Grundsatz: Es werden NUR die Felder geschrieben, die der Nutzer tatsächlich geändert hat.
 * Vor dem Schreiben wird geprüft, ob jemand anders (KI-Autopilot, Batterie-Vorschlag,
 * pv-automation, zweites Gerät) genau diese Felder inzwischen geändert hat. Dann wird
 * NICHT überschrieben, sondern neu geladen und der Nutzer informiert.
 */

const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** Vergleicht zwei DB-Werte tolerant (Zahl vs. Text, "08:00" vs. "08:00:00", null vs. undefined). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  const sa = String(a);
  const sb = String(b);
  if (TIME_RE.test(sa) && TIME_RE.test(sb)) return sa.slice(0, 5).padStart(5, '0') === sb.slice(0, 5).padStart(5, '0');
  const na = Number(sa);
  const nb = Number(sb);
  if (sa.trim() !== '' && sb.trim() !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return Math.abs(na - nb) < 1e-9;
  return sa === sb;
}

/** Felder, die nie aus einem Formular mitgeschrieben werden dürfen. */
export const NEVER_WRITE = new Set(['id', 'created_at', 'updated_at']);

/** Entfernt Systemfelder aus einem Patch. */
export function cleanPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (NEVER_WRITE.has(k) || v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Liefert die Schlüssel, bei denen die DB inzwischen einen anderen Wert hat als beim Laden (base)
 * UND dieser nicht zufällig schon dem neuen Wert entspricht.
 */
export function findConflicts(
  keys: string[],
  base: Record<string, unknown>,
  fresh: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  return keys.filter((k) => !sameValue(fresh[k], base[k]) && !sameValue(fresh[k], next[k]));
}
