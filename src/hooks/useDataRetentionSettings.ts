import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { DataRetentionSettings } from '@/types/dataRetention';

const defaultSettings: DataRetentionSettings = {
  polling_interval_seconds: 300,
  raw_data_retention_days: 7,
  hourly_retention_days: 90,
  auto_cleanup_enabled: true,
};

export const useDataRetentionSettings = () => {
  const [settings, setSettings] = useState<DataRetentionSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('data_retention_settings')
        .select('*')
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading data retention settings:', error);
        return;
      }

      if (data) {
        setSettings(data as DataRetentionSettings);
      }
    } catch (error) {
      console.error('Error loading data retention settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Speichert nur geänderte Felder (seit 23.10.2026), damit z. B. last_cleanup_at nicht mit
  // einem alten Stand überschrieben wird.
  const saveSettings = useCallback(async (changes: Partial<DataRetentionSettings>) => {
    try {
      const { id: _id, created_at: _c, updated_at: _u, ...patch } = changes as DataRetentionSettings & { created_at?: string; updated_at?: string };
      if (Object.keys(patch).length === 0) return;
      if (settings.id) {
        const { error } = await supabase
          .from('data_retention_settings')
          .update(patch)
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('data_retention_settings')
          .insert({ ...settings, ...patch });

        if (error) throw error;
      }

      setSettings((prev) => ({ ...prev, ...patch }));
      toast({
        title: 'Einstellungen gespeichert',
        description: 'Datenspeicherungs-Einstellungen wurden aktualisiert.',
      });
    } catch (error) {
      console.error('Error saving data retention settings:', error);
      toast({
        title: 'Fehler',
        description: 'Einstellungen konnten nicht gespeichert werden.',
        variant: 'destructive',
      });
    }
  }, [toast, settings]);

  const runCleanupNow = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('aggregate-energy-data');
      
      if (error) throw error;

      toast({
        title: 'Bereinigung gestartet',
        description: `${data?.rawDataProcessed ?? 0} Datensätze verarbeitet.`,
      });

      await loadSettings();
    } catch (error) {
      console.error('Error running cleanup:', error);
      toast({
        title: 'Fehler',
        description: 'Bereinigung konnte nicht gestartet werden.',
        variant: 'destructive',
      });
    }
  }, [toast, loadSettings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return { settings, saveSettings, isLoading, runCleanupNow };
};
