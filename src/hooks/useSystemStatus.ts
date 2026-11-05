// Systemstatus (05.11.2026, doc/SYSTEMSTATUS-2026-11-05.md):
// Laufen alle Prozesse – Österreich-PC, München-PC, Cloud? Daten für das Symbol in der Kopfleiste und das Fenster.
//   - system_problems()     EINE Problemliste (dieselbe, die die Mail auslöst)
//   - system_hosts/services Dienste je PC, gemeldet vom Dienste-Wächter alle 30 s
//   - system_cloud_status() Fronius-Daten, Thermostat-Dienst, Cron, Function-Aufrufe
//   - service_commands      Start/Stop/Neustart (nur Admins; die Datenbank prüft die Regeln)
// Pollt alle 30 s, solange die Seite sichtbar ist; nach einem Befehl alle 3 s, bis er erledigt ist.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ServiceStatus = 'running' | 'stopped' | 'unknown';
export type ServiceControl = 'full' | 'start_only' | 'none';
export type ServiceAction = 'start' | 'stop' | 'restart';

export interface SystemProblem { key: string; area: string; text: string }
export interface SystemHost { host: string; label: string; last_seen: string | null; agent_version: string | null; info: Record<string, unknown> }
export interface SystemService {
  host: string; name: string; label: string; url: string | null;
  kind: 'nssm' | 'extra' | 'web'; control: ServiceControl; status: ServiceStatus;
  status_since: string; detail: string | null; intended_stop: boolean; updated_at: string;
}
export interface ServiceCommand {
  id: string; host: string; service_name: string; action: ServiceAction;
  status: 'pending' | 'running' | 'done' | 'failed' | 'expired'; result: string | null;
  created_at: string; executed_at: string | null;
}
export interface CloudStatus {
  now: string;
  last_energy: string | null;
  tuya: { last_sync: string | null; devices_ok: number | null; devices_configured: number | null } | null;
  open_api_errors: number;
  cron: { jobs: number; runs_24h: number; failed_24h: number; last_run: string | null };
  pv_automation_last: string | null;
  muc: { last_seen: string | null; fenecon_ok: boolean | null; loxone_ok: boolean | null; house_mode: string | null; version: string | null; last_error: string | null } | null;
  net_2h: { ok: number; errors: number; timeouts: number };
}

export const HOST_STALE_MS = 10 * 60 * 1000; // wie system_problems()

export function useSystemStatus(open: boolean) {
  const [problems, setProblems] = useState<SystemProblem[]>([]);
  const [hosts, setHosts] = useState<SystemHost[]>([]);
  const [services, setServices] = useState<SystemService[]>([]);
  const [commands, setCommands] = useState<ServiceCommand[]>([]);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);       // SQL 22 eingespielt?
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any; // Tabellen aus SQL 22 sind noch nicht in den generierten Typen
    const prob = await db.rpc('system_problems');
    if (!alive.current) return;
    if (prob.error) { setReady(false); setLoadedAt(new Date()); return; } // vor SQL 22
    setReady(true);
    setProblems((prob.data ?? []) as SystemProblem[]);
    if (!open) { setLoadedAt(new Date()); return; } // Kopfleiste braucht nur die Probleme

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [h, s, c, cl, adm] = await Promise.all([
      db.from('system_hosts').select('*').order('host'),
      db.from('system_services').select('*').order('label'),
      db.from('service_commands').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(50),
      db.rpc('system_cloud_status'),
      db.rpc('is_system_admin'),
    ]);
    if (!alive.current) return;
    setHosts((h.data ?? []) as SystemHost[]);
    setServices((s.data ?? []) as SystemService[]);
    setCommands((c.data ?? []) as ServiceCommand[]);
    setCloud((cl.data ?? null) as CloudStatus | null);
    setIsAdmin(adm.data === true);
    setLoadedAt(new Date());
  }, [open]);

  const pendingCount = commands.filter((c) => c.status === 'pending' || c.status === 'running').length;

  useEffect(() => {
    alive.current = true;
    load();
    const ms = open && pendingCount > 0 ? 3_000 : 30_000;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, ms);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, open, pendingCount]);

  const sendCommand = useCallback(async (host: string, service: string, action: ServiceAction) => {
    const { data: { user } } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('service_commands').insert({
      host, service_name: service, action, requested_by: user?.id,
    });
    await load();
    return error ? (error.message.includes('row-level security')
      ? 'Nicht erlaubt (Fernzugriff nur starten, oder ein Befehl läuft schon).'
      : error.message) : null;
  }, [load]);

  const runPvAutomation = useCallback(async () => {
    const { error } = await supabase.functions.invoke('pv-automation', { body: { action: 'check' } });
    await load();
    return error ? error.message : null;
  }, [load]);

  return { problems, hosts, services, commands, cloud, isAdmin, ready, loadedAt, reload: load, sendCommand, runPvAutomation };
}
