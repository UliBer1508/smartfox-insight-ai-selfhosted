// Uhrzeit der Sicherung je PC ändern (24.11.2026, SQL 55, Dienste-Wächter v1.1)
// Uli: „Ich ändere die Zeit und drücke den Button, der die Änderung ausführt.“
// Weg: Befehl service_commands (action 'backup_time', param 'HH:MM') → Dienste-Wächter des PCs holt ihn ab (≤ 30 s),
// stellt die geplante Aufgabe „Supabase-Sicherung Heizung“ um und meldet den nächsten Lauf zurück.
// Gleiche Datei in Heizung München: frontend/src/BackupUhrzeit.jsx. Doku: doc/DATENSICHERUNG.md „Uhrzeit ändern“.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any; // system_hosts / service_commands.param (SQL 55) noch nicht in types.ts

type Host = { host: string; label: string; last_seen: string | null; agent_version: string | null; info: { computer?: string } | null };
type Cmd = { id: string; status: string; result: string | null; param: string | null; created_at: string; executed_at: string | null };

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const zweistellig = (t: string | null | undefined) => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};
const wann = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const versionOk = (v: string | null) => {
  const [a, b] = String(v ?? '0').split('.').map(Number);
  return a > 1 || (a === 1 && (b || 0) >= 1);
};

/** backupHost = Rechnername aus backup_runs (z. B. MINIPC-WEIDMANN, von Windows auf 15 Zeichen gekürzt) */
export function BackupUhrzeit({ backupHost, aktuell }: { backupHost: string | null; aktuell: string | null }) {
  const [host, setHost] = useState<Host | null>(null);
  const [admin, setAdmin] = useState(false);
  const [cmd, setCmd] = useState<Cmd | null>(null);
  const [zeit, setZeit] = useState(zweistellig(aktuell));
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    if (!backupHost) return;
    const [h, a] = await Promise.all([db.from('system_hosts').select('host,label,last_seen,agent_version,info'), db.rpc('is_system_admin')]);
    const key = backupHost.toUpperCase();
    const found = ((h.data ?? []) as Host[]).find((x) => x.host !== 'cloud' && String(x.info?.computer ?? '').toUpperCase().startsWith(key)) ?? null;
    setHost(found);
    setAdmin(a.data === true);
    if (found) {
      const { data } = await db.from('service_commands').select('id,status,result,param,created_at,executed_at')
        .eq('host', found.host).eq('action', 'backup_time').order('created_at', { ascending: false }).limit(1);
      setCmd((data?.[0] as Cmd) ?? null);
    }
  }, [backupHost]);

  useEffect(() => { laden(); }, [laden]);
  const offen = cmd && (cmd.status === 'pending' || cmd.status === 'running');
  useEffect(() => {
    if (!offen) return;
    const t = setInterval(laden, 3000);
    return () => clearInterval(t);
  }, [offen, laden]);
  useEffect(() => { setZeit(zweistellig(aktuell)); }, [aktuell]);

  if (!backupHost) return null;
  const online = host?.last_seen && Date.now() - new Date(host.last_seen).getTime() < 10 * 60000;
  const grund = !host ? 'Dienste-Wächter dieses PCs nicht gefunden'
    : !versionOk(host.agent_version) ? `Dienste-Wächter ${host.agent_version ?? '?'} – für die Uhrzeit wird v1.1 gebraucht`
      : !online ? 'PC meldet sich gerade nicht'
        : !admin ? 'nur mit Admin-Anmeldung' : null;
  const gueltig = TIME_RE.test(zeit);

  const ausfuehren = async () => {
    if (!host || !gueltig) return;
    setBusy(true); setFehler(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await db.from('service_commands').insert({
      host: host.host, service_name: 'backup', action: 'backup_time', param: zeit, requested_by: user?.id,
    });
    if (error) setFehler(error.message.includes('row-level security') ? 'Nicht erlaubt – läuft schon eine Änderung?' : error.message);
    await laden();
    setBusy(false);
  };

  return (
    <div className="col-span-2 space-y-1.5 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="time" value={zeit} onChange={(e) => setZeit(e.target.value)} className="h-8 w-28" aria-label="Neue Uhrzeit" disabled={!!grund} />
        <Button size="sm" onClick={ausfuehren} disabled={!!grund || !gueltig || busy || !!offen || zeit === zweistellig(aktuell)}>
          {busy || offen ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {offen ? 'wird geändert …' : 'Uhrzeit ändern'}
        </Button>
      </div>
      {grund && <p className="text-xs text-muted-foreground">{grund}</p>}
      {fehler && <p className="text-xs text-destructive">{fehler}</p>}
      {cmd && !offen && (
        <p className={`text-xs ${cmd.status === 'done' ? 'text-emerald-600' : 'text-amber-600'}`}>
          {cmd.status === 'done' ? '✓' : '✗'} {wann(cmd.executed_at ?? cmd.created_at)}: {cmd.result ?? cmd.status}
        </p>
      )}
    </div>
  );
}
