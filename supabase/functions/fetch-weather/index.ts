import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Lade Koordinaten aus Heizungseinstellungen
    const { data: settings } = await supabase
      .from('heating_settings')
      .select('latitude, longitude')
      .limit(1)
      .single();

    const latitude = settings?.latitude || 47.24983;
    const longitude = settings?.longitude || 12.25415;

    console.log(`Fetching weather for coordinates: ${latitude}, ${longitude}`);

    // Open-Meteo API (kostenlos, kein API-Key nötig)
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set('hourly', [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'cloud_cover',
      'wind_speed_10m',
      'precipitation',
      'is_day',
      'direct_radiation',
      'diffuse_radiation'
    ].join(','));
    url.searchParams.set('timezone', 'Europe/Vienna');
    url.searchParams.set('forecast_days', '2');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();
    const hourly = data.hourly;

    // Speichere Wetterdaten
    const weatherRecords = [];
    for (let i = 0; i < hourly.time.length; i++) {
      weatherRecords.push({
        timestamp: new Date(hourly.time[i]).toISOString(),
        temperature_c: hourly.temperature_2m[i],
        apparent_temperature_c: hourly.apparent_temperature[i],
        humidity_percent: hourly.relative_humidity_2m[i],
        cloud_cover_percent: hourly.cloud_cover[i],
        wind_speed_kmh: hourly.wind_speed_10m[i],
        precipitation_mm: hourly.precipitation[i],
        is_day: hourly.is_day[i] === 1,
        direct_radiation_wm2: hourly.direct_radiation[i],
        diffuse_radiation_wm2: hourly.diffuse_radiation[i],
        source: 'open-meteo'
      });
    }

    // Upsert (update bei Konflikt)
    const { error } = await supabase
      .from('weather_data')
      .upsert(weatherRecords, {
        onConflict: 'timestamp',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Error saving weather data:', error);
      throw error;
    }

    console.log(`Saved ${weatherRecords.length} weather records`);

    // Aktuelle Wetterdaten zurückgeben
    const now = new Date();
    const currentHour = weatherRecords.find(r => {
      const t = new Date(r.timestamp);
      return t.getHours() === now.getHours() && 
             t.getDate() === now.getDate();
    });

    return new Response(JSON.stringify({
      success: true,
      records_saved: weatherRecords.length,
      current: currentHour,
      location: { latitude, longitude }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Weather fetch error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
