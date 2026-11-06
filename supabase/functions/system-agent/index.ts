// system-agent – Schnittstelle für den Dienste-Wächter auf den PCs (Österreich, München)  (05.11.2026)
// Doku: doc/SYSTEMSTATUS-2026-11-05.md
//
// Der Wächter meldet sich alle 30 s:
//   POST { action: "report", host, label, version, info, services: [...] }
//     → schreibt PC + Dienste (system_agent_report) und gibt offene Befehle zurück: { commands: [...] }
//   POST { action: "ping", host } → nur prüfen, ob Adresse und Token stimmen (für --test)
//   POST { action: "result", host, id, ok, message, status }
//     → Ergebnis eines Befehls (system_agent_result)
//
// Anmeldung: Kopfzeile x-agent-token = Secret SYSTEM_AGENT_TOKEN (kein anon-Schlüssel – der steht im öffentlichen Repo).
// verify_jwt = false (supabase/config.toml), weil der Wächter kein Supabase-JWT hat.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Vergleich in konstanter Zeit, damit das Token nicht über Antwortzeiten erraten werden kann
function sameToken(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const HOST_RE = /^[a-z0-9-]{1,40}$/;
const NAME_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const STATUS = new Set(['running', 'stopped', 'unknown']);
const KINDS = new Set(['nssm', 'extra']);
const CONTROLS = new Set(['full', 'start_only', 'none']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'nur POST' }, 405);

  const expected = Deno.env.get('SYSTEM_AGENT_TOKEN') ?? '';
  const got = req.headers.get('x-agent-token') ?? '';
  if (expected.length < 24 || !sameToken(got, expected)) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'kein JSON' }, 400); }

  const host = String(body.host ?? '');
  if (!HOST_RE.test(host) || host === 'cloud') return json({ error: 'host ungültig' }, 400);

  // Test des Wächters (node index.js --test): Adresse und Token stimmen, nichts schreiben
  if (body.action === 'ping') return json({ ok: true, host });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (body.action === 'report') {
    const raw = Array.isArray(body.services) ? body.services.slice(0, 100) : [];
    // Nur saubere Felder weitergeben – was der Wächter schickt, wird geprüft, nicht geglaubt
    const services = raw
      .filter((s: any) => s && NAME_RE.test(String(s.name)) && KINDS.has(String(s.kind)))
      .map((s: any) => ({
        name: String(s.name),
        label: String(s.label ?? s.name).slice(0, 80),
        url: typeof s.url === 'string' && /^https?:\/\//.test(s.url) ? s.url.slice(0, 300) : null,
        kind: String(s.kind),
        control: CONTROLS.has(String(s.control)) ? String(s.control) : 'none',
        status: STATUS.has(String(s.status)) ? String(s.status) : 'unknown',
        detail: s.detail ? String(s.detail).slice(0, 200) : null,
      }));

    const { data, error } = await supabase.rpc('system_agent_report', {
      p_host: host,
      p_label: String(body.label ?? host).slice(0, 60),
      p_version: String(body.version ?? '').slice(0, 20),
      p_info: typeof body.info === 'object' && body.info ? body.info : {},
      p_services: services,
    });
    if (error) {
      console.error('[report]', host, error.message);
      return json({ error: error.message }, 500);
    }
    return json({ ok: true, commands: data ?? [] });
  }

  if (body.action === 'result') {
    const status = body.status && STATUS.has(String(body.status)) ? String(body.status) : null;
    const { error } = await supabase.rpc('system_agent_result', {
      p_host: host,
      p_id: String(body.id ?? ''),
      p_ok: body.ok === true,
      p_message: String(body.message ?? '').slice(0, 500),
      p_status: status,
    });
    if (error) {
      console.error('[result]', host, error.message);
      return json({ error: error.message }, 500);
    }
    console.log(`[result] ${host} ${body.id} ok=${body.ok} → ${status ?? '-'}`);
    return json({ ok: true });
  }

  return json({ error: 'action unbekannt' }, 400);
});
