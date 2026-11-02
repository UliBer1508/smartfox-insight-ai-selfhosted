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

    // ============= NACHTRAG (02.11.2026, doc/KONZEPT-RAUMMODELL-2026-11-02.md) =============
    // Aufruf mit Body {"backfill_from": "2026-06-01"} (optional "backfill_to"): holt gemessene Stundenwerte
    // aus dem Open-Meteo-Archiv (bis ~5 Tage zurück) und für die letzten Tage aus der Prognose-API (past_days).
    // Gleiche Zeitkonvention wie der normale Abruf: Wiener Ortszeit, als UTC gespeichert.
    // Vorhandene Zeilen werden NICHT überschrieben (ignoreDuplicates).
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    if (body?.backfill_from) {
      const vars = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'cloud_cover',
        'wind_speed_10m', 'precipitation', 'direct_radiation', 'diffuse_radiation'];
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
      const addDays = (d: string, n: number) => {
        const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
      };
      const from = String(body.backfill_from).slice(0, 10);
      const to = String(body.backfill_to || addDays(todayStr, -1)).slice(0, 10);
      const archiveTo = to < addDays(todayStr, -6) ? to : addDays(todayStr, -6);
      const toRecords = (h: any, source: string) => {
        const out: any[] = [];
        for (let i = 0; i < (h?.time?.length ?? 0); i++) {
          if (h.temperature_2m?.[i] == null) continue;
          out.push({
            timestamp: new Date(h.time[i]).toISOString(),
            temperature_c: h.temperature_2m[i],
            apparent_temperature_c: h.apparent_temperature?.[i] ?? null,
            humidity_percent: h.relative_humidity_2m?.[i] ?? null,
            cloud_cover_percent: h.cloud_cover?.[i] ?? null,
            wind_speed_kmh: h.wind_speed_10m?.[i] ?? null,
            precipitation_mm: h.precipitation?.[i] ?? null,
            is_day: (h.direct_radiation?.[i] ?? 0) + (h.diffuse_radiation?.[i] ?? 0) > 0,
            direct_radiation_wm2: h.direct_radiation?.[i] ?? null,
            diffuse_radiation_wm2: h.diffuse_radiation?.[i] ?? null,
            source,
          });
        }
        return out;
      };
      let records: any[] = [];
      if (from <= archiveTo) {
        const a = new URL('https://archive-api.open-meteo.com/v1/archive');
        a.searchParams.set('latitude', latitude.toString());
        a.searchParams.set('longitude', longitude.toString());
        a.searchParams.set('start_date', from);
        a.searchParams.set('end_date', archiveTo);
        a.searchParams.set('hourly', vars.join(','));
        a.searchParams.set('timezone', 'Europe/Vienna');
        const r = await fetch(a.toString());
        if (!r.ok) throw new Error(`Open-Meteo Archiv: ${r.status} ${await r.text()}`);
        records = records.concat(toRecords((await r.json()).hourly, 'open-meteo-archiv'));
      }
      if (to > archiveTo) {
        const f = new URL('https://api.open-meteo.com/v1/forecast');
        f.searchParams.set('latitude', latitude.toString());
        f.searchParams.set('longitude', longitude.toString());
        f.searchParams.set('hourly', vars.join(','));
        f.searchParams.set('timezone', 'Europe/Vienna');
        f.searchParams.set('past_days', '8');
        f.searchParams.set('forecast_days', '1');
        const r = await fetch(f.toString());
        if (!r.ok) throw new Error(`Open-Meteo past_days: ${r.status}`);
        const lo = `${addDays(archiveTo, 1)}T00:00`, hi = `${to}T23:59`;
        records = records.concat(toRecords((await r.json()).hourly, 'open-meteo-nachtrag')
          .filter((x) => { const t = x.timestamp.slice(0, 16); return t >= lo && t <= hi; }));
      }
      let saved = 0;
      for (let i = 0; i < records.length; i += 500) {
        const chunk = records.slice(i, i + 500);
        const { error } = await supabase.from('weather_data').upsert(chunk, { onConflict: 'timestamp', ignoreDuplicates: true });
        if (error) throw error;
        saved += chunk.length;
      }
      console.log(`[NACHTRAG] ${from} bis ${to}: ${records.length} Stundenwerte gesendet (vorhandene Zeilen bleiben unverändert)`);
      return new Response(JSON.stringify({ success: true, backfill: { from, to, hours: records.length } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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
