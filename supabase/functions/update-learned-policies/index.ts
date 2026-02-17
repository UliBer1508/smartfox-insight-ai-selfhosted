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

    console.log('[Learned Policies] Starting policy aggregation...');

    // Load evaluated learning events from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Paginated fetch to overcome 1000 row limit
    let allEvents: any[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data: events, error: eventsError } = await supabase
        .from('learning_events')
        .select('room_id, timestamp, action, outcome, reward, decision_type')
        .eq('is_evaluated', true)
        .not('room_id', 'is', null)
        .not('reward', 'is', null)
        .gte('timestamp', thirtyDaysAgo.toISOString())
        .order('timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (eventsError) throw eventsError;
      if (!events || events.length === 0) break;
      
      allEvents = allEvents.concat(events);
      page++;
      
      if (events.length < pageSize) break; // Last page
      if (page > 100) break; // Safety limit (100k events max)
    }
    
    const events = allEvents;

    if (!events || events.length === 0) {
      console.log('[Learned Policies] No evaluated events found');
      return new Response(JSON.stringify({ success: true, message: 'No events to process', policiesUpdated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Learned Policies] Processing ${events.length} evaluated events`);

    // Group by room_id + hour
    const groupedMap = new Map<string, {
      room_id: string;
      hour: number;
      actions: Map<string, { 
        temps: number[];
        rewards: number[];
        gridImports: number[];
        pvRatios: number[];
      }>;
    }>();

    for (const event of events) {
      // Extract hour in Vienna timezone
      const eventDate = new Date(event.timestamp);
      // Simple Vienna offset: UTC+1 (winter) or UTC+2 (summer)
      const month = eventDate.getUTCMonth();
      const offset = (month >= 2 && month <= 9) ? 2 : 1; // rough DST
      const viennaHour = (eventDate.getUTCHours() + offset) % 24;
      
      const key = `${event.room_id}_${viennaHour}`;
      
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          room_id: event.room_id,
          hour: viennaHour,
          actions: new Map()
        });
      }

      const group = groupedMap.get(key)!;
      const actionType = event.decision_type || 'unknown';
      const targetTemp = (event.action as any)?.target_temp;
      const actionKey = `${actionType}_${targetTemp || 'none'}`;

      if (!group.actions.has(actionKey)) {
        group.actions.set(actionKey, { temps: [], rewards: [], gridImports: [], pvRatios: [] });
      }

      const actionData = group.actions.get(actionKey)!;
      actionData.rewards.push(event.reward as number);
      if (targetTemp) actionData.temps.push(targetTemp);
      
      const outcome = event.outcome as any;
      if (outcome?.grid_import_wh) actionData.gridImports.push(outcome.grid_import_wh);
      if (outcome?.pv_usage_ratio) actionData.pvRatios.push(outcome.pv_usage_ratio);
    }

    // Find best action per room+hour and upsert
    let policiesUpdated = 0;

    for (const [, group] of groupedMap) {
      let bestAction = '';
      let bestAvgReward = -Infinity;
      let bestData: any = null;

      for (const [actionKey, data] of group.actions) {
        if (data.rewards.length < 3) continue; // Need at least 3 samples
        
        const avgReward = data.rewards.reduce((a, b) => a + b, 0) / data.rewards.length;
        if (avgReward > bestAvgReward) {
          bestAvgReward = avgReward;
          bestAction = actionKey;
          bestData = data;
        }
      }

      if (!bestData || !bestAction) continue;

      const successRate = bestData.rewards.filter((r: number) => r > 0).length / bestData.rewards.length;
      const avgTemp = bestData.temps.length > 0 
        ? bestData.temps.reduce((a: number, b: number) => a + b, 0) / bestData.temps.length 
        : null;
      const avgGridImport = bestData.gridImports.length > 0
        ? bestData.gridImports.reduce((a: number, b: number) => a + b, 0) / bestData.gridImports.length
        : 0;
      const avgPvRatio = bestData.pvRatios.length > 0
        ? bestData.pvRatios.reduce((a: number, b: number) => a + b, 0) / bestData.pvRatios.length
        : 0;

      // Determine action type from decision_type prefix
      const decisionType = bestAction.split('_')[0];
      const recommendedAction = 
        decisionType === 'night' ? 'deactivate'
        : decisionType === 'solar' ? (bestAction.includes('start') || bestAction.includes('heating') ? 'activate' : 'deactivate')
        : decisionType === 'pv' ? (bestAction.includes('limit') || bestAction.includes('stop') ? 'deactivate' : 'activate')
        : decisionType === 'grid' ? 'activate'
        : decisionType === 'budget' ? 'activate'
        : 'keep';

      const { error: upsertError } = await supabase
        .from('learned_policies')
        .upsert({
          room_id: group.room_id,
          hour_of_day: group.hour,
          recommended_action: recommendedAction,
          recommended_temp: avgTemp ? Math.round(avgTemp * 2) / 2 : null, // Round to 0.5
          avg_reward: Math.round(bestAvgReward * 1000) / 1000,
          sample_count: bestData.rewards.length,
          success_rate: Math.round(successRate * 1000) / 1000,
          avg_grid_import_wh: Math.round(avgGridImport),
          avg_pv_usage_ratio: Math.round(avgPvRatio * 1000) / 1000,
          conditions: {},
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'room_id,hour_of_day'
        });

      if (upsertError) {
        console.error(`[Learned Policies] Error upserting policy for room ${group.room_id} hour ${group.hour}:`, upsertError);
      } else {
        policiesUpdated++;
      }
    }

    console.log(`[Learned Policies] Updated ${policiesUpdated} policies from ${events.length} events`);

    return new Response(JSON.stringify({ 
      success: true, 
      eventsProcessed: events.length,
      policiesUpdated,
      groupsAnalyzed: groupedMap.size
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Learned Policies] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
