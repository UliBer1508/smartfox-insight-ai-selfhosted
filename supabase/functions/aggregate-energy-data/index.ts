import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting energy data aggregation...');

    // Get retention settings
    const { data: settings } = await supabase
      .from('data_retention_settings')
      .select('*')
      .limit(1)
      .single();

    const rawRetentionDays = settings?.raw_data_retention_days ?? 7;
    const hourlyRetentionDays = settings?.hourly_retention_days ?? 90;
    const autoCleanupEnabled = settings?.auto_cleanup_enabled ?? true;

    // ============================================================
    // Step 0: Daily Patterns direkt aus energy_readings erstellen
    // (unabhängig von Retention-Logik, läuft IMMER)
    // ============================================================
    console.log('Step 0: Creating daily patterns from energy_readings...');
    let dailyPatternsCreated = 0;

    try {
      // Hole alle vorhandenen Tage aus energy_readings mit Paginierung
      // Verwende SQL-artige Gruppierung über distinct Tage
      let allReadings: any[] = [];
      let page = 0;
      const pageSize = 1000;

      while (true) {
        const { data: readings, error } = await supabase
          .from('energy_readings')
          .select('timestamp, power_io, energy_in, energy_out, pv_power, consumption')
          .order('timestamp', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.error('Error fetching readings for daily patterns:', error);
          break;
        }
        if (!readings || readings.length === 0) break;

        allReadings = allReadings.concat(readings);
        page++;

        if (readings.length < pageSize) break;
        if (page > 200) {
          console.log('Safety limit reached at 200 pages (200k readings)');
          break;
        }
      }

      console.log(`Loaded ${allReadings.length} readings for daily pattern calculation`);

      if (allReadings.length > 0) {
        // Gruppiere nach lokalem Datum (Europe/Berlin)
        const dailyGroups: Record<string, any[]> = {};

        for (const reading of allReadings) {
          // Lokales Datum berechnen (Europe/Berlin = UTC+1/+2)
          const ts = new Date(reading.timestamp);
          const month = ts.getUTCMonth();
          const offset = (month >= 2 && month <= 9) ? 2 : 1; // grobe DST
          const localHour = ts.getUTCHours() + offset;
          const localDate = new Date(ts);
          if (localHour >= 24) {
            localDate.setUTCDate(localDate.getUTCDate() + 1);
          }
          const dateKey = localDate.toISOString().split('T')[0];

          if (!dailyGroups[dateKey]) {
            dailyGroups[dateKey] = [];
          }
          dailyGroups[dateKey].push(reading);
        }

        // Für jeden Tag daily_pattern berechnen und upserten
        for (const [date, readings] of Object.entries(dailyGroups)) {
          if (readings.length < 10) continue; // Zu wenig Datenpunkte

          const powers = readings.map(r => r.power_io ?? 0);
          const energyIns = readings.map(r => r.energy_in ?? 0);
          const energyOuts = readings.map(r => r.energy_out ?? 0);

          const peakPower = Math.max(...powers.map(Math.abs));
          const avgPower = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length);

          // Energy: Differenz zwischen max und min (Zählerwerte)
          const totalEnergyIn = Math.max(...energyIns) - Math.min(...energyIns);
          const totalEnergyOut = Math.max(...energyOuts) - Math.min(...energyOuts);
          const netEnergy = totalEnergyOut - totalEnergyIn;

          // Peak time: Zeitpunkt des höchsten Absolutwerts
          const peakIndex = powers.indexOf(powers.reduce((a, b) => Math.abs(a) > Math.abs(b) ? a : b));
          const peakTime = readings[peakIndex]?.timestamp || null;

          const dailyPattern = {
            date,
            peak_power: peakPower,
            peak_time: peakTime,
            avg_power: avgPower,
            total_energy_in: Math.round(totalEnergyIn * 100) / 100,
            total_energy_out: Math.round(totalEnergyOut * 100) / 100,
            net_energy: Math.round(netEnergy * 100) / 100,
            pattern_type: totalEnergyOut > totalEnergyIn ? 'export' : 'import',
          };

          const { error: upsertError } = await supabase
            .from('daily_patterns')
            .upsert(dailyPattern, { onConflict: 'date' });

          if (upsertError) {
            console.error(`Error upserting daily pattern for ${date}:`, upsertError);
          } else {
            dailyPatternsCreated++;
          }
        }

        console.log(`Step 0 complete: Created/updated ${dailyPatternsCreated} daily patterns`);
      }
    } catch (step0Error) {
      console.error('Step 0 error (non-fatal):', step0Error);
    }

    // ============================================================
    // Step 1 & 2: Original retention-based aggregation
    // ============================================================

    if (!autoCleanupEnabled) {
      console.log('Auto cleanup is disabled, skipping retention aggregation');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Daily patterns updated, auto cleanup disabled',
          dailyPatternsCreated 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - rawRetentionDays);
    const cutoffTimestamp = cutoffDate.toISOString();

    console.log(`Step 1: Aggregating raw data older than ${cutoffTimestamp}`);

    // Step 1: Create hourly aggregates from raw data older than retention period
    const { data: rawData, error: rawError } = await supabase
      .from('energy_readings')
      .select('*')
      .lt('timestamp', cutoffTimestamp)
      .order('timestamp', { ascending: true });

    if (rawError) {
      console.error('Error fetching raw data:', rawError);
      throw rawError;
    }

    console.log(`Found ${rawData?.length ?? 0} raw readings to aggregate`);

    if (rawData && rawData.length > 0) {
      // Group by hour
      const hourlyGroups: Record<string, typeof rawData> = {};
      
      for (const reading of rawData) {
        const hourStart = new Date(reading.timestamp);
        hourStart.setMinutes(0, 0, 0);
        const hourKey = hourStart.toISOString();
        
        if (!hourlyGroups[hourKey]) {
          hourlyGroups[hourKey] = [];
        }
        hourlyGroups[hourKey].push(reading);
      }

      const aggregates = Object.entries(hourlyGroups).map(([hourStart, readings]) => {
        const powers = readings.map(r => r.power_io);
        const energyIns = readings.map(r => r.energy_in);
        const energyOuts = readings.map(r => r.energy_out);
        
        return {
          hour_start: hourStart,
          avg_power: Math.round(powers.reduce((a, b) => a + b, 0) / powers.length),
          max_power: Math.max(...powers),
          min_power: Math.min(...powers),
          total_energy_in: Math.max(...energyIns) - Math.min(...energyIns),
          total_energy_out: Math.max(...energyOuts) - Math.min(...energyOuts),
          reading_count: readings.length,
        };
      });

      console.log(`Creating ${aggregates.length} hourly aggregates`);

      for (const aggregate of aggregates) {
        const { error: upsertError } = await supabase
          .from('hourly_aggregates')
          .upsert(aggregate, { onConflict: 'hour_start' });
        
        if (upsertError) {
          console.error('Error upserting aggregate:', upsertError);
        }
      }

      const { error: deleteError } = await supabase
        .from('energy_readings')
        .delete()
        .lt('timestamp', cutoffTimestamp);

      if (deleteError) {
        console.error('Error deleting old readings:', deleteError);
      } else {
        console.log(`Deleted ${rawData.length} old raw readings`);
      }
    }

    // Step 2: Create daily patterns from hourly aggregates older than retention period (Fallback)
    const hourlyCutoff = new Date();
    hourlyCutoff.setDate(hourlyCutoff.getDate() - hourlyRetentionDays);
    const hourlyCutoffTimestamp = hourlyCutoff.toISOString();

    const { data: hourlyData, error: hourlyError } = await supabase
      .from('hourly_aggregates')
      .select('*')
      .lt('hour_start', hourlyCutoffTimestamp);

    if (hourlyError) {
      console.error('Error fetching hourly data:', hourlyError);
    } else if (hourlyData && hourlyData.length > 0) {
      console.log(`Step 2: Found ${hourlyData.length} hourly aggregates to consolidate`);

      const dailyGroups: Record<string, typeof hourlyData> = {};
      
      for (const hourly of hourlyData) {
        const date = hourly.hour_start.split('T')[0];
        if (!dailyGroups[date]) {
          dailyGroups[date] = [];
        }
        dailyGroups[date].push(hourly);
      }

      for (const [date, hourlyReadings] of Object.entries(dailyGroups)) {
        const avgPowers = hourlyReadings.map(h => h.avg_power);
        const maxPowers = hourlyReadings.map(h => h.max_power);
        const totalEnergyIn = hourlyReadings.reduce((sum, h) => sum + h.total_energy_in, 0);
        const totalEnergyOut = hourlyReadings.reduce((sum, h) => sum + h.total_energy_out, 0);
        
        const peakPower = Math.max(...maxPowers);
        const peakHour = hourlyReadings.find(h => h.max_power === peakPower);

        const dailyPattern = {
          date,
          peak_power: peakPower,
          peak_time: peakHour?.hour_start,
          avg_power: Math.round(avgPowers.reduce((a, b) => a + b, 0) / avgPowers.length),
          total_energy_in: totalEnergyIn,
          total_energy_out: totalEnergyOut,
          net_energy: totalEnergyOut - totalEnergyIn,
          pattern_type: totalEnergyOut > totalEnergyIn ? 'export' : 'import',
        };

        const { error: patternError } = await supabase
          .from('daily_patterns')
          .upsert(dailyPattern, { onConflict: 'date' });

        if (patternError) {
          console.error('Error upserting daily pattern:', patternError);
        }
      }

      const { error: deleteHourlyError } = await supabase
        .from('hourly_aggregates')
        .delete()
        .lt('hour_start', hourlyCutoffTimestamp);

      if (deleteHourlyError) {
        console.error('Error deleting old hourly aggregates:', deleteHourlyError);
      } else {
        console.log(`Deleted ${hourlyData.length} old hourly aggregates`);
      }
    }

    // Update last cleanup timestamp
    if (settings?.id) {
      await supabase
        .from('data_retention_settings')
        .update({ last_cleanup_at: new Date().toISOString() })
        .eq('id', settings.id);
    }

    console.log('Aggregation completed successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Aggregation completed',
        dailyPatternsCreated,
        rawDataProcessed: rawData?.length ?? 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Aggregation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
