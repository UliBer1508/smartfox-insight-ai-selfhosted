import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BackupRun } from '@/lib/backupStatus';

// ============================================================
// useBackupRuns — Protokoll der naechtlichen Datensicherung
// ============================================================
//
// Liest die letzten Laeufe aus `backup_runs` (supabase/SQL/01_datensicherung.sql).
// Geschrieben wird die Tabelle NUR vom Skript Backup-Supabase.ps1 auf dem PN40
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

const useBackupRuns = (limit = 10) => {
  return useQuery({
    queryKey: [...BACKUP_RUNS_QUERY_KEY, limit],
    queryFn: async (): Promise<BackupRun[]> => {
      const { data, error } = await table()
        .select(
          'id, started_at, finished_at, status, host, backup_folder, db_bytes, table_count, ' +
            'storage_files, storage_bytes, storage_skipped, deleted_old, retention_days, ' +
            'schedule_time, messages, script_version'
        )
        .order('finished_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as BackupRun[]) ?? [];
    },
    refetchInterval: 1000 * 60 * 5,
    retry: (count, error) => !isMissingTableError(error) && count < 2,
  });
};

export default useBackupRuns;
