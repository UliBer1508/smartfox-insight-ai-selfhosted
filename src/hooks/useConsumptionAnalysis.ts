import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { HeatingSettings } from '@/types/heating';
import { Droplet, Flame, HelpCircle, LucideIcon } from 'lucide-react';
import { getViennaTimeString } from '@/lib/dateUtils';
import { useActiveHeatingRooms, ActiveHeatingRoom } from './useActiveHeatingRooms';

export interface ActiveConsumer {
  name: string;
  icon: LucideIcon;
  power: number;
  reason: string;
  color: string;
  details?: {
    rooms: {
      room_id: string;
      room_name: string;
      power: number;
      duration_min: number;
    }[];
  };
}

interface ConsumptionAnalysis {
  activeConsumers: ActiveConsumer[];
  totalExplainedPower: number;
  isLoading: boolean;
}

export function useConsumptionAnalysis(currentConsumption: number | null): ConsumptionAnalysis {
  const [heatingSettings, setHeatingSettings] = useState<HeatingSettings | null>(null);
  const { activeRooms, totalHeatingPower, isLoading: roomsLoading } = useActiveHeatingRooms();
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true);
      
      const settingsResult = await supabase
        .from('heating_settings')
        .select('*')
        .limit(1)
        .single();

      if (settingsResult.data) {
        setHeatingSettings(settingsResult.data as HeatingSettings);
      }
      
      setSettingsLoading(false);
    };

    loadSettings();
  }, []);

  const isLoading = roomsLoading || settingsLoading;

  const activeConsumers = useMemo(() => {
    const consumers: ActiveConsumer[] = [];
    const currentTime = getViennaTimeString();

    // 1. Heizung als aggregierter Verbraucher mit Raumdetails
    if (activeRooms.length > 0) {
      consumers.push({
        name: activeRooms.length === 1 ? activeRooms[0].room_name : 'Heizung',
        icon: Flame,
        power: totalHeatingPower,
        reason: activeRooms.length === 1 ? 'Heizung aktiv' : `${activeRooms.length} Räume`,
        color: '#F97316',
        details: activeRooms.length > 1 ? {
          rooms: activeRooms.map(room => ({
            room_id: room.room_id,
            room_name: room.room_name,
            power: room.power,
            duration_min: room.duration_min
          }))
        } : undefined
      });
    }

    // 2. Warmwasser - berechnet als Differenz (geschätzt)
    if (heatingSettings?.hotwater_enabled && currentConsumption) {
      const start = heatingSettings.hotwater_schedule_start || '10:00';
      const end = heatingSettings.hotwater_schedule_end || '16:00';
      const boilerPower = heatingSettings.hotwater_power_w || 2800;
      const minDetectionPower = boilerPower * 0.7; // Mindestens 70% der Boilerleistung
      
      const unexplained = currentConsumption - totalHeatingPower;
      
      // Nur anzeigen wenn im Zeitplan UND >= 70% der erwarteten Boilerleistung
      if (currentTime >= start && currentTime <= end && unexplained >= minDetectionPower) {
        consumers.push({
          name: 'Warmwasser',
          icon: Droplet,
          power: unexplained,
          reason: '~geschätzt',
          color: '#3B82F6'
        });
      }
    }

    // 3. Sonstiger Verbrauch - zeigt unerklärten Verbrauch ehrlich an
    if (currentConsumption) {
      const explainedByOthers = consumers.reduce((sum, c) => sum + c.power, 0);
      const unexplained = currentConsumption - explainedByOthers;
      
      // Nur anzeigen wenn signifikanter unerklärter Verbrauch (>= 300W)
      if (unexplained >= 300) {
        consumers.push({
          name: 'Sonstiger Verbrauch',
          icon: HelpCircle,
          power: unexplained,
          reason: '~unbekannt',
          color: '#9CA3AF'
        });
      }
    }

    return consumers;
  }, [heatingSettings, activeRooms, totalHeatingPower, currentConsumption]);

  const totalExplainedPower = useMemo(() => {
    return activeConsumers.reduce((sum, c) => sum + c.power, 0);
  }, [activeConsumers]);

  return {
    activeConsumers,
    totalExplainedPower,
    isLoading
  };
}
