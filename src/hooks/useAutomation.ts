import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Slim automation hook.
 *
 * Historisch rief dieser Hook die Edge Function `apply-recommendations` auf
 * (toggle / apply / status). Seit `pv-automation` alleinige Setpoint-Autorität
 * ist und der KI-Autopilot Parameter automatisch übernimmt, gibt es weder
 * den Apply-Button noch die Status-Abfrage im UI. Nur der per-Raum
 * Automatik-Schalter (Thermostat-Karte) bleibt – der wird hier direkt
 * gegen die `rooms`-Tabelle geschrieben.
 */
export function useAutomation() {
  const toggleAutomation = useCallback(
    async (roomId: string, enabled: boolean): Promise<boolean> => {
      try {
        const { error } = await supabase
          .from('rooms')
          .update({ automation_enabled: enabled })
          .eq('id', roomId);

        if (error) throw error;

        toast.success(enabled ? 'Automatik aktiviert' : 'Automatik deaktiviert');
        return true;
      } catch (error) {
        console.error('Error toggling automation:', error);
        toast.error('Fehler beim Umschalten der Automatik');
        return false;
      }
    },
    [],
  );

  return { toggleAutomation };
}
