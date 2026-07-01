import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Eine Zeile aus pv_forecast_accuracy (Prognose vs. tatsächliche PV-Produktion).
// Gefüllt vom nächtlichen Job `record-pv-accuracy` (Cron 23:30 Wien).
export interface PvAccuracyRow {
  date: string;
  forecast_kwh: number | null;
  actual_kwh: number | null;
  abweichung_kwh: number | null;
  ratio: number | null;
  saison_monat: number | null;
  sig_weather: string | null;
  sig_pv_bucket: string | null;
  samples: number | null;
}

// Aufbereiteter Punkt für das recharts-Diagramm.
export interface PvAccuracyPoint {
  date: string;        // ISO (YYYY-MM-DD) — für Sortierung/Key
  label: string;       // kurzes Anzeige-Datum (z. B. "01.07.")
  prognose: number | null;
  ist: number | null;
  ratio: number | null;
}

/**
 * Lädt die Prognose-vs-Ist-Reihe aus pv_forecast_accuracy.
 * Vorbild: useSolarGainChart (TanStack Query + Supabase-Client).
 *
 * @param days Anzahl Tage rückwärts (Default 30).
 */
export function usePvAccuracy(days: number = 30) {
  return useQuery({
    queryKey: ['pv-accuracy', days],
    queryFn: async () => {
      // Startdatum = heute - (days-1), als YYYY-MM-DD
      const start = new Date();
      start.setDate(start.getDate() - (days - 1));
      const startStr = start.toLocaleDateString('en-CA'); // YYYY-MM-DD

      const { data, error } = await supabase
        .from('pv_forecast_accuracy')
        .select('*')
        .gte('date', startStr)
        .order('date', { ascending: true });

      if (error) throw error;

      const rows = (data || []) as PvAccuracyRow[];

      const chartData: PvAccuracyPoint[] = rows.map((r) => {
        // "2026-07-01" -> "01.07."
        const [, m, d] = r.date.split('-');
        return {
          date: r.date,
          label: `${d}.${m}.`,
          prognose: r.forecast_kwh,
          ist: r.actual_kwh,
          ratio: r.ratio,
        };
      });

      // Kennzahlen für die Fußzeile
      const withRatio = rows.filter((r) => r.ratio != null) as Array<PvAccuracyRow & { ratio: number }>;
      const avgRatio = withRatio.length
        ? withRatio.reduce((a, r) => a + r.ratio, 0) / withRatio.length
        : null;

      return {
        chartData,
        rowCount: rows.length,
        avgRatio,        // Durchschnittliches Ist/Prognose-Verhältnis
      };
    },
    refetchInterval: 10 * 60 * 1000, // alle 10 Min (Daten ändern sich nur 1x/Nacht)
  });
}
