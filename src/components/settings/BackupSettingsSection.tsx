import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertTriangle, CheckCircle2, ExternalLink, History, Loader2, PauseCircle, Save, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import useBackupRuns, { isMissingTableError } from '@/hooks/useBackupRuns';
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from '@/hooks/useBackupSettings';
import {
  BACKUP_STATUS_LABELS,
  findLastSuccessfulRun,
  formatBytes,
  isBackupOverdue,
  type BackupRun,
  type BackupRunStatus,
} from '@/lib/backupStatus';

/**
 * Einstellungen -> Bereich "Datensicherung" (im Accordion von SettingsPanel.tsx)
 *
 * Zeigt, was die naechtliche Sicherung auf dem PN40 gemeldet hat (Tabelle
 * backup_runs, supabase/SQL/01_datensicherung.sql), und steuert sie ueber
 * system_settings.backup_settings. Gleiches Konzept wie die Karte
 * "Datensicherung" in der Hausverwaltung (BackupSettingsCard.tsx).
 * Das Skript Backup-Supabase.ps1 liest diese Einstellungen zu Beginn jedes
 * Laufs - Aenderungen wirken also ab der naechsten Sicherung.
 *
 * Die Uhrzeit ist hier NUR Anzeige: Sie steckt in der Windows-Aufgabenplanung
 * des PN40 und wird dort mit Setup-SupabaseBackup.ps1 geaendert.
 *
 * Doku: doc/DATENSICHERUNG.md
 */

const STATUS_STYLE: Record<BackupRunStatus, { badge: string; dot: string; Icon: typeof CheckCircle2 }> = {
  erfolgreich: {
    badge: 'border-green-600 text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
    Icon: CheckCircle2,
  },
  warnungen: {
    badge: 'border-amber-500 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
    Icon: AlertTriangle,
  },
  fehlgeschlagen: {
    badge: 'border-red-600 text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
    Icon: XCircle,
  },
  pausiert: {
    badge: 'border-slate-400 text-slate-600 dark:text-slate-300',
    dot: 'bg-slate-400',
    Icon: PauseCircle,
  },
};

const StatusBadge = ({ status }: { status: BackupRunStatus }) => {
  const { badge, Icon } = STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={cn('gap-1', badge)}>
      <Icon className="h-3 w-3" />
      {BACKUP_STATUS_LABELS[status]}
    </Badge>
  );
};

const formatWhen = (iso: string) =>
  format(new Date(iso), "EEEEEE dd.MM.yyyy 'um' HH:mm", { locale: de });

const clampInt = (raw: string, min: number, max: number, fallback: number) => {
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
};

export function BackupSettingsSection() {
  const { toast } = useToast();
  const { data: runs = [], isLoading: runsLoading, error: runsError } = useBackupRuns(10);
  const { data: settings, isLoading: settingsLoading, saveSettings, isSaving } = useBackupSettings();

  const [enabled, setEnabled] = useState(DEFAULT_BACKUP_SETTINGS.enabled);
  const [retentionDays, setRetentionDays] = useState(String(DEFAULT_BACKUP_SETTINGS.retention_days));
  const [warnAfterHours, setWarnAfterHours] = useState(String(DEFAULT_BACKUP_SETTINGS.warn_after_hours));

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled ?? DEFAULT_BACKUP_SETTINGS.enabled);
      setRetentionDays(String(settings.retention_days ?? DEFAULT_BACKUP_SETTINGS.retention_days));
      setWarnAfterHours(String(settings.warn_after_hours ?? DEFAULT_BACKUP_SETTINGS.warn_after_hours));
    }
  }, [settings]);

  const savedWarnHours = settings?.warn_after_hours ?? DEFAULT_BACKUP_SETTINGS.warn_after_hours;
  const savedEnabled = settings?.enabled ?? DEFAULT_BACKUP_SETTINGS.enabled;
  const lastRun: BackupRun | null = runs[0] ?? null;
  const lastSuccess = findLastSuccessfulRun(runs);
  const overdue = savedEnabled && runs.length > 0 && isBackupOverdue(runs, savedWarnHours);
  const tableMissing = isMissingTableError(runsError);

  const handleSave = async () => {
    const retention = clampInt(retentionDays, 1, 365, DEFAULT_BACKUP_SETTINGS.retention_days);
    const warnHours = clampInt(warnAfterHours, 12, 168, DEFAULT_BACKUP_SETTINGS.warn_after_hours);
    setRetentionDays(String(retention));
    setWarnAfterHours(String(warnHours));
    try {
      await saveSettings({
        enabled,
        include_storage: settings?.include_storage ?? DEFAULT_BACKUP_SETTINGS.include_storage,
        retention_days: retention,
        warn_after_hours: warnHours,
      });
      toast({
        title: 'Gespeichert',
        description: enabled
          ? `Wirkt ab der nächsten Sicherung: ${retention} Tage aufbewahren.`
          : 'Die Sicherung ist pausiert. Der PC meldet nachts nur noch „Pausiert“.',
      });
    } catch (e) {
      console.error('[BackupSettingsSection] Speichern', e);
      toast({
        title: 'Fehler beim Speichern',
        description: 'Die Einstellungen konnten nicht gespeichert werden.',
        variant: 'destructive',
      });
    }
  };

  if (runsLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Der PN40 sichert jede Nacht die komplette Heizungs-Datenbank ins OneDrive.
      </p>
        {/* ---------- Zustand ---------- */}
        {tableMissing ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Das Protokoll ist noch nicht eingerichtet. Bitte{' '}
            <code className="text-xs">supabase/SQL/01_datensicherung.sql</code> im
            Supabase SQL-Editor ausführen.
          </div>
        ) : runsError ? (
          <div className="rounded-lg border border-red-300 p-4 text-sm text-red-700 dark:text-red-400">
            Das Sicherungsprotokoll konnte nicht geladen werden.
          </div>
        ) : !lastRun ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Noch keine Sicherung gemeldet. Die Anzeige erscheint nach dem nächsten Lauf
            des Sicherungsskripts (ab Version v2) auf dem PN40.
          </div>
        ) : (
          <>
            {overdue && (
              <div className="flex gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    {lastSuccess
                      ? `Letzte gelungene Sicherung ${formatDistanceToNow(new Date(lastSuccess.finished_at), { addSuffix: true, locale: de })}`
                      : 'Es gibt noch keine gelungene Sicherung'}
                  </p>
                  <p>PN40 prüfen: eingeschaltet? Aufgabenplanung „Supabase-Sicherung Hausverwaltung“?</p>
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Letzte Sicherung</p>
                  <p className="text-sm text-muted-foreground">
                    {formatWhen(lastRun.finished_at)} ·{' '}
                    {formatDistanceToNow(new Date(lastRun.finished_at), { addSuffix: true, locale: de })}
                  </p>
                </div>
                <StatusBadge status={lastRun.status} />
              </div>

              {lastRun.status !== 'pausiert' && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Datenbank</dt>
                    <dd>
                      {formatBytes(lastRun.db_bytes)}
                      {lastRun.table_count !== null && ` · ${lastRun.table_count} Tabellen`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Dateien</dt>
                    <dd>
                      {lastRun.storage_skipped
                        ? 'keine (nur Datenbank)'
                        : lastRun.storage_files === null
                          ? '–'
                          : `${lastRun.storage_files} · ${formatBytes(lastRun.storage_bytes)}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Rechner</dt>
                    <dd>{lastRun.host ?? '–'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Uhrzeit</dt>
                    <dd>{lastRun.schedule_time ? `täglich ${lastRun.schedule_time}` : '–'}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Ordner im OneDrive</dt>
                    <dd className="break-all">
                      Backups\Supabase-Heizung\{lastRun.backup_folder ?? '–'}
                    </dd>
                  </div>
                </dl>
              )}

              <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                <a href="https://onedrive.live.com/" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Sicherungen im OneDrive öffnen
                </a>
              </Button>

              {lastRun.messages.length > 0 && (
                <ul className="space-y-1 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  {lastRun.messages.map((m, i) => (
                    <li key={i} className="break-words">• {m}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* ---------- Verlauf ---------- */}
            {runs.length > 1 && (
              <div className="space-y-2 rounded-lg border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Verlauf
                </p>
                <ul className="space-y-1.5">
                  {runs.slice(0, 7).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_STYLE[r.status].dot)} />
                        <span className="truncate">
                          {format(new Date(r.finished_at), 'EEEEEE dd.MM. HH:mm', { locale: de })}
                        </span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {r.status === 'erfolgreich' || r.status === 'warnungen'
                          ? formatBytes(r.db_bytes)
                          : BACKUP_STATUS_LABELS[r.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* ---------- Einstellungen ---------- */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Sicherung aktiv</Label>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'Der PN40 sichert jede Nacht.'
                  : 'Pausiert: Der PN40 sichert nichts, meldet aber „Pausiert“.'}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Sicherung aktiv" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="backup-retention" className="text-sm font-medium">
                Aufbewahren (Tage)
              </Label>
              <Input
                id="backup-retention"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="backup-warn" className="text-sm font-medium">
                Warnen nach (Stunden)
              </Label>
              <Input
                id="backup-warn"
                type="number"
                inputMode="numeric"
                min={12}
                max={168}
                value={warnAfterHours}
                onChange={(e) => setWarnAfterHours(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Änderungen wirken ab der nächsten Sicherung. Die Uhrzeit wird auf dem PN40 mit
            „Setup-SupabaseBackup.ps1“ geändert.
          </p>

          <Button onClick={handleSave} disabled={isSaving} className="w-full">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Speichern…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Einstellungen speichern
              </>
            )}
          </Button>
        </div>
    </div>
  );
}
