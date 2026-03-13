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
      const value = parseValue(suggestion.suggested_value);

      if (suggestion.category === 'room_temp' && suggestion.room_name) {
        // Update room-specific setting
        const { data: rooms } = await supabase.from('rooms').select('id, name');
        const room = rooms?.find(r => r.name === suggestion.room_name);
        if (!room) {
          toast.error(`Raum "${suggestion.room_name}" nicht gefunden`);
          return false;
        }
        const { error } = await supabase.from('rooms').update({ [suggestion.setting_key]: value }).eq('id', room.id);
        if (error) throw error;
      } else {
        // Update global heating_settings
        const { data: settings } = await supabase.from('heating_settings').select('id').limit(1).single();
        if (!settings) throw new Error('Keine Einstellungen gefunden');
        const { error } = await supabase.from('heating_settings').update({ [suggestion.setting_key]: value }).eq('id', settings.id);
        if (error) throw error;
      }

      // Mark as applied
      setSuggestions(prev => prev.map(s => 
        s === suggestion ? { ...s, applied: true } : s
      ));
      toast.success(`${suggestion.setting_key} auf ${suggestion.suggested_value} geändert`);
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
