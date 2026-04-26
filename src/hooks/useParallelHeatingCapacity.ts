import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ParallelHeatingCapacity {
  computed_at: string;
  grid_export_w: number;
  baseload_buffer_w: number;
  trend_w_per_5min: number;
  trend_bonus_w: number;
  lookahead_bonus_w: number;
  lookahead_factor: "boost" | "neutral" | "cloud_warning";
  next_hour_forecast_w: number;
  eco_budget_w: number;
  comfort_budget_w: number;
  eco_candidates: Array<{ room_id: string; name: string; power_w: number }>;
  comfort_candidates: Array<{ room_id: string; name: string; power_w: number }>;
  max_parallel_eco: number;
  max_parallel_comfort: number;
  planned_eco_room_ids: string[];
  planned_comfort_room_ids: string[];
  budget_mode: string;
}

/**
 * Liest die zuletzt von der pv-automation Edge Function berechnete Parallel-Heiz-Planung
 * aus system_settings (Key: parallel_heating_capacity). Pollt alle 60 s.
 */
export function useParallelHeatingCapacity() {
  const [data, setData] = useState<ParallelHeatingCapacity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: row } = await supabase
        .from("system_settings")
        .select("value, updated_at")
        .eq("key", "parallel_heating_capacity")
        .maybeSingle();
      if (cancelled) return;
      setData((row?.value as unknown as ParallelHeatingCapacity) ?? null);
      setLoading(false);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { data, loading };
}
