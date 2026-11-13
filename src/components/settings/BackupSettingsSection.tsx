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
import useBackupRuns, { isMissingTableError, useBackupStandby } from '@/hooks/useBackupRuns';
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from '@/hooks/useBackupSettings';
import {
  BACKUP_STATUS_LABELS,
  bewerteSicherung,
  ersatzUebersprungen,
  formatBytes,
  rechnerName,
  type BackupRunStatus,
} from '@/lib/backupStatus';

/**
 * Einstellungen -> Bereich "Datensicherung" (im Accordion von SettingsPanel.tsx)
 *
 * Zeigt, was die naechtliche Sicherung gemeldet hat - je PC (Tabelle
 * backup_runs, supabase/SQL/01_datensicherung.sql), und steuert sie ueber
 * system_settings.backup_settings. Gleiches Konzept wie die Karte
 * "Datensicherung" in der Hausverwaltung (BackupSettingsCard.tsx).
 * Das Skript Backup-Supabase.ps1 liest diese Einstellungen zu Beginn jedes
 * Laufs - Aenderungen wirken also ab der naechsten Sicherung.
 *
 * Die Uhrzeit ist hier NUR Anzeige: Sie steckt in der Windows-Aufgabenplanung
 * des jeweiligen PCs und wird dort mit Setup-SupabaseBackup.ps1 geaendert.
 *
 * Seit 13.11.2026 zwei PCs (wie Heizung München, Datensicherung.jsx):
 * PC München sichert jede Nacht, PC Österreich ist Ersatz und meldet sich
 * sonst nur mit einem Lebenszeichen in system_settings.backup_standby.
 * Helfer: bewerteSicherung() in lib/backupStatus.ts.
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
  const { data: runs = [], isLoading: runsLoading, error: runsError } = useBackupRuns(60, 14);
  const { data: standby } = useBackupStandby();
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
  const { rechner, neueste, rot, gelb } = bewerteSicherung(runs, standby ?? null, savedWarnHours);
  const overdue = savedEnabled && rot;
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
          : 'Die Sicherung ist pausiert. Die PCs melden nachts nur noch „Pausiert“.',
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
        Jede Nacht wird die komplette Heizungs-Datenbank (Venediger und München) ins OneDrive gesichert.
        Der PC München sichert, der PC Österreich springt nur ein, wenn München nicht gesichert hat.
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
        ) : rechner.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            In den letzten 14 Tagen wurde keine Sicherung gemeldet.
          </div>
        ) : (
          <>
            {overdue && (
              <div className="flex gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    {neueste
                      ? `Letzte gelungene Sicherung ${formatDistanceToNow(new Date(neueste.finished_at), { addSuffix: true, locale: de })}`
                      : 'In den letzten 14 Tagen gab es keine gelungene Sicherung'}
                  </p>
                  <p>Bitte die Sicherungs-PCs prüfen: eingeschaltet? Aufgabenplanung „Supabase-Sicherung Heizung“ gelaufen?</p>
                </div>
              </div>
            )}
            {savedEnabled && gelb.map((t, i) => (
              <div key={i} className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t}</p>
              </div>
            ))}

            {/* ---------- Stand je PC ---------- */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {rechner.map((r) => {
                const skip = ersatzUebersprungen(r);
                return (
                  <div key={r.host ?? '?'} className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{rechnerName(r.host)}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.ersatz ? 'Ersatz – sichert nur, wenn nötig' : 'sichert jede Nacht'}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">{r.host}</p>
                      </div>
                      {skip ? (
                        <Badge variant="outline" className="gap-1 border-slate-400 text-slate-600 dark:text-slate-300">
                          <PauseCircle className="h-3 w-3" />
                          Übersprungen
                        </Badge>
                      ) : r.letzter ? (
                        <StatusBadge status={r.letzter.status} />
                      ) : null}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">Letzter Lauf</dt>
                        <dd>
                          {skip && r.beat
                            ? `${formatWhen(r.beat.checked_at)} · ${rechnerName(r.beat.main_host)} hatte gesichert`
                            : r.letzter
                              ? `${formatWhen(r.letzter.finished_at)}${r.ersatz ? ' · eingesprungen' : ''}`
                              : '–'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Letzte gelungene</dt>
                        <dd>
                          {r.gelungen
                            ? formatDistanceToNow(new Date(r.gelungen.finished_at), { addSuffix: true, locale: de })
                            : '–'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Datenbank</dt>
                        <dd>
                          {r.gelungen
                            ? `${formatBytes(r.gelungen.db_bytes)}${r.gelungen.table_count !== null ? ` · ${r.gelungen.table_count} Tabellen` : ''}`
                            : '–'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Uhrzeit</dt>
                        <dd>{r.letzter?.schedule_time ? `täglich ${r.letzter.schedule_time}` : '–'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Ordner</dt>
                        <dd className="break-all">{r.gelungen?.backup_folder ?? '–'}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>

            {runs[0]?.messages.length > 0 && (
              <ul className="space-y-1 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {runs[0].messages.map((m, i) => (
                  <li key={i} className="break-words">• {m}</li>
                ))}
              </ul>
            )}

            <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
              <a href="https://onedrive.live.com/" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Sicherungen im OneDrive öffnen
              </a>
            </Button>

            {/* ---------- Verlauf: wer hat wann gesichert ---------- */}
            {runs.length > 0 && (
              <div className="space-y-2 rounded-lg border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Verlauf (letzte 14 Tage)
                </p>
                <ul className="space-y-1.5">
                  {runs.slice(0, 14).map((r) => (
                    <li key={r.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_STYLE[r.status].dot)} />
                        <span className="truncate">
                          {format(new Date(r.finished_at), 'EEEEEE dd.MM. HH:mm', { locale: de })}
                        </span>
                      </span>
                      <span className="text-muted-foreground">{rechnerName(r.host)}</span>
                      <span className="w-16 text-right text-muted-foreground">
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
                  ? 'PC München sichert jede Nacht, PC Österreich springt bei Bedarf ein.'
                  : 'Pausiert: Kein PC sichert, beide melden aber „Pausiert“.'}
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
            Gilt für beide PCs und auch für die München-App. Änderungen wirken ab der nächsten Sicherung.
            Die Uhrzeit wird auf dem jeweiligen PC mit „Setup-SupabaseBackup.ps1“ geändert.
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
