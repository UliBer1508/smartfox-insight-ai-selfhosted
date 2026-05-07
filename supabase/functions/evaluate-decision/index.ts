import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Korrekte lokale Datumsberechnung für Europe/Berlin
function getLocalDateInTimezone(date: Date = new Date(), timezone: string = 'Europe/Berlin'): string {
  return date.toLocaleDateString('sv-SE', { timeZone: timezone });
}

// Lokale Mitternacht als ISO String für DB-Queries
function getLocalMidnightISO(dateStr: string, timezone: string = 'Europe/Berlin'): string {
  // Parse das Datum und setze auf Mitternacht in der Zielzeitzone
  const [year, month, day] = dateStr.split('-').map(Number);
  // Erstelle ein Date-Objekt für Mitternacht in lokaler Zeit
  const localMidnight = new Date(year, month - 1, day, 0, 0, 0, 0);
  return localMidnight.toISOString();
}

// Lokales Tagesende (23:59:59.999) als ISO-String für DB-Queries
function getLocalEndOfDayISO(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const localEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
  return localEnd.toISOString();
}

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
  
  // Korrektes lokales Datum aus dem Event-Timestamp
  const eventDate = getLocalDateInTimezone(eventTime);
  const eventDayStart = getLocalMidnightISO(eventDate);
  // WICHTIG: Korrektes lokales Tagesende statt hartkodiertem String
  const eventDayEnd = getLocalEndOfDayISO(eventDate);

  // Lade PV-Prognose für den Tag des Events
  const { data: forecast } = await supabase
    .from('pv_forecasts')
    .select('expected_kwh, hourly_watts')
    .eq('date', eventDate)
    .single();

  // Lade tatsächliche PV-Produktion für den Tag
  const { data: actualPvReadings } = await supabase
    .from('energy_readings')
    .select('pv_power, timestamp')
    .gte('timestamp', eventDayStart)
    .lte('timestamp', eventDayEnd)
    .order('timestamp');

  // Berechne tatsächliche kWh aus Samples (30s Intervalle geschätzt)
  let actualDayKwh = 0;
  if (actualPvReadings && actualPvReadings.length > 1) {
    for (let i = 1; i < actualPvReadings.length; i++) {
      const prev = actualPvReadings[i - 1];
      const curr = actualPvReadings[i];
      const intervalHours = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3600000;
      actualDayKwh += ((curr.pv_power || 0) / 1000) * intervalHours;
    }
  }

  // Berechne Prognose-Genauigkeit
  let forecastAccuracy: number | null = null;
  if (forecast?.expected_kwh && forecast.expected_kwh > 0 && actualDayKwh > 0) {
    const deviation = Math.abs(actualDayKwh - forecast.expected_kwh) / forecast.expected_kwh;
    forecastAccuracy = Math.max(0, 1 - deviation);
  }

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

  // Berechne Outcome mit Prognose-Info
  const outcome = calculateOutcome(energyData || [], tempData, heatingLogs, event);
  outcome.forecast_expected_kwh = forecast?.expected_kwh || null;
  outcome.actual_day_kwh = Math.round(actualDayKwh * 100) / 100;
  outcome.forecast_accuracy = forecastAccuracy !== null ? Math.round(forecastAccuracy * 100) / 100 : null;

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

  // Gewichtungen (summieren sich zu 1.0)
  const weights = {
    energy_cost: 0.35,
    pv_usage: 0.30,
    comfort: 0.25,
    battery: 0.05,
    forecast: 0.05,
  };

  // 1. Energiekosten: normalisiert auf [-1, 0]
  const maxCostRef = electricityPrice / 100; // EUR für 1 kWh zu Spitzenpreis
  const gridCostEur = (outcome.grid_import_wh / 1000) * (electricityPrice / 100);
  breakdown.energy_cost = -Math.min(1, maxCostRef > 0 ? gridCostEur / maxCostRef : 0);

  // 2. PV-Nutzung: [0, +1]
  const pvRatio = outcome.energy_used_wh > 0
    ? outcome.pv_used_wh / outcome.energy_used_wh
    : 0;
  breakdown.pv_usage = Math.min(1, pvRatio);

  // 3. Komfort: [-1, +1]
  const isHeatingAction = ['activate', 'heating_on', 'preheat'].includes(event.decision_type);
  if (isHeatingAction) {
    if (outcome.target_reached) {
      breakdown.comfort = 1.0;
    } else if (outcome.temp_change && outcome.temp_change > 0) {
      const targetDelta = (event.action?.target_temp || 21) - (outcome.temp_start || 18);
      const progress = targetDelta > 0 ? outcome.temp_change / targetDelta : 0;
      breakdown.comfort = Math.min(0.8, progress);
    } else {
      breakdown.comfort = -1.0;
    }
  } else {
    breakdown.comfort = 0;
  }

  // 4. Batterie: [-0.5, +0.5] (nachts neutral, tagsüber Batterie meiden)
  const batteryRatio = outcome.energy_used_wh > 0
    ? outcome.battery_used_wh / outcome.energy_used_wh
    : 0;
  const hour = new Date(event.timestamp).getHours();
  const isNight = hour < 6 || hour >= 22;
  breakdown.battery = isNight ? 0 : -batteryRatio;

  // 5. Prognosequalität: [-0.5, +0.5]
  if (outcome.forecast_accuracy !== null && outcome.forecast_accuracy !== undefined) {
    breakdown.forecast = (outcome.forecast_accuracy - 0.5) * 1.0;
  } else {
    breakdown.forecast = 0;
  }

  const total =
    breakdown.energy_cost * weights.energy_cost +
    breakdown.pv_usage * weights.pv_usage +
    breakdown.comfort * weights.comfort +
    breakdown.battery * weights.battery +
    breakdown.forecast * weights.forecast;

  breakdown._weights = weights;

  return { total, breakdown };
}
