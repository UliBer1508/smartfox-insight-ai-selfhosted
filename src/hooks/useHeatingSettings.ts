import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { HeatingSettings } from '@/types/heating';
import { toast } from 'sonner';

const defaultSettings: HeatingSettings = {
  pv_capacity_kwp: 15.8,
  battery_capacity_kwh: 13.8,
  min_battery_soc: 20,
  target_battery_soc: 80,
  comfort_temp: 21,
  eco_temp: 19,
  night_temp: 18,
  preheat_hours: 2,
};

export function useHeatingSettings() {
  const [settings, setSettings] = useState<HeatingSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('heating_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setSettings(data as HeatingSettings);
      }
    } catch (error) {
      console.error('Error loading heating settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (newSettings: Partial<HeatingSettings>) => {
    try {
      const updatedSettings = { ...settings, ...newSettings, updated_at: new Date().toISOString() };
      
      if (settings.id) {
        const { error } = await supabase
          .from('heating_settings')
          .update(updatedSettings)
          .eq('id', settings.id);
        
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('heating_settings')
          .insert(updatedSettings)
          .select()
          .single();
        
        if (error) throw error;
        updatedSettings.id = data.id;
      }
      
      setSettings(updatedSettings as HeatingSettings);
      toast.success('Heizungs-Einstellungen gespeichert');
    } catch (error) {
      console.error('Error saving heating settings:', error);
      toast.error('Fehler beim Speichern');
    }
  }, [settings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return { settings, saveSettings, isLoading };
}
