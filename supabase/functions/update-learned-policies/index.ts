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

    // Load all rooms first
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id, name');
    
    if (roomsError) throw roomsError;
    if (!rooms || rooms.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No rooms found', policiesUpdated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Learned Policies] Processing ${rooms.length} rooms`);

    let totalPoliciesUpdated = 0;
    let totalEventsProcessed = 0;

    // Process each room individually to avoid loading all events at once
    for (const room of rooms) {
      // Load evaluated events for this room only (paginated)
      let roomEvents: any[] = [];
      let page = 0;
      const pageSize = 1000;

      while (true) {
        const { data: events, error } = await supabase
          .from('learning_events')
          .select('timestamp, action, outcome, reward, decision_type')
          .eq('is_evaluated', true)
          .eq('room_id', room.id)
          .not('reward', 'is', null)
          .order('timestamp', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.error(`[Learned Policies] Error fetching events for room ${room.name}:`, error);
          break;
        }
        if (!events || events.length === 0) break;

        roomEvents = roomEvents.concat(events);
        page++;

        if (events.length < pageSize) break;
        if (page > 50) break; // Safety limit
      }

      if (roomEvents.length === 0) continue;

      totalEventsProcessed += roomEvents.length;
      console.log(`[Learned Policies] Room ${room.name}: ${roomEvents.length} events`);

      // Group by hour (Vienna timezone)
      const hourlyMap = new Map<number, {
        actions: Map<string, {
          rewards: number[];
          temps: number[];
        }>;
      }>();

      for (const event of roomEvents) {
        const eventDate = new Date(event.timestamp);
        const month = eventDate.getUTCMonth();
        const offset = (month >= 2 && month <= 9) ? 2 : 1;
        const viennaHour = (eventDate.getUTCHours() + offset) % 24;

        if (!hourlyMap.has(viennaHour)) {
          hourlyMap.set(viennaHour, { actions: new Map() });
        }

        const group = hourlyMap.get(viennaHour)!;
        const actionType = event.decision_type || 'unknown';
        const targetTemp = (event.action as any)?.target_temp;
        const actionKey = `${actionType}_${targetTemp || 'none'}`;

        if (!group.actions.has(actionKey)) {
          group.actions.set(actionKey, { rewards: [], temps: [] });
        }

        const actionData = group.actions.get(actionKey)!;
        actionData.rewards.push(event.reward as number);
        if (targetTemp) actionData.temps.push(targetTemp);
      }

      // Find best action per hour
      for (const [hour, group] of hourlyMap) {
        let bestAction = '';
        let bestAvgReward = -Infinity;
        let bestData: any = null;

        for (const [actionKey, data] of group.actions) {
          if (data.rewards.length < 3) continue;

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

        // Determine recommended_action from decision_type
        const decisionType = bestAction.split('_')[0];
        const recommendedAction =
          decisionType === 'night' ? 'deactivate'
          : decisionType === 'solar' ? (bestAction.includes('start') || bestAction.includes('heating') ? 'activate' : 'deactivate')
          : decisionType === 'pv' ? (bestAction.includes('limit') || bestAction.includes('stop') ? 'deactivate' : 'activate')
          : decisionType === 'grid' ? 'activate'
          : decisionType === 'budget' ? 'activate'
          : decisionType === 'activate' ? 'activate'
          : decisionType === 'deactivate' ? 'deactivate'
          : 'keep';

        const { error: upsertError } = await supabase
          .from('learned_policies')
          .upsert({
            room_id: room.id,
            hour_of_day: hour,
            recommended_action: recommendedAction,
            recommended_temp: avgTemp ? Math.round(avgTemp * 2) / 2 : null,
            avg_reward: Math.round(bestAvgReward * 1000) / 1000,
            sample_count: bestData.rewards.length,
            success_rate: Math.round(successRate * 1000) / 1000,
            conditions: {},
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'room_id,hour_of_day'
          });

        if (upsertError) {
          console.error(`[Learned Policies] Error upserting:`, upsertError);
        } else {
          totalPoliciesUpdated++;
        }
      }
    }

    console.log(`[Learned Policies] Updated ${totalPoliciesUpdated} policies from ${totalEventsProcessed} events`);

    return new Response(JSON.stringify({
      success: true,
      eventsProcessed: totalEventsProcessed,
      policiesUpdated: totalPoliciesUpdated,
      roomsProcessed: rooms.length
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
