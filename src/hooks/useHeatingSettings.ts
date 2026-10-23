import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { HeatingSettings } from '@/types/heating';
import { toast } from 'sonner';
import { cleanPatch, findConflicts } from '@/lib/safeSave';

const defaultSettings: HeatingSettings = {
  pv_capacity_kwp: 15.8,
  battery_capacity_kwh: 13.8,
  comfort_temp: 21,
  eco_temp: 19,
  night_temp: 18,
  preheat_hours: 2,
  // PV-Automatik Schwellwerte
  pv_surplus_threshold_on: 500,
  pv_surplus_threshold_off: 200,
  min_switch_interval_min: 25, // = DEFAULT_MIN_SWITCH_INTERVAL_MIN in pv-automation
  // Fußbodenheizung
  floor_heating_response_hours: 0, // = Code-Default in pv-automation
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
  night_end_time: '08:00', // = Code-Default in pv-automation
  // Leistungsbudget-Management
  power_budget_enabled: true,
  max_grid_heating_power_w: 2000,
  power_budget_tolerance_w: 200,
  room_rotation_minutes: 30,
  min_room_pause_minutes: 15,
  // PV-Boost
  pv_boost_temp_delta: 2,
  // Nacht-Heizmodus
  night_heating_mode: 'frost_only' as const,
  // Mikro-Budget Modus
  micro_budget_enabled: true,
  micro_budget_min_battery_soc: 80,
  micro_heat_duration_min: 5,
  // Batterie-Reserve
  battery_reserve_for_night_soc: 60,
  battery_buffer_enabled: true,
  battery_buffer_bonus_w: 500,
  tolerant_deactivation_enabled: true,
  // Hartes SOC-Gate
  heating_min_battery_soc: 80,
  heating_soc_gate_mode: 'strict',
  // Analyse-Automatik
  analysis_daily_enabled: true,
  analysis_daily_time: '03:30',
  analysis_weekly_enabled: true,
  analysis_weekly_weekday: 0,
  analysis_weekly_time: '04:00',
  analysis_monthly_enabled: true,
  analysis_monthly_dom: 1,
  analysis_monthly_time: '04:30',
  analysis_match_today_enabled: true,
  analysis_match_today_time: '05:30',
  pattern_recall_strength: 50,
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
        // Einmalige Migration: wenn heating_min_battery_soc null und
        // battery_reserve_for_night_soc gesetzt → übernehmen (höheren Wert bevorzugen).
        const row = data as HeatingSettings;
        const needsMigration =
          (row.heating_min_battery_soc == null) &&
          row.battery_reserve_for_night_soc != null;
        if (needsMigration && row.id) {
          const startValue = row.battery_reserve_for_night_soc!;
          try {
            await supabase
              .from('heating_settings')
              .update({ heating_min_battery_soc: startValue })
              .eq('id', row.id);
            row.heating_min_battery_soc = startValue;
            console.log(`[useHeatingSettings] Migration: heating_min_battery_soc ← battery_reserve_for_night_soc (${startValue}%)`);
          } catch (e) {
            console.warn('[useHeatingSettings] Migration fehlgeschlagen:', e);
          }
        }
        setSettings(row);
      }
    } catch (error) {
      console.error('Error loading heating settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Speichert NUR die übergebenen Felder (seit 23.10.2026).
   * Früher wurde die komplette Zeile aus dem Stand beim Laden zurückgeschrieben – das hat
   * Änderungen von KI-Autopilot, Batterie-Vorschlag, KI-Rückabwicklung und Preisverlauf
   * still rückgängig gemacht. Vor dem Schreiben wird geprüft, ob genau diese Felder
   * inzwischen von anderer Stelle geändert wurden; dann wird nicht gespeichert.
   */
  const saveSettings = useCallback(async (newSettings: Partial<HeatingSettings>): Promise<boolean> => {
    try {
      const patch = cleanPatch(newSettings as Record<string, unknown>) as Partial<HeatingSettings>;
      // Konsolidierung: battery_reserve_for_night_soc spiegelt heating_min_battery_soc (Backwards-Compat für Edge Functions)
      if (patch.heating_min_battery_soc !== undefined) {
        patch.battery_reserve_for_night_soc = patch.heating_min_battery_soc;
      }
      const keys = Object.keys(patch);
      if (keys.length === 0) return true;

      if (!settings.id) {
        // Noch keine Zeile vorhanden (nur direkt nach einer Migration) → einmalig komplett anlegen
        const { data, error } = await supabase
          .from('heating_settings')
          .insert({ ...cleanPatch(settings as unknown as Record<string, unknown>), ...patch })
          .select()
          .single();
        if (error) throw error;
        setSettings(data as HeatingSettings);
        toast.success('Heizungs-Einstellungen gespeichert');
        return true;
      }

      // Konfliktprüfung: aktuellen DB-Stand genau dieser Felder holen
      const checkKeys = keys.filter((k) => k !== 'battery_reserve_for_night_soc');
      const { data: fresh, error: freshErr } = await supabase
        .from('heating_settings')
        .select(checkKeys.join(','))
        .eq('id', settings.id)
        .single();
      if (freshErr) throw freshErr;
      const conflicts = findConflicts(
        checkKeys,
        settings as unknown as Record<string, unknown>,
        fresh as unknown as Record<string, unknown>,
        patch as Record<string, unknown>,
      );
      if (conflicts.length > 0) {
        toast.error(
          `Nicht gespeichert: ${conflicts.join(', ')} wurde inzwischen an anderer Stelle geändert. ` +
          'Die Werte wurden neu geladen – bitte prüfen und erneut speichern.',
          { duration: 10000 },
        );
        await loadSettings();
        return false;
      }

      const { error } = await supabase
        .from('heating_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', settings.id);
      if (error) throw error;

      setSettings((prev) => ({ ...prev, ...patch }));
      toast.success('Heizungs-Einstellungen gespeichert');
      return true;
    } catch (error) {
      console.error('Error saving heating settings:', error);
      toast.error('Fehler beim Speichern');
      return false;
    }
  }, [settings, loadSettings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return { settings, saveSettings, isLoading, reload: loadSettings };
}
