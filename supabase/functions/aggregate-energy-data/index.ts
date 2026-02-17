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

    if (!autoCleanupEnabled) {
      console.log('Auto cleanup is disabled, skipping aggregation');
      return new Response(
        JSON.stringify({ success: true, message: 'Auto cleanup disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - rawRetentionDays);
    const cutoffTimestamp = cutoffDate.toISOString();

    console.log(`Aggregating data older than ${cutoffTimestamp}`);

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

      // Create aggregates
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

      // Upsert aggregates (in case some already exist)
      for (const aggregate of aggregates) {
        const { error: upsertError } = await supabase
          .from('hourly_aggregates')
          .upsert(aggregate, { onConflict: 'hour_start' });
        
        if (upsertError) {
          console.error('Error upserting aggregate:', upsertError);
        }
      }

      // Delete processed raw readings
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

    // Step 2: Create daily patterns from hourly aggregates older than retention period
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
      console.log(`Found ${hourlyData.length} hourly aggregates to consolidate into daily patterns`);

      // Group by day
      const dailyGroups: Record<string, typeof hourlyData> = {};
      
      for (const hourly of hourlyData) {
        const date = hourly.hour_start.split('T')[0];
        if (!dailyGroups[date]) {
          dailyGroups[date] = [];
        }
        dailyGroups[date].push(hourly);
      }

      // Create daily patterns
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

      // Delete old hourly aggregates
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
