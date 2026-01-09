import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LearningEvent {
  id: string;
  timestamp: string;
  decision_type: string;
  room_id: string | null;
  context: any;
  action: any;
  outcome: any;
  reward: number | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { event_id, evaluate_all } = await req.json();

    // Lade Heizungseinstellungen für Preisberechnung
    const { data: settings } = await supabase
      .from('heating_settings')
      .select('*')
      .limit(1)
      .single();

    const electricityPrice = settings?.electricity_price_kwh_cent || 20.28;
    const feedInPrice = settings?.feed_in_price_kwh_cent || 8.0;

    let eventsToEvaluate: LearningEvent[] = [];

    if (event_id) {
      // Einzelnes Event evaluieren
      const { data } = await supabase
        .from('learning_events')
        .select('*')
        .eq('id', event_id)
        .single();
      if (data) eventsToEvaluate = [data];
    } else if (evaluate_all) {
      // Alle nicht-evaluierten Events die mindestens 2 Stunden alt sind
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('learning_events')
        .select('*')
        .eq('is_evaluated', false)
        .lt('timestamp', twoHoursAgo)
        .order('timestamp', { ascending: true })
        .limit(50);
      eventsToEvaluate = data || [];
    }

    console.log(`Evaluating ${eventsToEvaluate.length} learning events`);

    const results = [];

    for (const event of eventsToEvaluate) {
      const evaluation = await evaluateEvent(supabase, event, electricityPrice, feedInPrice);
      
      // Update Event mit Ergebnis
      const { error } = await supabase
        .from('learning_events')
        .update({
          outcome: evaluation.outcome,
          reward: evaluation.reward,
          reward_breakdown: evaluation.breakdown,
          is_evaluated: true,
          evaluated_at: new Date().toISOString()
        })
        .eq('id', event.id);

      if (error) {
        console.error(`Error updating event ${event.id}:`, error);
      } else {
        console.log(`Evaluated event ${event.id}: reward=${evaluation.reward.toFixed(2)}`);
        results.push({ id: event.id, reward: evaluation.reward, breakdown: evaluation.breakdown });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      evaluated: results.length,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Evaluation error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function evaluateEvent(
  supabase: any,
  event: LearningEvent,
  electricityPrice: number,
  feedInPrice: number
): Promise<{ outcome: any; reward: number; breakdown: any }> {
  const eventTime = new Date(event.timestamp);
  const evaluationWindow = 2 * 60 * 60 * 1000; // 2 Stunden
  const endTime = new Date(eventTime.getTime() + evaluationWindow);

  // Lade Energiedaten im Evaluierungsfenster
  const { data: energyData } = await supabase
    .from('energy_readings')
    .select('*')
    .gte('timestamp', eventTime.toISOString())
    .lte('timestamp', endTime.toISOString())
    .order('timestamp', { ascending: true });

  // Lade Raum-Temperatur-Samples wenn room_id vorhanden
  let tempData: any[] = [];
  if (event.room_id) {
    const { data } = await supabase
      .from('room_temperature_samples')
      .select('*')
      .eq('room_id', event.room_id)
      .gte('timestamp', eventTime.toISOString())
      .lte('timestamp', endTime.toISOString())
      .order('timestamp', { ascending: true });
    tempData = data || [];
  }

  // Lade Heizungslogs wenn room_id vorhanden
  let heatingLogs: any[] = [];
  if (event.room_id) {
    const { data } = await supabase
      .from('room_heating_logs')
      .select('*')
      .eq('room_id', event.room_id)
      .gte('timestamp', eventTime.toISOString())
      .lte('timestamp', endTime.toISOString());
    heatingLogs = data || [];
  }

  // Berechne Outcome
  const outcome = calculateOutcome(energyData || [], tempData, heatingLogs, event);

  // Berechne Reward
  const reward = calculateReward(outcome, event, electricityPrice, feedInPrice);

  return {
    outcome,
    reward: reward.total,
    breakdown: reward.breakdown
  };
}

function calculateOutcome(
  energyData: any[],
  tempData: any[],
  heatingLogs: any[],
  event: LearningEvent
): any {
  // Energieverbrauch
  let totalConsumption = 0;
  let gridImport = 0;
  let pvUsed = 0;
  let batteryUsed = 0;

  for (let i = 1; i < energyData.length; i++) {
    const prev = energyData[i - 1];
    const curr = energyData[i];
    const intervalHours = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3600000;

    const consumption = (curr.consumption || 0) * intervalHours;
    totalConsumption += consumption;

    if (curr.power_io > 0) {
      gridImport += curr.power_io * intervalHours;
    }

    const pvPower = curr.pv_power || 0;
    pvUsed += Math.min(pvPower, curr.consumption || 0) * intervalHours;
  }

  batteryUsed = Math.max(0, totalConsumption - pvUsed - gridImport);

  // Temperatur-Entwicklung
  let tempStart = tempData.length > 0 ? tempData[0].temperature : null;
  let tempEnd = tempData.length > 0 ? tempData[tempData.length - 1].temperature : null;
  let targetReached = false;

  if (event.action?.target_temp && tempEnd) {
    targetReached = tempEnd >= event.action.target_temp - 0.5;
  }

  // Heizungsdauer
  const heatingStop = heatingLogs.find(l => l.event_type === 'heating_stop');
  const actualDuration = heatingStop?.duration_minutes || null;

  return {
    energy_used_wh: Math.round(totalConsumption),
    grid_import_wh: Math.round(gridImport),
    pv_used_wh: Math.round(pvUsed),
    battery_used_wh: Math.round(batteryUsed),
    temp_start: tempStart,
    temp_end: tempEnd,
    temp_change: tempEnd && tempStart ? Math.round((tempEnd - tempStart) * 10) / 10 : null,
    target_reached: targetReached,
    actual_duration_min: actualDuration
  };
}

function calculateReward(
  outcome: any,
  event: LearningEvent,
  electricityPrice: number,
  feedInPrice: number
): { total: number; breakdown: any } {
  const breakdown: any = {};

  // 1. Energiekosten-Komponente (negativ = schlecht)
  const gridCostEur = (outcome.grid_import_wh / 1000) * (electricityPrice / 100);
  breakdown.energy_cost = -gridCostEur;

  // 2. PV-Nutzungs-Bonus (positiv für Eigenverbrauch)
  const pvRatio = outcome.energy_used_wh > 0 
    ? outcome.pv_used_wh / outcome.energy_used_wh 
    : 0;
  breakdown.pv_usage_bonus = pvRatio * 0.5; // Max 0.5 Punkte

  // 3. Batterie-Effizienz (weniger Batterie nachts = besser für Langlebigkeit)
  const batteryRatio = outcome.energy_used_wh > 0 
    ? outcome.battery_used_wh / outcome.energy_used_wh 
    : 0;
  // Nachts ist Batterie-Nutzung akzeptabel, tagsüber PV bevorzugen
  const hour = new Date(event.timestamp).getHours();
  const isNight = hour < 6 || hour >= 22;
  breakdown.battery_efficiency = isNight 
    ? batteryRatio * 0.2 // Nachts: Batterie OK
    : -batteryRatio * 0.3; // Tags: Batterie vermeiden wenn PV da

  // 4. Komfort-Komponente
  if (event.decision_type === 'heating_on' || event.decision_type === 'preheat') {
    if (outcome.target_reached) {
      breakdown.comfort_bonus = 0.8; // Ziel erreicht
    } else if (outcome.temp_change && outcome.temp_change > 0) {
      breakdown.comfort_bonus = 0.3; // Teilweise erwärmt
    } else {
      breakdown.comfort_bonus = -0.5; // Kein Effekt
    }
  } else {
    breakdown.comfort_bonus = 0;
  }

  // 5. Effizienz-Komponente (Energie pro Grad)
  if (outcome.temp_change && outcome.temp_change > 0.1) {
    const energyPerDegree = outcome.energy_used_wh / outcome.temp_change;
    // Vergleiche mit erwartetem Wert (aus Kontext)
    const expectedEnergyPerDegree = event.context?.expected_energy_per_degree || 500;
    const efficiency = expectedEnergyPerDegree / energyPerDegree; // >1 = besser als erwartet
    breakdown.efficiency_bonus = Math.min(0.5, Math.max(-0.5, (efficiency - 1) * 0.5));
  } else {
    breakdown.efficiency_bonus = 0;
  }

  // Gesamtreward
  const total = Object.values(breakdown).reduce((sum: number, val: any) => sum + val, 0);

  return { total, breakdown };
}
