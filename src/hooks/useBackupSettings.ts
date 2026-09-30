import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ============================================================
// useBackupSettings — Einstellungen der naechtlichen Datensicherung
// ============================================================
//
// system_settings.backup_settings (angelegt von supabase/SQL/01_datensicherung.sql).
// Das Skript Backup-Supabase.ps1 auf dem PN40 liest diese Werte zu Beginn jedes
// Laufs; warn_after_hours nutzt nur die Anzeige.

export interface BackupSettings {
  enabled: boolean;          // false = Lauf wird als "pausiert" protokolliert, nichts gesichert
  retention_days: number;    // Sicherungen aelter als X Tage loescht das Skript
  include_storage: boolean;  // Heizung: aus (kein Dateispeicher im Projekt)
  warn_after_hours: number;  // Anzeige warnt, wenn die letzte gelungene Sicherung aelter ist
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  retention_days: 30,
  include_storage: false,
  warn_after_hours: 30,
};

const QUERY_KEY = ['system-settings', 'backup_settings'] as const;

export function useBackupSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<BackupSettings | null> => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'backup_settings')
        .maybeSingle();
      if (error) throw error;
      return ((data?.value as unknown as BackupSettings) ?? null);
    },
  });

  const mutation = useMutation({
    mutationFn: async (value: BackupSettings) => {
      // Mit .select() und Pruefung auf 0 Zeilen: sonst meldet ein RLS-Block
      // stillen Erfolg.
      const { data, error } = await supabase
        .from('system_settings')
        .upsert({ key: 'backup_settings', value: value as never }, { onConflict: 'key' })
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Einstellung wurde nicht gespeichert (0 Zeilen).');
      return value;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    saveSettings: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
