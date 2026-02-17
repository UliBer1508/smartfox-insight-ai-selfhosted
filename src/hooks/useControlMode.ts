import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ControlMode = 'cloud' | 'local';

export function useControlMode() {
  const queryClient = useQueryClient();

  const { data: mode = 'cloud', isLoading } = useQuery({
    queryKey: ['tuya-control-mode'],
    queryFn: async (): Promise<ControlMode> => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();

      if (error) throw error;
      return (data?.value as { mode?: ControlMode })?.mode || 'cloud';
    },
    staleTime: 30_000,
  });

  const { mutateAsync: setMode } = useMutation({
    mutationFn: async (newMode: ControlMode) => {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('system_settings')
          .update({ value: { mode: newMode } })
          .eq('key', 'tuya_control_mode');
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('system_settings')
          .insert({ key: 'tuya_control_mode', value: { mode: newMode } });
        if (error) throw error;
      }
    },
    onSuccess: (_, newMode) => {
      queryClient.invalidateQueries({ queryKey: ['tuya-control-mode'] });
      toast.success(
        newMode === 'cloud'
          ? 'Cloud API-Modus aktiviert'
          : 'Lokaler Service-Modus aktiviert'
      );
    },
    onError: (error) => {
      toast.error(`Fehler beim Umschalten: ${error.message}`);
    },
  });

  return { mode, setMode, isLoading };
}
