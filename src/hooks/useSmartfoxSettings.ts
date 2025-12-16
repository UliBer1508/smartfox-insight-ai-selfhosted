import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SmartfoxSettings } from '@/types/energy';
import { toast } from 'sonner';

const DEFAULT_SETTINGS: SmartfoxSettings = {
  smartfox_ip: '192.168.1.100',
  polling_interval: 60,
  api_path: '/power',
  is_active: false,
  fronius_ip: '',
  fronius_is_active: false,
};

export function useSmartfoxSettings() {
  const [settings, setSettings] = useState<SmartfoxSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('smartfox_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setSettings(data as SmartfoxSettings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async (newSettings: Partial<SmartfoxSettings>) => {
    try {
      const updatedSettings = { ...settings, ...newSettings, updated_at: new Date().toISOString() };
      
      if (settings.id) {
        const { error } = await supabase
          .from('smartfox_settings')
          .update(updatedSettings)
          .eq('id', settings.id);
        
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('smartfox_settings')
          .insert(updatedSettings)
          .select()
          .single();
        
        if (error) throw error;
        updatedSettings.id = data.id;
      }
      
      setSettings(updatedSettings as SmartfoxSettings);
      toast.success('Einstellungen gespeichert');
      return true;
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Fehler beim Speichern');
      return false;
    }
  };

  return { settings, setSettings, saveSettings, isLoading, loadSettings };
}
