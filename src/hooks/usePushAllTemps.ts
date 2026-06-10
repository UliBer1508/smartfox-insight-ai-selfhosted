import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useControlMode } from './useControlMode';

export interface PushAllResult {
  success: boolean;
  successCount: number;
  totalCount: number;
  error?: string;
}

export function usePushAllTemps() {
  const [isPushing, setIsPushing] = useState(false);
  const { mode } = useControlMode();

  const pushAllTemps = async (): Promise<PushAllResult | null> => {
    setIsPushing(true);
    try {
      // LOKAL-MODUS: Befehle in thermostat_commands schreiben (LAN-Service holt sie ab).
      // Die Cloud-Edge-Function blockt im Local-Modus mit HTTP 403 → daher hier abzweigen.
      if (mode === 'local') {
        const { data: rooms, error: roomsError } = await supabase
          .from('rooms')
          .select('id, name, target_temp')
          .not('tuya_device_id', 'is', null)
          .not('target_temp', 'is', null);

        if (roomsError) throw roomsError;

        const targetRooms = rooms ?? [];
        if (targetRooms.length === 0) {
          toast.info('Keine Räume mit Thermostat konfiguriert');
          return { success: true, successCount: 0, totalCount: 0 };
        }

        const now = new Date().toISOString();
        const commands = targetRooms.map((r) => ({
          room_id: r.id,
          command: 'set_temp',
          value: r.target_temp as number,
          status: 'pending',
        }));

        const { error: insertError } = await supabase
          .from('thermostat_commands')
          .insert(commands);
        if (insertError) throw insertError;

        // last_thermostat_sync markieren, damit die UI den Push-Zeitpunkt zeigt
        await supabase
          .from('rooms')
          .update({ last_thermostat_sync: now })
          .in('id', targetRooms.map((r) => r.id));

        toast.success(`${targetRooms.length} Sollwerte an lokalen Service gesendet`);
        return { success: true, successCount: targetRooms.length, totalCount: targetRooms.length };
      }

      // CLOUD-MODUS: Edge Function aufrufen
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
        return { success: true, successCount, totalCount };
      }

      toast.error(data?.error || 'Fehler beim Senden der Temperaturen');
      return { success: false, successCount: 0, totalCount: data?.totalCount ?? 0, error: data?.error };
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
