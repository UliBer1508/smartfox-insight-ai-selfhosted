// system-bridge – Systemstatus für die HAUSVERWALTUNG (23.11.2026, doc/SYSTEMSTATUS-2026-11-05.md §9)
// Die Hausverwaltung (eigenes Supabase-Projekt) zeigt im Systemstatus dieselben PCs, Dienste und
// Cloud-Zeilen wie diese App. Ihre Edge Function system-status prüft dort den Admin und ruft hier an.
//   POST { action: "status" }  → problems, hosts, services, commands (24 h), cloud,
//                                backups (Sicherung dieser Datenbank: backup_runs 14 Tage, backup_standby, backup_settings)
//   POST { action: "command", host, service, action_name }  → Start/Stop/Neustart
// Anmeldung: Kopfzeile x-bridge-token = Secret BRIDGE_TOKEN (gleicher Wert in beiden Projekten).
// verify_jwt = false (supabase/config.toml), weil die Gegenseite kein JWT dieses Projekts hat.
// Regeln wie in der App: service_command_allowed() (Dienst bekannt, Fernzugriff nur starten,
// kein doppelter Befehl). Die Datenbank-Policy für Befehle gilt nur für angemeldete Admins –
// hier schreibt der Service-Schlüssel, deshalb wird service_command_allowed() vorher geprüft.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bridgeAuthorized } from '../_shared/bridge.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HOST_RE = /^[a-z0-9-]{1,40}$/;
const NAME_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const ACTIONS = new Set(['start', 'stop', 'restart']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'nur POST' }, 405);
  if (!bridgeAuthorized(req)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'kein JSON' }, 400); }

  try {
    if (body.action === 'status') {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
      const [prob, h, s, c, cl, br, bs] = await Promise.all([
        db.rpc('system_problems'),
        db.from('system_hosts').select('*').order('host'),
        db.from('system_services').select('*').order('label'),
        db.from('service_commands').select('id, host, service_name, action, status, result, created_at, executed_at')
          .gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        db.rpc('system_cloud_status'),
        db.from('backup_runs').select('*').gte('finished_at', since14).order('finished_at', { ascending: false }).limit(60),
        db.from('system_settings').select('key, value').in('key', ['backup_settings', 'backup_standby']),
      ]);
      const err = prob.error ?? h.error ?? s.error ?? c.error ?? cl.error;
      if (err) { console.error('[system-bridge] status', err); return json({ error: 'Status nicht lesbar' }, 500); }
      const wert = (k: string) => (bs.data ?? []).find((r: { key: string }) => r.key === k)?.value ?? null;
      return json({
        problems: prob.data ?? [], hosts: h.data ?? [], services: s.data ?? [], commands: c.data ?? [], cloud: cl.data ?? null,
        backups: br.error ? null : { runs: br.data ?? [], standby: wert('backup_standby'), settings: wert('backup_settings') },
      });
    }

    if (body.action === 'command') {
      const host = String(body.host ?? ''); const service = String(body.service ?? ''); const act = String(body.action_name ?? '');
      if (!HOST_RE.test(host) || !NAME_RE.test(service) || !ACTIONS.has(act)) return json({ error: 'ungültiger Befehl' }, 400);
      const ok = await db.rpc('service_command_allowed', { p_host: host, p_name: service, p_action: act });
      if (ok.error) { console.error('[system-bridge] allowed', ok.error); return json({ error: 'Prüfung fehlgeschlagen' }, 500); }
      if (ok.data !== true) return json({ error: 'Nicht erlaubt (Fernzugriff nur starten, oder ein Befehl läuft schon).' }, 403);
      const ins = await db.from('service_commands').insert({ host, service_name: service, action: act, requested_by: null }).select('id');
      if (ins.error || !ins.data?.length) { console.error('[system-bridge] insert', ins.error); return json({ error: 'Befehl nicht angelegt' }, 500); }
      return json({ ok: true, id: ins.data[0].id });
    }

    return json({ error: 'unbekannte Aktion' }, 400);
  } catch (e) {
    console.error('[system-bridge]', e);
    return json({ error: 'interner Fehler' }, 500);
  }
});
