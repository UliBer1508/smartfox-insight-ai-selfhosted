import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type TuyaControlMode = 'cloud' | 'local';

export function useTuyaControlMode() {
  const [mode, setModeState] = useState<TuyaControlMode>('cloud');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMode = async () => {
      try {
        const { data, error } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'tuya_control_mode')
          .maybeSingle();

        if (error) throw error;
        if (data?.value && typeof data.value === 'object' && 'mode' in data.value) {
          setModeState((data.value as { mode: TuyaControlMode }).mode);
        }
      } catch (err) {
        console.error('Error fetching tuya control mode:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMode();
  }, []);

  const setMode = useCallback(async (newMode: TuyaControlMode) => {
    try {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();

      if (existing) {
        await supabase
          .from('system_settings')
          .update({ value: { mode: newMode } as unknown as import('@/integrations/supabase/types').Json })
          .eq('key', 'tuya_control_mode');
      } else {
        await supabase
          .from('system_settings')
          .insert({ key: 'tuya_control_mode', value: { mode: newMode } as unknown as import('@/integrations/supabase/types').Json });
      }

      setModeState(newMode);
      toast.success(`Steuerungsmodus: ${newMode === 'cloud' ? 'Cloud API' : 'Lokaler Service'}`);
    } catch (err) {
      console.error('Error setting tuya control mode:', err);
      toast.error('Fehler beim Speichern des Steuerungsmodus');
    }
  }, []);

  return { mode, setMode, isLoading };
}
