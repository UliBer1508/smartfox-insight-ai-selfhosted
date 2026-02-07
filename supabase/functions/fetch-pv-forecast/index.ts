import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ForecastSolarResponse {
  result: {
    watts: Record<string, number>;
    watt_hours_period: Record<string, number>;
    watt_hours_day: Record<string, number>;
  };
  message: {
    info: {
      sunrise: string;
      sunset: string;
    };
  };
}

// Saisonaler Korrekturfaktor für realistische Winter-Prognosen
// Forecast.Solar liefert Idealwerte, die in der Praxis oft nicht erreicht werden
function getSeasonalFactor(month: number): number {
  const factors: Record<number, number> = {
    1: 0.35,  // Januar - kurze Tage, tiefer Sonnenstand, oft bewölkt
    2: 0.45,  // Februar
    3: 0.65,  // März
    4: 0.80,  // April
    5: 0.90,  // Mai
    6: 1.00,  // Juni - Optimum
    7: 1.00,  // Juli
    8: 0.95,  // August
    9: 0.80,  // September
    10: 0.60, // Oktober
    11: 0.40, // November
    12: 0.30, // Dezember - kürzeste Tage
  };
  return factors[month] || 1.0;
}

// Sunrise/Sunset aus hourly_watts extrahieren
// Da die kostenlose Forecast.Solar API keine Sonnenzeiten liefert,
// leiten wir sie aus den Stunden mit Leistung > 0 ab
function extractSunTimes(hourlyWatts: Record<string, number>): { sunrise: string | null, sunset: string | null } {
  const sorted = Object.entries(hourlyWatts)
    .filter(([_, w]) => w > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  
  if (sorted.length === 0) {
    return { sunrise: null, sunset: null };
  }
  
  // Erste Zeit mit Watt > 0 = Sunrise
  const sunriseEntry = sorted[0];
  // Letzte Zeit mit Watt > 0 = Sunset
  const sunsetEntry = sorted[sorted.length - 1];
  
  // Zeit extrahieren: "2026-02-07 08:00:00" → "08:00"
  const extractTime = (datetime: string): string | null => {
    const parts = datetime.split(' ');
    if (parts.length < 2) return null;
    return parts[1].substring(0, 5);
  };
  
  return {
    sunrise: extractTime(sunriseEntry[0]),
    sunset: extractTime(sunsetEntry[0])
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get heating settings for location data
    const { data: settings, error: settingsError } = await supabase
      .from('heating_settings')
      .select('latitude, longitude, roof_azimuth, roof_declination, pv_capacity_kwp')
      .limit(1)
      .single();

    if (settingsError || !settings) {
      console.error('Failed to load settings:', settingsError);
      return new Response(
        JSON.stringify({ error: 'Failed to load heating settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { latitude, longitude, roof_azimuth, roof_declination, pv_capacity_kwp } = settings;

    // Construct Forecast.Solar API URL
    // Format: https://api.forecast.solar/estimate/:lat/:lon/:dec/:az/:kwp
    const forecastUrl = `https://api.forecast.solar/estimate/${latitude}/${longitude}/${roof_declination}/${roof_azimuth}/${pv_capacity_kwp}`;
    
    console.log(`Fetching PV forecast from: ${forecastUrl}`);

    const response = await fetch(forecastUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Forecast.Solar API error:', response.status, errorText);
      
      // Handle rate limiting
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'API rate limit exceeded. Try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Failed to fetch forecast from Forecast.Solar' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const forecastData: ForecastSolarResponse = await response.json();
    console.log('Forecast.Solar response received');

    // Process the forecast data
    const forecasts = [];
    const wattHoursDay = forecastData.result.watt_hours_day;
    const watts = forecastData.result.watts;
    const sunrise = forecastData.message?.info?.sunrise;
    const sunset = forecastData.message?.info?.sunset;

    // Group hourly watts by date
    const hourlyWattsByDate: Record<string, Record<string, number>> = {};
    for (const [datetime, wattValue] of Object.entries(watts)) {
      const date = datetime.split(' ')[0];
      if (!hourlyWattsByDate[date]) {
        hourlyWattsByDate[date] = {};
      }
      hourlyWattsByDate[date][datetime] = wattValue;
    }

    // Create forecast entries for each day with seasonal correction
    for (const [date, kwhValue] of Object.entries(wattHoursDay)) {
      const rawKwh = kwhValue / 1000; // Convert Wh to kWh
      const hourlyWatts = hourlyWattsByDate[date] || {};
      
      // Saisonalen Korrekturfaktor anwenden
      const forecastDate = new Date(date);
      const month = forecastDate.getMonth() + 1; // 1-12
      const seasonalFactor = getSeasonalFactor(month);
      const adjustedKwh = rawKwh * seasonalFactor;
      
      // Sunrise/Sunset aus hourly_watts extrahieren
      const sunTimes = extractSunTimes(hourlyWatts);
      
      console.log(`[Forecast] ${date}: ${rawKwh.toFixed(1)} kWh × ${seasonalFactor} = ${adjustedKwh.toFixed(1)} kWh (Monat ${month}), Sunrise: ${sunTimes.sunrise}, Sunset: ${sunTimes.sunset}`);

      forecasts.push({
        date,
        expected_kwh: Math.round(adjustedKwh * 10) / 10,
        hourly_watts: hourlyWatts,
        sunrise: sunTimes.sunrise,
        sunset: sunTimes.sunset,
        fetched_at: new Date().toISOString(),
      });
    }

    // Upsert forecasts to database
    for (const forecast of forecasts) {
      const { error: upsertError } = await supabase
        .from('pv_forecasts')
        .upsert(forecast, { onConflict: 'date' });

      if (upsertError) {
        console.error('Error upserting forecast:', upsertError);
      }
    }

    console.log(`Saved ${forecasts.length} forecast days`);

    // Return the forecasts
    return new Response(
      JSON.stringify({
        success: true,
        forecasts,
        location: { latitude, longitude },
        pvCapacity: pv_capacity_kwp,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in fetch-pv-forecast:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
