/**
 * Brücke zwischen Hausverwaltung (usblrulkcgucxtkhugck) und Heizung (pflnniklvqbwjwrjswaz),
 * 23.11.2026, doc/SYSTEMSTATUS-2026-11-05.md §9.
 * Beide Projekte haben das Secret BRIDGE_TOKEN mit demselben Wert. Aufrufe zwischen den
 * Projekten tragen es in der Kopfzeile x-bridge-token. Der anon-Schlüssel reicht dafür nicht:
 * Er steht im öffentlichen Repo.
 * GLEICHE Datei in beiden Repos (supabase/functions/_shared/bridge.ts).
 */

export const HAUSVERWALTUNG_URL = 'https://usblrulkcgucxtkhugck.supabase.co/functions/v1';
export const HEIZUNG_URL = 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1';
export const BRIDGE_TIMEOUT_MS = 15_000;

/** Vergleich in konstanter Zeit, damit das Token nicht über Antwortzeiten erraten werden kann */
export function sameToken(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** true = Kopfzeile x-bridge-token stimmt mit dem Secret BRIDGE_TOKEN überein (mind. 24 Zeichen) */
export function bridgeAuthorized(req: Request): boolean {
  const expected = Deno.env.get('BRIDGE_TOKEN') ?? '';
  return expected.length >= 24 && sameToken(req.headers.get('x-bridge-token') ?? '', expected);
}

/** Andere Seite aufrufen. Wirft mit verständlicher Meldung, wenn Token fehlt oder die Gegenseite nicht antwortet. */
export async function callBridge(url: string, body: unknown): Promise<unknown> {
  const token = Deno.env.get('BRIDGE_TOKEN') ?? '';
  if (token.length < 24) throw new Error('Secret BRIDGE_TOKEN fehlt (mind. 24 Zeichen, in beiden Projekten gleich).');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-token': token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  });
  const text = await resp.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* kein JSON */ }
  if (!resp.ok) {
    const msg = (data as { error?: string } | null)?.error ?? text.slice(0, 200);
    throw new Error(resp.status === 401
      ? 'Heizung lehnt das Token ab (BRIDGE_TOKEN in beiden Projekten gleich?)'
      : `Gegenseite antwortet ${resp.status}: ${msg}`);
  }
  return data;
}
