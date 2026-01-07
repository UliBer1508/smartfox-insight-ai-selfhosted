import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { HeatingSettings } from '@/types/heating';
import { Room, getEffectiveHeatingPower } from '@/types/room';
import { Droplet, Flame, Car, LucideIcon } from 'lucide-react';

export interface ActiveConsumer {
  name: string;
  icon: LucideIcon;
  power: number;
  reason: string;
  color: string;
}

interface ConsumptionAnalysis {
  activeConsumers: ActiveConsumer[];
  totalExplainedPower: number;
  isLoading: boolean;
}

export function useConsumptionAnalysis(currentConsumption: number | null): ConsumptionAnalysis {
  const [heatingSettings, setHeatingSettings] = useState<HeatingSettings | null>(null);
  const [activeRooms, setActiveRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      
      // Load heating settings and active rooms in parallel
      const [settingsResult, roomsResult] = await Promise.all([
        supabase.from('heating_settings').select('*').limit(1).single(),
        supabase.from('rooms').select('*').eq('is_heating', true)
      ]);

      if (settingsResult.data) {
        setHeatingSettings(settingsResult.data as HeatingSettings);
      }
      
      if (roomsResult.data) {
        setActiveRooms(roomsResult.data as Room[]);
      }
      
      setIsLoading(false);
    };

    loadData();

    // Subscribe to room changes for real-time updates
    const channel = supabase
      .channel('consumption-analysis')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeConsumers = useMemo(() => {
    const consumers: ActiveConsumer[] = [];
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Check hot water schedule
    if (heatingSettings?.hotwater_enabled) {
      const start = heatingSettings.hotwater_schedule_start || '10:00';
      const end = heatingSettings.hotwater_schedule_end || '16:00';
      
      if (currentTime >= start && currentTime <= end) {
        const hotwaterPower = heatingSettings.hotwater_power_w || 2800;
        consumers.push({
          name: 'Warmwasser',
          icon: Droplet,
          power: hotwaterPower,
          reason: `Zeitplan ${start}–${end}`,
          color: '#3B82F6'
        });
      }
    }

    // Check active heating rooms - Jeder Raum einzeln anzeigen
    activeRooms.forEach(room => {
      const power = getEffectiveHeatingPower(room);
      consumers.push({
        name: room.name,
        icon: Flame,
        power: power,
        reason: 'Heizung aktiv',
        color: '#F97316'
      });
    });

    // Check car charging (if enabled and likely active based on consumption)
    if (heatingSettings?.car_charging_enabled && currentConsumption && currentConsumption > 3000) {
      const minCarPower = heatingSettings.car_min_charge_power_w || 1380;
      // Only suggest car charging if consumption is significantly higher than other consumers
      const explainedByOthers = consumers.reduce((sum, c) => sum + c.power, 0);
      const unexplained = currentConsumption - explainedByOthers;
      
      if (unexplained >= minCarPower) {
        consumers.push({
          name: 'E-Auto',
          icon: Car,
          power: minCarPower,
          reason: 'Laden erkannt',
          color: '#22C55E'
        });
      }
    }

    return consumers;
  }, [heatingSettings, activeRooms, currentConsumption]);

  const totalExplainedPower = useMemo(() => {
    return activeConsumers.reduce((sum, c) => sum + c.power, 0);
  }, [activeConsumers]);

  return {
    activeConsumers,
    totalExplainedPower,
    isLoading
  };
}
