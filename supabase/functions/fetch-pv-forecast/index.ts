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

    // Create forecast entries for each day
    for (const [date, kwhValue] of Object.entries(wattHoursDay)) {
      const expectedKwh = kwhValue / 1000; // Convert Wh to kWh
      const hourlyWatts = hourlyWattsByDate[date] || {};

      forecasts.push({
        date,
        expected_kwh: Math.round(expectedKwh * 10) / 10,
        hourly_watts: hourlyWatts,
        sunrise: sunrise || null,
        sunset: sunset || null,
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
