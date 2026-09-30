// Reine Helfer fuer die Anzeige der naechtlichen Datensicherung
// (Einstellungen -> "Datensicherung", BackupSettingsSection.tsx).
// Datenquelle: Tabelle backup_runs (supabase/SQL/01_datensicherung.sql),
// geschrieben vom Skript Backup-Supabase.ps1 auf dem PN40.
// Gleiche Datei wie in der Hausverwaltung (src/lib/backupStatus.ts).

export type BackupRunStatus = 'erfolgreich' | 'warnungen' | 'fehlgeschlagen' | 'pausiert';

export interface BackupRun {
  id: string;
  started_at: string;
  finished_at: string;
  status: BackupRunStatus;
  host: string | null;
  backup_folder: string | null;
  db_bytes: number | null;
  table_count: number | null;
  storage_files: number | null;
  storage_bytes: number | null;
  storage_skipped: boolean;
  deleted_old: number;
  retention_days: number | null;
  schedule_time: string | null;
  messages: string[];
  script_version: string | null;
}

// Gleicher Wortlaut wie in LETZTE-SICHERUNG.txt auf dem PC (Designregel:
// ein Zustand, ein Text - ueberall).
export const BACKUP_STATUS_LABELS: Record<BackupRunStatus, string> = {
  erfolgreich: 'Erfolgreich',
  warnungen: 'Mit Warnungen',
  fehlgeschlagen: 'Fehlgeschlagen',
  pausiert: 'Pausiert',
};

/** Bytes lesbar in deutscher Schreibweise: 4,7 MB / 820 KB / 12 Bytes. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–';
  if (bytes < 1024) return `${bytes} Bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}

/** Letzter Lauf, bei dem die Datenbank wirklich gesichert wurde (auch mit Warnungen). */
export function findLastSuccessfulRun(runs: BackupRun[]): BackupRun | null {
  return runs.find((r) => r.status === 'erfolgreich' || r.status === 'warnungen') ?? null;
}

/**
 * Ist die letzte gelungene Sicherung zu alt?
 * `runs` muss nach finished_at absteigend sortiert sein (wie die Abfrage liefert).
 * Ohne jede gelungene Sicherung gilt: ueberfaellig.
 */
export function isBackupOverdue(runs: BackupRun[], warnAfterHours: number, now: Date = new Date()): boolean {
  const last = findLastSuccessfulRun(runs);
  if (!last) return true;
  const ageHours = (now.getTime() - new Date(last.finished_at).getTime()) / 36e5;
  return ageHours > warnAfterHours;
}
