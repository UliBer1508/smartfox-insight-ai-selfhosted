// Auto-resolve stale entries in api_errors when the underlying cause is provably gone.
// Triggered every 5 min via pg_cron. Accepts anon/service_role JWT (locally decoded).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function decodeJwtRole(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.replace(/^Bearer\s+/i, '').split('.')[1];
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const role = decodeJwtRole(req.headers.get('authorization'));
  if (role !== 'anon' && role !== 'service_role') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const summary = {
    heartbeat_resolved: 0,
    connection_resolved: 0,
    device_reachable_resolved: 0,
    safety_net_resolved: 0,
  };

  // Service-Health-Status laden
  const { data: health } = await supabase
    .from('service_health')
    .select('last_sync')
    .eq('service_name', 'tuya-thermostat')
    .maybeSingle();
  const healthy = !!(health?.last_sync && (now - new Date(health.last_sync).getTime()) < 5 * 60 * 1000);

  // 1) Heartbeat-Fehler auflösen, wenn Service nachweislich gesund
  if (healthy) {
    const { data, error } = await supabase
      .from('api_errors')
      .update({ resolved_at: nowIso })
      .in('error_type', ['no_control_channel', 'local_service_offline', 'night_frost_failed'])
      .is('resolved_at', null)
      .select('id');
    if (!error) summary.heartbeat_resolved = data?.length ?? 0;
  }

  // 2) connection_error / device_offline pro Raum: aufgelöst, wenn
  //    (a) Raum in den letzten 30 min einen executed Command hat, ODER
  //    (b) das Gerät laut rooms.last_thermostat_sync wieder erreichbar ist (< 10 min), ODER
  //    (c) der Fehler älter als 2 h ist (kein neuer Fehler-Trigger).
  //
  //    Bedingung (b) ist neu: Sie loest ueber device_id auf und funktioniert damit auch,
  //    wenn der Collector kein room_id mitschreibt. Ausserdem haengt sie an der reinen
  //    Erreichbarkeit statt an einem ausgefuehrten Kommando - sonst bleiben Fehler in
  //    Phasen ohne Heizbedarf bis zu 2 h stehen, obwohl das Geraet laengst wieder liefert.
  const { data: openConnErrors } = await supabase
    .from('api_errors')
    .select('id, room_id, device_id, created_at')
    .in('error_type', ['connection_error', 'device_offline'])
    .is('resolved_at', null);

  if (openConnErrors && openConnErrors.length > 0) {
    const thirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    const freshSyncMs = 10 * 60 * 1000;

    // Geraete-Sync-Zeitpunkte einmalig laden (device_id -> last_thermostat_sync)
    const { data: roomSyncs } = await supabase
      .from('rooms')
      .select('tuya_device_id, last_thermostat_sync')
      .not('tuya_device_id', 'is', null);

    const syncByDevice = new Map<string, string | null>(
      (roomSyncs ?? []).map((r: { tuya_device_id: string; last_thermostat_sync: string | null }) =>
        [r.tuya_device_id, r.last_thermostat_sync]
      )
    );

    const toResolve: string[] = [];
    let reachableCount = 0;

    for (const err of openConnErrors) {
      let resolve = false;

      // (a) Ausgefuehrtes Kommando im Raum innerhalb der letzten 30 min
      if (err.room_id) {
        const { data: recentExec } = await supabase
          .from('thermostat_commands')
          .select('id')
          .eq('room_id', err.room_id)
          .eq('status', 'executed')
          .gte('executed_at', thirtyMinAgo)
          .limit(1);
        if (recentExec && recentExec.length > 0) resolve = true;
      }

      // (b) Geraet liefert wieder frische Daten
      if (!resolve && err.device_id) {
        const lastSync = syncByDevice.get(err.device_id);
        if (lastSync && (now - new Date(lastSync).getTime()) < freshSyncMs) {
          resolve = true;
          reachableCount++;
        }
      }

      // (c) Fehler ist aelter als 2 h
      if (!resolve && new Date(err.created_at).getTime() < twoHoursAgo) resolve = true;

      if (resolve) toResolve.push(err.id);
    }

    if (toResolve.length > 0) {
      const { data, error } = await supabase
        .from('api_errors')
        .update({ resolved_at: nowIso })
        .in('id', toResolve)
        .select('id');
      if (!error) {
        summary.connection_resolved = data?.length ?? 0;
        summary.device_reachable_resolved = reachableCount;
      }
    }
  }

  // 3) Sicherheitsnetz: alles was unresolved und älter als 24 h ist → schließen
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const { data: safetyNet } = await supabase
    .from('api_errors')
    .update({ resolved_at: nowIso })
    .is('resolved_at', null)
    .lt('created_at', dayAgo)
    .select('id');
  summary.safety_net_resolved = safetyNet?.length ?? 0;

  console.log('[auto-resolve-api-errors]', { healthy, ...summary });

  return new Response(JSON.stringify({ ok: true, healthy, ...summary }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
