// Systemstatus – Symbol in der Kopfleiste + Fenster (05.11.2026, Mockup freigegeben, doc/SYSTEMSTATUS-2026-11-05.md)
// Zeigt, ob alle Prozesse laufen: Österreich-PC, München-PC (gemeldet vom Dienste-Wächter) und Cloud.
// Start/Stop/Neustart nur für Admins; Fernzugriff (Tailscale, Cloudflare) nur starten.
import { useState } from 'react';
import { Server, Cloud, Monitor, RefreshCw, ExternalLink, Loader2, CheckCircle2, AlertTriangle, Play, Square, RotateCw, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useSystemStatus, HOST_STALE_MS,
  type SystemService, type ServiceCommand, type ServiceAction, type CloudStatus,
} from '@/hooks/useSystemStatus';

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';

function ago(iso: string | null | undefined): string {
  if (!iso) return 'nie';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `vor ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `vor ${h} h`;
  return `seit ${fmtTime(iso)}`;
}

type Tone = 'ok' | 'bad' | 'warn' | 'off';
const DOT: Record<Tone, string> = {
  ok: 'bg-green-500', bad: 'bg-red-500', warn: 'bg-amber-500', off: 'bg-muted-foreground/40',
};
const Dot = ({ tone }: { tone: Tone }) => <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', DOT[tone])} />;

// --- Symbol in der Kopfleiste -------------------------------------------------------------------------------
export function SystemStatusButton({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const status = useSystemStatus(open);
  if (!status.ready) return null; // vor SQL 22: Symbol ausblenden

  const n = status.problems.length;
  const label = n === 0 ? 'Alles läuft' : n === 1 ? '1 Problem' : `${n} Probleme`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Systemstatus: ${label}`}
        aria-label={`Systemstatus: ${label}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border text-[10px] md:text-xs font-medium transition-colors flex-shrink-0',
          compact ? 'h-8 px-2' : 'px-2.5 py-1',
          n === 0
            ? 'border-border text-muted-foreground hover:bg-muted'
            : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
        )}
      >
        <Server className="w-3.5 h-3.5" />
        {n === 0 ? <Dot tone="ok" /> : <span>{compact ? n : label}</span>}
      </button>
      <SystemStatusDialog open={open} onOpenChange={setOpen} status={status} />
    </>
  );
}

// --- Fenster --------------------------------------------------------------------------------------------
export function SystemStatusDialog({ open, onOpenChange, status }: {
  open: boolean; onOpenChange: (o: boolean) => void; status: ReturnType<typeof useSystemStatus>;
}) {
  const { problems, hosts, services, commands, cloud, isAdmin, loadedAt, reload, sendCommand, runPvAutomation } = status;
  const [error, setError] = useState<string | null>(null);
  const [busyPv, setBusyPv] = useState(false);
  const pcs = hosts.filter((h) => h.host !== 'cloud');
  const web = services.filter((s) => s.host === 'cloud');

  const act = async (svc: SystemService, action: ServiceAction) => {
    if (action === 'stop' && !window.confirm(`${svc.label} wirklich stoppen?`)) return;
    setError(await sendCommand(svc.host, svc.name, action));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-4 md:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Server className="w-5 h-5" />Systemstatus</DialogTitle>
          <DialogDescription>Laufen alle Prozesse – auf den PCs und in der Cloud?</DialogDescription>
        </DialogHeader>

        {problems.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 px-3 py-2 text-sm text-green-800 dark:text-green-300">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Alles läuft.
          </div>
        ) : (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300 space-y-1">
            {problems.map((p) => (
              <div key={p.key} className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span><b>{p.area}:</b> {p.text}</span></div>
            ))}
          </div>
        )}
        {error && <div className="text-sm text-red-600">{error}</div>}

        {pcs.length === 0 && (
          <div className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
            Noch kein PC verbunden. Auf jedem PC den Dienste-Wächter einrichten
            (Anleitung: <code>local-collector/dienste-waechter/README.md</code>).
          </div>
        )}

        {pcs.map((h) => {
          const stale = !h.last_seen || Date.now() - new Date(h.last_seen).getTime() > HOST_STALE_MS;
          const rows = services.filter((s) => s.host === h.host);
          return (
            <Card key={h.host} icon={<Monitor className="w-4 h-4" />} title={h.label}
              right={<span className={cn('text-xs', stale ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                {stale ? `meldet sich nicht ${h.last_seen ? 'seit ' + fmtTime(h.last_seen) : ''}` : `meldet sich · ${ago(h.last_seen)}`}
              </span>}>
              {rows.length === 0 && <Row tone="off" title="Keine Dienste gemeldet" />}
              {rows.map((s) => (
                <ServiceRow key={s.name} svc={s} stale={stale} isAdmin={isAdmin}
                  cmd={commands.find((c) => c.host === s.host && c.service_name === s.name)}
                  onAction={(a) => act(s, a)} />
              ))}
            </Card>
          );
        })}

        <Card icon={<Cloud className="w-4 h-4" />} title="Cloud">
          <CloudRows cloud={cloud} isAdmin={isAdmin} busyPv={busyPv} onRunPv={async () => {
            setBusyPv(true); setError(await runPvAutomation()); setBusyPv(false);
          }} />
          {web.map((s) => (
            <Row key={s.name} tone={s.status === 'running' ? 'ok' : 'bad'} title={s.label}
              sub={`${s.status === 'running' ? 'erreichbar' : 'nicht erreichbar'}${s.detail ? ' · ' + s.detail : ''} · geprüft ${ago(s.updated_at)}`}
              url={s.url} />
          ))}
        </Card>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex-1">
            {isAdmin
              ? 'Start und Stop werden vom Dienste-Wächter innerhalb von 30 s ausgeführt. Fernzugriff (Tailscale, Cloudflare) nur starten, nie stoppen. Bei Problemen kommt eine Mail.'
              : 'Ansehen. Steuern dürfen nur Admins.'}
            {loadedAt && ` Stand ${loadedAt.toLocaleTimeString('de-AT')}.`}
          </span>
          <Button variant="outline" size="sm" onClick={reload} className="h-7 gap-1"><RefreshCw className="w-3 h-3" />Aktualisieren</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Card({ icon, title, right, children }: { icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 font-medium text-sm">{icon}{title}<span className="ml-auto">{right}</span></div>
      <div className="divide-y border-t">{children}</div>
    </div>
  );
}

function Row({ tone, title, sub, url, actions }: { tone: Tone; title: string; sub?: React.ReactNode; url?: string | null; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
      <Dot tone={tone} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 truncate">
          {title}
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="Öffnen"><ExternalLink className="w-3 h-3" /></a>}
        </div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      {actions && <div className="flex gap-1 flex-shrink-0">{actions}</div>}
    </div>
  );
}

function ServiceRow({ svc, stale, isAdmin, cmd, onAction }: {
  svc: SystemService; stale: boolean; isAdmin: boolean; cmd?: ServiceCommand; onAction: (a: ServiceAction) => void;
}) {
  const busy = cmd && (cmd.status === 'pending' || cmd.status === 'running');
  const recentFail = cmd && (cmd.status === 'failed' || cmd.status === 'expired')
    && Date.now() - new Date(cmd.created_at).getTime() < 15 * 60 * 1000;
  const tone: Tone = stale ? 'off'
    : svc.status === 'running' ? 'ok'
    : svc.intended_stop ? 'off'
    : svc.status === 'stopped' ? 'bad' : 'warn';
  const state = stale ? 'Zustand unbekannt (PC meldet sich nicht)'
    : svc.status === 'running' ? 'läuft'
    : svc.intended_stop ? `per App gestoppt · ${fmtTime(svc.status_since)}`
    : svc.status === 'stopped' ? `gestoppt seit ${fmtTime(svc.status_since)}` : 'Zustand unbekannt';
  const sub = busy ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />
      {cmd!.action === 'start' ? 'wird gestartet' : cmd!.action === 'stop' ? 'wird gestoppt' : 'wird neu gestartet'} …
      {cmd!.status === 'pending' ? ' (wartet auf den PC)' : ''}</span>
    : recentFail ? <span className="text-red-600">{state} · Befehl fehlgeschlagen: {cmd!.result}</span>
    : state;

  let actions: React.ReactNode = null;
  if (svc.control === 'none') {
    actions = <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="nur ansehen" />;
  } else if (isAdmin && !stale && !busy) {
    const btn = (a: ServiceAction, label: string, Icon: typeof Play, accent = false) => (
      <Button key={a} variant="outline" size="sm" onClick={() => onAction(a)}
        className={cn('h-7 px-2 text-xs gap-1', accent && 'border-primary text-primary')}>
        <Icon className="w-3 h-3" />{label}
      </Button>
    );
    if (svc.status !== 'running') actions = btn('start', 'Start', Play, true);
    else if (svc.control === 'full') actions = <>{btn('restart', 'Neustart', RotateCw)}{btn('stop', 'Stop', Square)}</>;
    else actions = <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Fernzugriff: nur starten" />;
  }
  return <Row tone={tone} title={svc.label} sub={sub} url={svc.url} actions={actions} />;
}

function CloudRows({ cloud, isAdmin, busyPv, onRunPv }: { cloud: CloudStatus | null; isAdmin: boolean; busyPv: boolean; onRunPv: () => void }) {
  if (!cloud) return <Row tone="off" title="Lade …" />;
  const old = (iso: string | null | undefined, min: number) => !iso || Date.now() - new Date(iso).getTime() > min * 60_000;
  const t = cloud.tuya;
  const tuyaPartial = t && t.devices_ok != null && t.devices_configured != null && t.devices_ok < t.devices_configured;
  return (
    <>
      <Row tone={old(cloud.pv_automation_last, 15) ? 'bad' : 'ok'} title="Heizungsautomatik (pv-automation)"
        sub={`letzter Lauf ${ago(cloud.pv_automation_last)}`}
        actions={isAdmin && (
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" disabled={busyPv} onClick={onRunPv}>
            {busyPv ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}Jetzt ausführen
          </Button>
        )} />
      <Row tone={old(cloud.last_energy, 15) ? 'bad' : 'ok'} title="Fronius-Daten" sub={`letzte Messung ${ago(cloud.last_energy)}`} />
      <Row tone={old(t?.last_sync, 10) ? 'bad' : tuyaPartial ? 'warn' : 'ok'} title="Thermostate"
        sub={`${t?.devices_ok ?? '–'}/${t?.devices_configured ?? '–'} erreichbar · letzte Meldung ${ago(t?.last_sync)}${cloud.open_api_errors ? ` · ${cloud.open_api_errors} offene Gerätefehler` : ''}`} />
      {cloud.muc && (
        <Row tone={old(cloud.muc.last_seen, 10) ? 'bad' : cloud.muc.fenecon_ok === false || cloud.muc.loxone_ok === false ? 'warn' : 'ok'}
          title="Heizung München (Collector)"
          sub={`letzte Meldung ${ago(cloud.muc.last_seen)} · FENECON ${cloud.muc.fenecon_ok === false ? 'Fehler' : 'ok'} · Loxone ${cloud.muc.loxone_ok === false ? 'Fehler' : 'ok'}`} />
      )}
      <Row tone={cloud.cron.failed_24h > 0 ? 'warn' : 'ok'} title="Geplante Aufgaben (pg_cron)"
        sub={`${cloud.cron.jobs} Aufgaben · ${cloud.cron.runs_24h} Läufe in 24 h · ${cloud.cron.failed_24h ? `${cloud.cron.failed_24h} Fehler` : 'keine Fehler'}`} />
      <Row tone={cloud.net_2h.errors > 0 ? 'warn' : 'ok'} title="Function-Aufrufe (2 h)"
        sub={`${cloud.net_2h.ok} ok · ${cloud.net_2h.errors} Fehler${cloud.net_2h.timeouts ? ` · ${cloud.net_2h.timeouts} ohne Antwort (lange Läufe, meist harmlos)` : ''}`} />
    </>
  );
}
