import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SettingSuggestion {
  category: 'hotwater' | 'night_cycling' | 'global_temps' | 'pv_thresholds' | 'room_temp' | 'battery' | 'automation';
  setting_key: string;
  room_name?: string;
  current_value: string;
  suggested_value: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  applied?: boolean;
}

const GLOBAL_KEYS = new Set([
  'comfort_temp', 'eco_temp', 'night_temp', 'heating_min_battery_soc',
  'pv_surplus_threshold_on', 'pv_surplus_threshold_off', 'hotwater_min_surplus_w',
  'hotwater_schedule_start', 'hotwater_schedule_end', 'hotwater_enabled',
  'night_start_time', 'night_end_time', 'night_cycling_enabled', 'avg_night_cycles_per_room',
  'pv_boost_temp_delta', 'night_heating_mode', 'estrich_storage_enabled',
  'power_budget_enabled', 'max_grid_heating_power_w',
]);

const ROOM_KEYS = new Set([
  'comfort_temp', 'eco_temp', 'night_temp', 'pv_boost_max_temp', 'solar_limit_temp',
]);

const KEY_MAPPING: Record<string, string> = {
  soll_temp: 'target_temp',
  ziel_temp: 'target_temp',
  min_pv_surplus: 'hotwater_min_surplus_w',
  pv_threshold_on: 'pv_surplus_threshold_on',
  pv_threshold_off: 'pv_surplus_threshold_off',
  battery_min_soc: 'heating_min_battery_soc',
  battery_target_soc: 'heating_min_battery_soc',
  nacht_temp: 'night_temp',
  komfort_temp: 'comfort_temp',
};

function resolveKey(key: string, category: string): string | null {
  let resolved = KEY_MAPPING[key] || key;
  const whitelist = category === 'room_temp' ? ROOM_KEYS : GLOBAL_KEYS;
  if (whitelist.has(resolved)) return resolved;
  // target_temp is valid for rooms but not in the room whitelist above — allow it
  if (category === 'room_temp' && resolved === 'target_temp') return resolved;
  return null;
}

export function useSettingsSuggestions() {
  const [suggestions, setSuggestions] = useState<SettingSuggestion[]>([]);
  const [overallAnalysis, setOverallAnalysis] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-settings-suggestions');
      if (error) throw error;

      setSuggestions((data.suggestions || []).map((s: SettingSuggestion) => ({ ...s, applied: false })));
      setOverallAnalysis(data.overall_analysis || '');
      
      if (data.suggestions?.length === 0) {
        toast.info('Keine Verbesserungsvorschläge — alles sieht gut aus!');
      }
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
      toast.error('KI-Vorschläge konnten nicht geladen werden');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const applySuggestion = useCallback(async (suggestion: SettingSuggestion) => {
    try {
      const resolvedKey = resolveKey(suggestion.setting_key, suggestion.category);
      if (!resolvedKey) {
        toast.warning(`Unbekannte Einstellung "${suggestion.setting_key}" — wird übersprungen`);
        setSuggestions(prev => prev.map(s => s === suggestion ? { ...s, applied: false } : s));
        return false;
      }

      const value = parseValue(suggestion.suggested_value);

      if (suggestion.category === 'room_temp' && suggestion.room_name) {
        // Update room-specific setting
        const { data: rooms } = await supabase.from('rooms').select('id, name');
        const room = rooms?.find(r => r.name === suggestion.room_name);
        if (!room) {
          toast.error(`Raum "${suggestion.room_name}" nicht gefunden`);
          return false;
        }
        const { error } = await supabase.from('rooms').update({ [resolvedKey]: value }).eq('id', room.id);
        if (error) throw error;
      } else {
        // Update global heating_settings
        const { data: settings } = await supabase.from('heating_settings').select('id').limit(1).single();
        if (!settings) throw new Error('Keine Einstellungen gefunden');
        const { error } = await supabase.from('heating_settings').update({ [resolvedKey]: value }).eq('id', settings.id);
        if (error) throw error;
      }

      // Mark as applied
      setSuggestions(prev => prev.map(s => 
        s === suggestion ? { ...s, applied: true } : s
      ));
      toast.success(`${resolvedKey} auf ${suggestion.suggested_value} geändert`);
      return true;
    } catch (error) {
      console.error('Failed to apply suggestion:', error);
      toast.error('Einstellung konnte nicht übernommen werden');
      return false;
    }
  }, []);

  const applyAll = useCallback(async () => {
    const unapplied = suggestions.filter(s => !s.applied);
    let successCount = 0;
    for (const s of unapplied) {
      const ok = await applySuggestion(s);
      if (ok) successCount++;
    }
    if (successCount > 0) {
      toast.success(`${successCount} Einstellungen übernommen`);
    }
  }, [suggestions, applySuggestion]);

  return { suggestions, overallAnalysis, isLoading, fetchSuggestions, applySuggestion, applyAll };
}

function parseValue(val: string): number | string | boolean {
  if (val === 'true') return true;
  if (val === 'false') return false;
  const num = Number(val);
  if (!isNaN(num) && val.trim() !== '') return num;
  return val;
}
