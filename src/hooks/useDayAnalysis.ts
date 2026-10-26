// Lädt einen Wiener Kalendertag und rechnet ihn mit analyzeDay durch (Stand 26.10.2026).
// PostgREST liefert höchstens 1000 Zeilen je Abfrage – daher seitenweise (siehe Learnings).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Room } from '@/types/room';
import { addDays, analyzeDay, DayAnalysis, ReadingRow, SampleRow, viennaDayStart } from '@/lib/dayAnalysis';

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function useDayAnalysis(date: string, rooms: Room[], nightStart?: string, nightEnd?: string) {
  const [data, setData] = useState<DayAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (rooms.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const from = viennaDayStart(date).toISOString();
      const to = viennaDayStart(addDays(date, 1)).toISOString();
      const [readings, samples, fc] = await Promise.all([
        fetchAll<ReadingRow>((a, b) => supabase.from('energy_readings')
          .select('timestamp, pv_power, consumption, power_io, battery_power, battery_soc')
          .gte('timestamp', from).lt('timestamp', to).order('timestamp', { ascending: true }).range(a, b) as never),
        fetchAll<SampleRow>((a, b) => supabase.from('room_temperature_samples')
          .select('room_id, timestamp, temperature, is_heating')
          .gte('timestamp', from).lt('timestamp', to).order('timestamp', { ascending: true }).range(a, b) as never),
        supabase.from('pv_forecasts').select('expected_kwh, hourly_watts').eq('date', date).maybeSingle(),
      ]);
      setData(analyzeDay({
        date, readings, samples, rooms, nightStart, nightEnd,
        forecastKwh: fc.data?.expected_kwh != null ? Number(fc.data.expected_kwh) : null,
        forecastHourly: (fc.data?.hourly_watts as Record<string, number> | null) ?? null,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [date, rooms, nightStart, nightEnd]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
