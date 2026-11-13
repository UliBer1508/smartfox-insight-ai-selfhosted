import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BackupRun, BackupStandby } from '@/lib/backupStatus';

// ============================================================
// useBackupRuns — Protokoll der naechtlichen Datensicherung
// ============================================================
//
// Liest die letzten Laeufe aus `backup_runs` (supabase/SQL/01_datensicherung.sql).
// Geschrieben wird die Tabelle NUR vom Skript Backup-Supabase.ps1 (PC München, PC Österreich als Ersatz)
// (direkte DB-Verbindung), die App liest nur.
// Anzeige: Einstellungen -> Datensicherung (BackupSettingsSection.tsx).
//
// Die Tabelle ist neu und steht noch nicht in den generierten Supabase-Typen,
// daher der lokal eng typisierte Zugriff.

export const BACKUP_RUNS_QUERY_KEY = ['backup-runs'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tabelle fehlt in types.ts
const table = () => (supabase as any).from('backup_runs');

/** true, wenn der Fehler bedeutet: SQL 01_datensicherung wurde noch nicht ausgefuehrt. */
export function isMissingTableError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.code === '42P01' ||
    e.code === 'PGRST205' ||
    (/backup_runs/.test(e.message ?? '') && /(does not exist|could not find)/i.test(e.message ?? ''))
  );
}

/** limit = höchstens so viele Läufe; tage = nur Läufe der letzten N Tage (optional). */
const useBackupRuns = (limit = 10, tage?: number) => {
  return useQuery({
    queryKey: [...BACKUP_RUNS_QUERY_KEY, limit, tage ?? null],
    queryFn: async (): Promise<BackupRun[]> => {
      let q = table()
        .select(
          'id, started_at, finished_at, status, host, backup_folder, db_bytes, table_count, ' +
            'storage_files, storage_bytes, storage_skipped, deleted_old, retention_days, ' +
            'schedule_time, messages, script_version'
        )
        .order('finished_at', { ascending: false })
        .limit(limit);
      if (tage) q = q.gte('finished_at', new Date(Date.now() - tage * 864e5).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return (data as BackupRun[]) ?? [];
    },
    refetchInterval: 1000 * 60 * 5,
    retry: (count, error) => !isMissingTableError(error) && count < 2,
  });
};

export default useBackupRuns;

/**
 * Lebenszeichen des Ersatz-PCs (PC Österreich) aus system_settings.backup_standby.
 * Schreibt das Skript Backup-Supabase.ps1 (v5) jedes Mal, wenn es übersprungen
 * oder eingesprungen ist. null = kein Ersatz eingerichtet.
 */
export const useBackupStandby = () =>
  useQuery({
    queryKey: ['backup-standby'],
    queryFn: async (): Promise<BackupStandby | null> => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'backup_standby')
        .maybeSingle();
      if (error) throw error;
      return (data?.value as unknown as BackupStandby) ?? null;
    },
    refetchInterval: 1000 * 60 * 5,
  });
