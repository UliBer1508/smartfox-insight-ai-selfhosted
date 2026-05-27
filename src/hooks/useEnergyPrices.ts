import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PriceSuggestion {
  id: string;
  source: "salzburg_ag" | "oemag";
  field:
    | "electricity_price_cent"
    | "feed_in_price_cent"
    | "electricity_base_fee_year_eur";
  old_value: number | null;
  new_value: number;
  effective_date: string;
  status: "pending" | "applied" | "dismissed";
  raw_excerpt: string | null;
  fetched_at: string;
  created_at: string;
}

export interface PriceHistoryEntry {
  id: string;
  valid_from: string;
  valid_to: string | null;
  electricity_price_cent: number;
  feed_in_price_cent: number;
  electricity_base_fee_year_eur: number;
  source: string;
  note: string | null;
  created_at: string;
}

export function useEnergyPrices() {
  const [suggestions, setSuggestions] = useState<PriceSuggestion[]>([]);
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const [s, h] = await Promise.all([
      supabase
        .from("price_suggestions")
        .select("*")
        .order("fetched_at", { ascending: false })
        .limit(50),
      supabase
        .from("energy_price_history")
        .select("*")
        .order("valid_from", { ascending: false })
        .limit(50),
    ]);
    setSuggestions((s.data as PriceSuggestion[]) ?? []);
    setHistory((h.data as PriceHistoryEntry[]) ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const apply = useCallback(
    async (suggestion: PriceSuggestion) => {
      // Aktuell gültigen Eintrag lesen
      const today = new Date().toISOString().slice(0, 10);
      const { data: current } = await supabase
        .from("energy_price_history")
        .select("*")
        .lte("valid_from", today)
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle();

      const base = {
        electricity_price_cent: current?.electricity_price_cent ?? 0,
        feed_in_price_cent: current?.feed_in_price_cent ?? 0,
        electricity_base_fee_year_eur:
          current?.electricity_base_fee_year_eur ?? 0,
      };
      const next = { ...base, [suggestion.field]: suggestion.new_value };

      const effective =
        suggestion.effective_date > today ? suggestion.effective_date : today;

      // Neuen History-Eintrag — Trigger schließt vorherige Zeile
      const { error: insErr } = await supabase
        .from("energy_price_history")
        .insert({
          valid_from: effective,
          electricity_price_cent: next.electricity_price_cent,
          feed_in_price_cent: next.feed_in_price_cent,
          electricity_base_fee_year_eur: next.electricity_base_fee_year_eur,
          source:
            suggestion.source === "oemag" ? "oemag_auto" : "salzburg_ag_auto",
          note: `Übernommen aus Vorschlag (${suggestion.source})`,
        });
      if (insErr) throw insErr;

      // Mirror in heating_settings nur wenn ab heute gültig
      if (effective <= today) {
        const { data: hs } = await supabase
          .from("heating_settings")
          .select("id")
          .limit(1)
          .maybeSingle();
        if (hs) {
          await supabase
            .from("heating_settings")
            .update({
              electricity_price_kwh_cent: next.electricity_price_cent,
              feed_in_price_kwh_cent: next.feed_in_price_cent,
              electricity_base_fee_year_eur: next.electricity_base_fee_year_eur,
            })
            .eq("id", hs.id);
        }
      }

      await supabase
        .from("price_suggestions")
        .update({
          status: "applied",
          decided_at: new Date().toISOString(),
          decided_by: "user",
        })
        .eq("id", suggestion.id);

      await load();
    },
    [load],
  );

  const dismiss = useCallback(
    async (id: string) => {
      await supabase
        .from("price_suggestions")
        .update({
          status: "dismissed",
          decided_at: new Date().toISOString(),
          decided_by: "user",
        })
        .eq("id", id);
      await load();
    },
    [load],
  );

  const checkNow = useCallback(async () => {
    setIsChecking(true);
    try {
      await supabase.functions.invoke("fetch-energy-prices");
      await load();
    } finally {
      setIsChecking(false);
    }
  }, [load]);

  const addManual = useCallback(
    async (entry: {
      valid_from: string;
      electricity_price_cent: number;
      feed_in_price_cent: number;
      electricity_base_fee_year_eur: number;
      note?: string;
    }) => {
      const { error } = await supabase.from("energy_price_history").insert({
        ...entry,
        source: "manual",
      });
      if (error) throw error;

      // Mirror in heating_settings, wenn ab heute oder rückwirkend ohne neueren Eintrag
      const today = new Date().toISOString().slice(0, 10);
      if (entry.valid_from <= today) {
        const { data: hs } = await supabase
          .from("heating_settings")
          .select("id")
          .limit(1)
          .maybeSingle();
        if (hs) {
          await supabase
            .from("heating_settings")
            .update({
              electricity_price_kwh_cent: entry.electricity_price_cent,
              feed_in_price_kwh_cent: entry.feed_in_price_cent,
              electricity_base_fee_year_eur: entry.electricity_base_fee_year_eur,
            })
            .eq("id", hs.id);
        }
      }
      await load();
    },
    [load],
  );

  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  return {
    suggestions,
    pendingSuggestions,
    history,
    isLoading,
    isChecking,
    apply,
    dismiss,
    checkNow,
    addManual,
    reload: load,
  };
}
