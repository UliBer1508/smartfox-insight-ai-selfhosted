import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { HeatingSettings } from '@/types/heating';
import { Room, getEffectiveHeatingPower } from '@/types/room';
import { Droplet, Flame, HelpCircle, LucideIcon } from 'lucide-react';
import { getViennaTimeString } from '@/lib/dateUtils';

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
    // Explizit Wiener Zeit verwenden
    const currentTime = getViennaTimeString();

    // 1. Erst alle Heizungsräume erfassen
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

    // Berechne bereits erklärten Verbrauch (Heizung)
    const explainedByHeating = consumers.reduce((sum, c) => sum + c.power, 0);

    // 2. Warmwasser - berechnet als Differenz (geschätzt)
    if (heatingSettings?.hotwater_enabled && currentConsumption) {
      const start = heatingSettings.hotwater_schedule_start || '10:00';
      const end = heatingSettings.hotwater_schedule_end || '16:00';
      const minHotwaterPower = heatingSettings.hotwater_min_surplus_w || 1000;
      
      const unexplained = currentConsumption - explainedByHeating;
      
      // Nur anzeigen wenn im Zeitplan UND Mindestleistung erreicht
      if (currentTime >= start && currentTime <= end && unexplained >= minHotwaterPower) {
        consumers.push({
          name: 'Warmwasser',
          icon: Droplet,
          power: unexplained,  // Berechnete Differenz statt statischem Wert
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
