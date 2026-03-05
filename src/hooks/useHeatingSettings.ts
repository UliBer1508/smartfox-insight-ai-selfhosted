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
  // PV-Automatik Schwellwerte
  pv_surplus_threshold_on: 500,
  pv_surplus_threshold_off: 200,
  min_switch_interval_min: 5,
  // Fußbodenheizung
  floor_heating_response_hours: 2,
  estrich_storage_enabled: true,
  // E-Auto
  car_charging_enabled: false,
  car_min_charge_power_w: 1380,
  // Warmwasser
  hotwater_enabled: true,
  hotwater_power_w: 2800,
  hotwater_schedule_start: '10:00',
  hotwater_schedule_end: '16:00',
  hotwater_min_surplus_w: 1000,
  // Priorität
  consumer_priority: 'battery,hotwater,heating,car',
  // Heizungstyp-Information
  heating_type: 'direct_electric',
  total_heating_power_w: 5200,
  night_cycling_enabled: true,
  avg_night_cycles_per_room: 3,
  // Strompreise (Salzburg AG Defaults)
  electricity_price_kwh_cent: 20.28,
  electricity_base_fee_year_eur: 36.00,
  feed_in_price_kwh_cent: 8.00,
  // Nacht-Zeiten
  night_start_time: '22:00',
  night_end_time: '06:00',
  // Leistungsbudget-Management
  power_budget_enabled: true,
  max_grid_heating_power_w: 2000,
  power_budget_tolerance_w: 200,
  room_rotation_minutes: 30,
  min_room_pause_minutes: 15,
  // PV-Boost
  pv_boost_temp_delta: 2,
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
