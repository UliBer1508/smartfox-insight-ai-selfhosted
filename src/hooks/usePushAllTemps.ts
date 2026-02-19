import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function usePushAllTemps() {
  const [isPushing, setIsPushing] = useState(false);

  const pushAllTemps = async () => {
    setIsPushing(true);
    try {
      const { data, error } = await supabase.functions.invoke('tuya-control/push-all-temps', {
        method: 'POST',
      });

      if (error) throw error;

      if (data?.success) {
        const { successCount, totalCount } = data;
        if (successCount === totalCount) {
          toast.success(`${successCount}/${totalCount} Thermostate aktualisiert`);
        } else {
          toast.warning(`${successCount}/${totalCount} Thermostate aktualisiert – ${totalCount - successCount} fehlgeschlagen`);
        }
      } else {
        toast.error(data?.error || 'Fehler beim Senden der Temperaturen');
      }

      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Fehler: ${message}`);
      return null;
    } finally {
      setIsPushing(false);
    }
  };

  return { pushAllTemps, isPushing };
}
