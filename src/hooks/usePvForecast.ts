import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PvForecast } from '@/types/heating';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/dateUtils';

export function usePvForecast() {
  const [forecasts, setForecasts] = useState<PvForecast[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const loadForecasts = useCallback(async () => {
    setIsLoading(true);
    try {
      // WICHTIG: Lokales Datum für korrekte Zeitzonen-Behandlung
      const today = getLocalDateString();
      const { data, error } = await supabase
        .from('pv_forecasts')
        .select('*')
        .gte('date', today)
        .order('date', { ascending: true })
        .limit(7);

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedData: PvForecast[] = (data || []).map(row => ({
        id: row.id,
        date: row.date,
        expected_kwh: Number(row.expected_kwh),
        hourly_watts: (row.hourly_watts as Record<string, number>) || {},
        sunrise: row.sunrise || undefined,
        sunset: row.sunset || undefined,
        fetched_at: row.fetched_at || undefined,
        created_at: row.created_at || undefined,
      }));
      
      setForecasts(transformedData);
    } catch (error) {
      console.error('Error loading forecasts:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchForecast = useCallback(async () => {
    setIsFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-pv-forecast');
      
      if (error) throw error;

      if (data?.fallback) {
        toast.warning(data.error || 'Prognose-Dienst aktuell nicht erreichbar');
        await loadForecasts();
        return data;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success(`PV-Prognose aktualisiert: ${data.forecasts?.length || 0} Tage`);
      await loadForecasts();
      return data;
    } catch (error: any) {
      console.error('Error fetching forecast:', error);
      toast.error(`Prognose-Fehler: ${error.message || 'Unbekannter Fehler'}`);
      throw error;
    } finally {
      setIsFetching(false);
    }
  }, [loadForecasts]);

  // WICHTIG: Lokales Datum für korrekte Zeitzonen-Behandlung
  const todayForecast = forecasts.find(f => f.date === getLocalDateString());
  const tomorrowForecast = forecasts.find(f => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return f.date === getLocalDateString(tomorrow);
  });

  return {
    forecasts,
    todayForecast,
    tomorrowForecast,
    isLoading,
    isFetching,
    loadForecasts,
    fetchForecast,
  };
}
