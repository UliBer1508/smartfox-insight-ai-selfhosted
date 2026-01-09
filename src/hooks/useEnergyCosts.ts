import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startOfMonth, startOfYear, format } from 'date-fns';
import { de } from 'date-fns/locale';

export type CostPeriod = 'day' | 'month' | 'year';

interface CostData {
  energyIn: number;
  energyOut: number;
  pvEnergy: number;
  selfConsumption: number;
  gridCost: number;
  feedInEarnings: number;
  pvSavings: number;
  netBalance: number;
}

interface EnergyCostsResult {
  costs: Record<CostPeriod, CostData>;
  isLoading: boolean;
  periodLabel: (period: CostPeriod) => string;
  saveTodayCosts: () => Promise<void>;
}

const emptyCost: CostData = {
  energyIn: 0,
  energyOut: 0,
  pvEnergy: 0,
  selfConsumption: 0,
  gridCost: 0,
  feedInEarnings: 0,
  pvSavings: 0,
  netBalance: 0,
};

export function useEnergyCosts(
  todayEnergyIn: number,
  todayEnergyOut: number,
  todayPvEnergy: number,
  electricityPriceCent: number,
  feedInPriceCent: number
): EnergyCostsResult {
  const [costs, setCosts] = useState<Record<CostPeriod, CostData>>({
    day: { ...emptyCost },
    month: { ...emptyCost },
    year: { ...emptyCost },
  });
  const [isLoading, setIsLoading] = useState(true);

  // Berechne aktuelle Tageskosten aus Props
  const calculateTodayCosts = useCallback((): CostData => {
    const selfConsumption = Math.max(0, todayPvEnergy - todayEnergyOut);
    const gridCost = (todayEnergyIn * electricityPriceCent) / 100;
    const feedInEarnings = (todayEnergyOut * feedInPriceCent) / 100;
    const pvSavings = (selfConsumption * electricityPriceCent) / 100;
    const netBalance = feedInEarnings + pvSavings - gridCost;

    return {
      energyIn: todayEnergyIn,
      energyOut: todayEnergyOut,
      pvEnergy: todayPvEnergy,
      selfConsumption,
      gridCost,
      feedInEarnings,
      pvSavings,
      netBalance,
    };
  }, [todayEnergyIn, todayEnergyOut, todayPvEnergy, electricityPriceCent, feedInPriceCent]);

  // Speichere aktuelle Tagesdaten
  const saveTodayCosts = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    const todayCosts = calculateTodayCosts();

    await supabase.from('energy_daily_costs').upsert({
      date: today,
      energy_in_kwh: todayCosts.energyIn,
      energy_out_kwh: todayCosts.energyOut,
      pv_energy_kwh: todayCosts.pvEnergy,
      self_consumption_kwh: todayCosts.selfConsumption,
      grid_cost_eur: todayCosts.gridCost,
      feed_in_earnings_eur: todayCosts.feedInEarnings,
      pv_savings_eur: todayCosts.pvSavings,
      net_balance_eur: todayCosts.netBalance,
      electricity_price_cent: electricityPriceCent,
      feed_in_price_cent: feedInPriceCent,
    }, { onConflict: 'date' });
  }, [calculateTodayCosts, electricityPriceCent, feedInPriceCent]);

  // Lade historische Daten
  const loadCosts = useCallback(async () => {
    setIsLoading(true);
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const monthStart = startOfMonth(today).toISOString().split('T')[0];
    const yearStart = startOfYear(today).toISOString().split('T')[0];

    const { data } = await supabase
      .from('energy_daily_costs')
      .select('*')
      .gte('date', yearStart)
      .order('date', { ascending: true });

    const todayCosts = calculateTodayCosts();

    // Aggregiere Monatsdaten (ohne heute, das kommt aus Props)
    const monthData = (data || [])
      .filter(d => d.date >= monthStart && d.date !== todayStr)
      .reduce((acc, d) => ({
        energyIn: acc.energyIn + Number(d.energy_in_kwh),
        energyOut: acc.energyOut + Number(d.energy_out_kwh),
        pvEnergy: acc.pvEnergy + Number(d.pv_energy_kwh),
        selfConsumption: acc.selfConsumption + Number(d.self_consumption_kwh),
        gridCost: acc.gridCost + Number(d.grid_cost_eur),
        feedInEarnings: acc.feedInEarnings + Number(d.feed_in_earnings_eur),
        pvSavings: acc.pvSavings + Number(d.pv_savings_eur),
        netBalance: acc.netBalance + Number(d.net_balance_eur),
      }), { ...emptyCost });

    // Aggregiere Jahresdaten (ohne heute)
    const yearData = (data || [])
      .filter(d => d.date !== todayStr)
      .reduce((acc, d) => ({
        energyIn: acc.energyIn + Number(d.energy_in_kwh),
        energyOut: acc.energyOut + Number(d.energy_out_kwh),
        pvEnergy: acc.pvEnergy + Number(d.pv_energy_kwh),
        selfConsumption: acc.selfConsumption + Number(d.self_consumption_kwh),
        gridCost: acc.gridCost + Number(d.grid_cost_eur),
        feedInEarnings: acc.feedInEarnings + Number(d.feed_in_earnings_eur),
        pvSavings: acc.pvSavings + Number(d.pv_savings_eur),
        netBalance: acc.netBalance + Number(d.net_balance_eur),
      }), { ...emptyCost });

    // Addiere heutige Werte
    setCosts({
      day: todayCosts,
      month: {
        energyIn: monthData.energyIn + todayCosts.energyIn,
        energyOut: monthData.energyOut + todayCosts.energyOut,
        pvEnergy: monthData.pvEnergy + todayCosts.pvEnergy,
        selfConsumption: monthData.selfConsumption + todayCosts.selfConsumption,
        gridCost: monthData.gridCost + todayCosts.gridCost,
        feedInEarnings: monthData.feedInEarnings + todayCosts.feedInEarnings,
        pvSavings: monthData.pvSavings + todayCosts.pvSavings,
        netBalance: monthData.netBalance + todayCosts.netBalance,
      },
      year: {
        energyIn: yearData.energyIn + todayCosts.energyIn,
        energyOut: yearData.energyOut + todayCosts.energyOut,
        pvEnergy: yearData.pvEnergy + todayCosts.pvEnergy,
        selfConsumption: yearData.selfConsumption + todayCosts.selfConsumption,
        gridCost: yearData.gridCost + todayCosts.gridCost,
        feedInEarnings: yearData.feedInEarnings + todayCosts.feedInEarnings,
        pvSavings: yearData.pvSavings + todayCosts.pvSavings,
        netBalance: yearData.netBalance + todayCosts.netBalance,
      },
    });

    setIsLoading(false);
  }, [calculateTodayCosts]);

  // Ref für Debounce der DB-Speicherung
  const lastSaveRef = useRef<number>(0);
  const SAVE_INTERVAL_MS = 5 * 60 * 1000; // Alle 5 Minuten speichern

  // Lade historische Daten beim Mount
  useEffect(() => {
    loadCosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aktualisiere Anzeige bei Änderungen der Tageswerte
  useEffect(() => {
    const todayCosts = calculateTodayCosts();
    setCosts(prev => ({
      ...prev,
      day: todayCosts,
      month: {
        ...prev.month,
        energyIn: prev.month.energyIn - prev.day.energyIn + todayCosts.energyIn,
        energyOut: prev.month.energyOut - prev.day.energyOut + todayCosts.energyOut,
        pvEnergy: prev.month.pvEnergy - prev.day.pvEnergy + todayCosts.pvEnergy,
        selfConsumption: prev.month.selfConsumption - prev.day.selfConsumption + todayCosts.selfConsumption,
        gridCost: prev.month.gridCost - prev.day.gridCost + todayCosts.gridCost,
        feedInEarnings: prev.month.feedInEarnings - prev.day.feedInEarnings + todayCosts.feedInEarnings,
        pvSavings: prev.month.pvSavings - prev.day.pvSavings + todayCosts.pvSavings,
        netBalance: prev.month.netBalance - prev.day.netBalance + todayCosts.netBalance,
      },
      year: {
        ...prev.year,
        energyIn: prev.year.energyIn - prev.day.energyIn + todayCosts.energyIn,
        energyOut: prev.year.energyOut - prev.day.energyOut + todayCosts.energyOut,
        pvEnergy: prev.year.pvEnergy - prev.day.pvEnergy + todayCosts.pvEnergy,
        selfConsumption: prev.year.selfConsumption - prev.day.selfConsumption + todayCosts.selfConsumption,
        gridCost: prev.year.gridCost - prev.day.gridCost + todayCosts.gridCost,
        feedInEarnings: prev.year.feedInEarnings - prev.day.feedInEarnings + todayCosts.feedInEarnings,
        pvSavings: prev.year.pvSavings - prev.day.pvSavings + todayCosts.pvSavings,
        netBalance: prev.year.netBalance - prev.day.netBalance + todayCosts.netBalance,
      },
    }));
  }, [todayEnergyIn, todayEnergyOut, todayPvEnergy, calculateTodayCosts]);

  // Speichere in DB mit Debounce (alle 5 Minuten)
  useEffect(() => {
    const now = Date.now();
    if (now - lastSaveRef.current >= SAVE_INTERVAL_MS) {
      if (todayEnergyIn > 0 || todayEnergyOut > 0 || todayPvEnergy > 0) {
        saveTodayCosts();
        lastSaveRef.current = now;
      }
    }
  }, [todayEnergyIn, todayEnergyOut, todayPvEnergy, saveTodayCosts]);

  const periodLabel = (period: CostPeriod): string => {
    const today = new Date();
    switch (period) {
      case 'day':
        return 'heute';
      case 'month':
        return format(today, 'MMMM', { locale: de });
      case 'year':
        return format(today, 'yyyy');
    }
  };

  return { costs, isLoading, periodLabel, saveTodayCosts };
}
