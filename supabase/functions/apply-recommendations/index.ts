import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TUYA_API_BASE = 'https://openapi.tuyaeu.com';

// Korrekte lokale Datumsberechnung für Europe/Berlin
function getLocalDateInTimezone(timezone: string = 'Europe/Berlin'): string {
  const now = new Date();
  // sv-SE gibt YYYY-MM-DD Format
  return now.toLocaleDateString('sv-SE', { timeZone: timezone });
}

interface TuyaToken {
  access_token: string;
  expire_time: number;
  refresh_token: string;
  uid: string;
}

let cachedToken: TuyaToken | null = null;
let tokenExpiry = 0;

// Helper to convert ArrayBuffer to hex string (uppercase)
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Create HMAC-SHA256 signature (returns uppercase hex)
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return bufferToHex(signature).toUpperCase();
}

// Calculate SHA256 hash of content (returns lowercase hex)
async function sha256Hash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

// Build stringToSign for Tuya API
async function buildStringToSign(method: string, path: string, body: string = ''): Promise<string> {
  const contentHash = await sha256Hash(body);
  const headers = '';
  return `${method}\n${contentHash}\n${headers}\n${path}`;
}

// Get Tuya access token
async function getAccessToken(accessId: string, accessSecret: string): Promise<string> {
  const now = Date.now();
  
  if (cachedToken && tokenExpiry > now + 60000) {
    return cachedToken.access_token;
  }

  const timestamp = now.toString();
  const nonce = '';
  const path = '/v1.0/token?grant_type=1';
  
  const stringToSign = await buildStringToSign('GET', path, '');
  const str = accessId + timestamp + nonce + stringToSign;
  const sign = await hmacSha256(accessSecret, str);

  const response = await fetch(`${TUYA_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      'client_id': accessId,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
    },
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Failed to get token: ${data.msg} (code: ${data.code})`);
  }

  cachedToken = data.result;
  tokenExpiry = now + (data.result.expire_time * 1000);
  return data.result.access_token;
}

// Make authenticated Tuya API request
async function tuyaRequest(
  accessId: string,
  accessSecret: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const token = await getAccessToken(accessId, accessSecret);
  const timestamp = Date.now().toString();
  const nonce = '';
  
  const bodyStr = body ? JSON.stringify(body) : '';
  
  const stringToSign = await buildStringToSign(method, path, bodyStr);
  const str = accessId + token + timestamp + nonce + stringToSign;
  const sign = await hmacSha256(accessSecret, str);

  const headers: Record<string, string> = {
    'client_id': accessId,
    'access_token': token,
    'sign': sign,
    'sign_method': 'HMAC-SHA256',
    't': timestamp,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${TUYA_API_BASE}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Tuya API error: ${data.msg} (code: ${data.code})`);
  }

  return data.result;
}

// Set device temperature - only temp_set (mode must be set separately to avoid Error 2008)
async function setDeviceTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  temperature: number
): Promise<unknown> {
  const tempValue = Math.round(temperature * 10);
  
  return await tuyaRequest(accessId, accessSecret, 'POST', `/v1.0/devices/${deviceId}/commands`, {
    commands: [
      { code: 'temp_set', value: tempValue }
    ]
  });
}

interface Room {
  id: string;
  name: string;
  tuya_device_id: string | null;
  target_temp: number | null;
  automation_enabled: boolean | null;
  last_auto_change: string | null;
  comfort_temp: number | null;
  eco_temp: number | null;
  night_temp: number | null;
  manual_override_until: string | null;
}

interface Recommendation {
  id: string;
  room_id: string;
  date: string;
  start_time: string;
  end_time: string;
  recommended_temp: number;
  reason: string | null;
  priority: string | null;
}

interface HeatingSettings {
  min_switch_interval_min: number | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication: Validate JWT token or known key
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    const knownKeys = [serviceRoleKey, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
    let isAuthorized = knownKeys.includes(token);

    if (!isAuthorized) {
      try {
        const payloadB64 = token.split('.')[1];
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
          const role = payload.role || payload.aud;
          isAuthorized = ['anon', 'authenticated', 'service_role'].includes(role);
          if (!isAuthorized) console.error(`[apply-recommendations] Auth rejected: role=${role}`);
        }
      } catch (e) {
        console.error(`[apply-recommendations] JWT decode failed: ${e}`);
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessId = Deno.env.get('TUYA_ACCESS_ID')?.trim();
    const accessSecret = Deno.env.get('TUYA_ACCESS_SECRET')?.trim();
    const supabaseKey = serviceRoleKey;

    if (!accessId || !accessSecret) {
      throw new Error('Tuya credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const url = new URL(req.url);
    const path = url.pathname.replace('/apply-recommendations', '');

    console.log(`[apply-recommendations] Request: ${req.method} ${path}`);

    // GET /status - Get automation status
    if (req.method === 'GET' || path === '/status') {
      const { data: rooms } = await supabase
        .from('rooms')
        .select('id, name, automation_enabled, last_auto_change, target_temp, tuya_device_id')
        .not('tuya_device_id', 'is', null);

      const today = getLocalDateInTimezone();
      const now = new Date();
      // Aktuelle Zeit in lokaler Zeitzone
      const currentTime = now.toLocaleTimeString('de-DE', { 
        timeZone: 'Europe/Berlin', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
      });

      const { data: recommendations } = await supabase
        .from('room_recommendations')
        .select('*')
        .eq('date', today)
        .lte('start_time', currentTime)
        .gte('end_time', currentTime);

      return new Response(JSON.stringify({
        success: true,
        rooms: rooms || [],
        activeRecommendations: recommendations || [],
        timestamp: now.toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /apply - Apply current recommendations
    if (req.method === 'POST' && (path === '/apply' || path === '')) {
      const today = getLocalDateInTimezone();
      const now = new Date();
      const currentTime = now.toLocaleTimeString('de-DE', { 
        timeZone: 'Europe/Berlin', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
      });

      console.log(`[apply-recommendations] Checking recommendations for ${today} at ${currentTime}`);

      // === NACHT-CHECK: Nachts keine Empfehlungen anwenden ===
      const { data: nightSettings } = await supabase
        .from('heating_settings')
        .select('night_start_time, night_end_time')
        .limit(1)
        .maybeSingle();

      const nightStart = nightSettings?.night_start_time || '22:00';
      const nightEnd = nightSettings?.night_end_time || '06:00';

      // Parse current Wien time
      const [curH, curM] = currentTime.split(':').map(Number);
      const curMinutes = curH * 60 + curM;
      const [nsH, nsM] = String(nightStart).split(':').map(Number);
      const [neH, neM] = String(nightEnd).split(':').map(Number);
      const nightStartMin = nsH * 60 + (nsM || 0);
      const nightEndMin = neH * 60 + (neM || 0);

      let isNight: boolean;
      if (nightStartMin > nightEndMin) {
        isNight = curMinutes >= nightStartMin || curMinutes < nightEndMin;
      } else {
        isNight = curMinutes >= nightStartMin && curMinutes < nightEndMin;
      }

      if (isNight) {
        console.log(`[apply-recommendations] Nachtmodus aktiv (${nightStart}-${nightEnd}), überspringe Empfehlungen`);
        return new Response(JSON.stringify({
          success: true,
          message: 'Nachtmodus aktiv - keine Empfehlungen angewendet',
          applied: 0,
          skipped: 0,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Load control mode
      const { data: modeSetting } = await supabase
        .from('system_settings')
        .select('id, value')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();
      let controlMode = (modeSetting?.value as { mode?: string })?.mode || 'cloud';

      // NOTE: Auto-switch to local mode is DISABLED - local service is not yet functional.
      // Quota errors are logged but the mode stays as configured by the user.
      if (controlMode === 'cloud') {
        const { data: recentQuotaErrors } = await supabase
          .from('api_errors')
          .select('id')
          .in('source', ['pv-automation', 'apply-recommendations'])
          .eq('error_type', 'tuya_api')
          .is('resolved_at', null)
          .gte('created_at', new Date(Date.now() - 120 * 60 * 1000).toISOString())
          .ilike('error_message', '%quota%')
          .limit(1);

        if (recentQuotaErrors && recentQuotaErrors.length > 0) {
          console.log('[apply-recommendations] ⚠️ Quota-Fehler erkannt, aber Auto-Switch auf LOCAL ist deaktiviert. Bleibe bei Cloud.');
        }
      }

      // Local channel heartbeat: bei lokalem Modus auf letzten executed command prüfen
      let localServiceActive = true;
      if (controlMode === 'local') {
        const { data: recentLocalExec } = await supabase
          .from('thermostat_commands')
          .select('executed_at')
          .eq('status', 'executed')
          .order('executed_at', { ascending: false })
          .limit(1);

        const lastExec = recentLocalExec?.[0]?.executed_at;
        localServiceActive = !!(lastExec && (Date.now() - new Date(lastExec).getTime()) < 15 * 60 * 1000);

        if (localServiceActive) {
          await supabase
            .from('api_errors')
            .update({ resolved_at: new Date().toISOString() })
            .eq('source', 'apply-recommendations')
            .eq('error_type', 'no_control_channel')
            .is('resolved_at', null);
        }
      }

      console.log(`[apply-recommendations] Control mode: ${controlMode}, localServiceActive=${localServiceActive}`);

      // ============= QUOTA CHECK =============
      let quotaExhausted = false;
      let quotaData: { monthly_limit: number; calls_this_month: number; month: string; daily_limit: number; calls_today: number; today: string; last_sync_at: string | null } | null = null;
      
      if (controlMode === 'cloud') {
        const { data: quotaSetting } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'tuya_api_quota')
          .maybeSingle();
        
        if (quotaSetting?.value) {
          quotaData = quotaSetting.value as typeof quotaData;
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const wienDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(now);
          
          if (quotaData!.month !== currentMonth) { quotaData!.calls_this_month = 0; quotaData!.month = currentMonth; }
          if (quotaData!.today !== wienDate) { quotaData!.calls_today = 0; quotaData!.today = wienDate; }
          
          const monthlyLimit = quotaData!.monthly_limit || 900;
          const dailyLimit = quotaData!.daily_limit || 33;
          const effectiveDailyLimit = Math.max(1, dailyLimit - 2);
          
          // Plausibility checks
          if (quotaData!.calls_today > dailyLimit * 2) { quotaData!.calls_today = dailyLimit; }
          if (quotaData!.calls_this_month > monthlyLimit * 2) { quotaData!.calls_this_month = monthlyLimit; }
          
          if (quotaData!.calls_this_month >= monthlyLimit || quotaData!.calls_today >= effectiveDailyLimit) {
            quotaExhausted = true;
            console.log(`[apply-recommendations] ⚠️ Quota erschöpft (${quotaData!.calls_today}/${dailyLimit} heute, ${quotaData!.calls_this_month}/${monthlyLimit} monatlich)`);
          }
        }
      }

      if (quotaExhausted) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Tuya API Quota erschöpft - keine Cloud-Calls möglich',
          applied: 0,
          skipped: rooms?.length || 0,
          quotaExhausted: true,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get heating settings for cooldown interval
      const { data: settingsData } = await supabase
        .from('heating_settings')
        .select('min_switch_interval_min')
        .single();

      const minSwitchInterval = (settingsData as HeatingSettings)?.min_switch_interval_min || 5;
      const cooldownMs = minSwitchInterval * 60 * 1000;

      // Get rooms with automation enabled and Tuya device
      const { data: rooms, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('automation_enabled', true)
        .not('tuya_device_id', 'is', null);

      if (roomsError) throw roomsError;

      if (!rooms || rooms.length === 0) {
        console.log('[apply-recommendations] No rooms with automation enabled');
        return new Response(JSON.stringify({
          success: true,
          message: 'No rooms with automation enabled',
          applied: 0,
          skipped: 0,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get current recommendations for all rooms
      const { data: recommendations, error: recError } = await supabase
        .from('room_recommendations')
        .select('*')
        .eq('date', today)
        .lte('start_time', currentTime)
        .gte('end_time', currentTime);

      if (recError) throw recError;

      const recMap = new Map<string, Recommendation>();
      for (const rec of (recommendations || [])) {
        recMap.set(rec.room_id, rec as Recommendation);
      }

      const results = {
        applied: [] as { roomId: string; name: string; oldTemp: number; newTemp: number; reason: string }[],
        skipped: [] as { roomId: string; name: string; reason: string }[],
        errors: [] as { roomId: string; name: string; error: string }[],
      };

      const queueLocalTemperatureCommand = async (roomId: string, temperature: number) => {
        const { data: pendingCommand } = await supabase
          .from('thermostat_commands')
          .select('id, value')
          .eq('room_id', roomId)
          .eq('command', 'set_temp')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const pendingValue = Number(pendingCommand?.value ?? NaN);
        if (pendingCommand?.id && Number.isFinite(pendingValue) && Math.abs(pendingValue - temperature) < 0.1) {
          return { ok: true, alreadyQueued: true };
        }

        const { error } = await supabase.from('thermostat_commands').insert({
          room_id: roomId,
          command: 'set_temp',
          value: temperature,
          status: 'pending',
        });

        if (error) return { ok: false, alreadyQueued: false, error: error.message };
        return { ok: true, alreadyQueued: false };
      };

      let noControlLogged = false;

      // ============= PV-AUTOMATION CONFLICT GUARD =============
      // pv-automation (every 2 min) is the sole setpoint authority. Skip rooms
      // where pv-automation is active or recently changed setpoints to prevent
      // setpoint flapping (target 22→19→22→19 in minute cycles).
      const { data: parallelCapacity } = await supabase
        .from('system_settings')
        .select('value, updated_at')
        .eq('key', 'parallel_heating_capacity')
        .maybeSingle();
      const pvAutomationRecentMs = parallelCapacity?.updated_at
        ? Date.now() - new Date(parallelCapacity.updated_at).getTime()
        : Number.POSITIVE_INFINITY;
      const pvAutomationActive = pvAutomationRecentMs < 5 * 60 * 1000;

      for (const room of rooms as Room[]) {
        // Skip if pv-automation owns this room
        if (room.pv_auto_active === true) {
          results.skipped.push({
            roomId: room.id,
            name: room.name,
            reason: 'pv-automation aktiv – kein Override',
          });
          continue;
        }
        if (pvAutomationActive && room.last_auto_change) {
          const lastAutoMs = Date.now() - new Date(room.last_auto_change).getTime();
          if (lastAutoMs < 10 * 60 * 1000) {
            results.skipped.push({
              roomId: room.id,
              name: room.name,
              reason: `pv-automation hat vor ${Math.round(lastAutoMs / 60000)} min gesetzt – kein Override`,
            });
            continue;
          }
        }

        // Check manual override first
        if (room.manual_override_until) {
          const overrideUntil = new Date(room.manual_override_until);
          if (now < overrideUntil) {
            console.log(`[apply-recommendations] Room ${room.name} has manual override until ${overrideUntil.toLocaleTimeString('de-DE')}`);
            results.skipped.push({ 
              roomId: room.id, 
              name: room.name, 
              reason: `Manueller Override bis ${overrideUntil.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` 
            });
            continue;
          }
        }

        const recommendation = recMap.get(room.id);

        // Check if recommendation exists
        if (!recommendation) {
          results.skipped.push({ roomId: room.id, name: room.name, reason: 'Keine aktuelle Empfehlung' });
          continue;
        }

        // Check cooldown
        if (room.last_auto_change) {
          const lastChange = new Date(room.last_auto_change).getTime();
          if (now.getTime() - lastChange < cooldownMs) {
            results.skipped.push({ 
              roomId: room.id, 
              name: room.name, 
              reason: `Cooldown aktiv (${Math.ceil((cooldownMs - (now.getTime() - lastChange)) / 60000)} min)` 
            });
            continue;
          }
        }

        // Check if temperature change is needed
        const currentTemp = room.target_temp || 0;
        const recommendedTemp = recommendation.recommended_temp;
        const tempDiff = Math.abs(currentTemp - recommendedTemp);

        if (tempDiff < 0.5) {
          results.skipped.push({ 
            roomId: room.id, 
            name: room.name, 
            reason: `Temperatur bereits korrekt (${currentTemp}°C)` 
          });
          continue;
        }

        // Check temperature limits
        const minTemp = Math.min(room.eco_temp || 15, room.night_temp || 15, 15);
        const maxTemp = Math.max(room.comfort_temp || 25, 25);
        const safeTemp = Math.max(minTemp, Math.min(maxTemp, recommendedTemp));

        // Apply temperature to thermostat
        try {
          console.log(`[apply-recommendations] Setting ${room.name} from ${currentTemp}°C to ${safeTemp}°C (mode: ${controlMode})`);
          
          if (controlMode === 'local') {
            const queued = await queueLocalTemperatureCommand(room.id, safeTemp);
            if (!queued.ok) {
              throw new Error(queued.error || 'Lokales Queueing fehlgeschlagen');
            }

            if (!localServiceActive) {
              if (!noControlLogged) {
                await supabase.from('api_errors').insert({
                  source: 'apply-recommendations',
                  error_type: 'no_control_channel',
                  error_message: queued.alreadyQueued
                    ? `Lokaler Service offline - Befehle bereits wartend (z.B. ${room.name} ${safeTemp}°C)`
                    : `Lokaler Service offline - Sicherheitsbefehle wartend vorgemerkt (z.B. ${room.name} ${safeTemp}°C)`,
                  room_id: room.id,
                  room_name: room.name,
                  error_code: 'NO_CONTROL',
                });
                noControlLogged = true;
              }

              results.skipped.push({
                roomId: room.id,
                name: room.name,
                reason: queued.alreadyQueued
                  ? `Lokaler Service offline, Befehl bereits wartend (${safeTemp}°C)`
                  : `Lokaler Service offline, Befehl vorgemerkt (${safeTemp}°C)`,
              });
              continue;
            }
          } else {
            // CLOUD MODE: Use Tuya Cloud API with quota tracking
            if (quotaExhausted) {
              results.skipped.push({ roomId: room.id, name: room.name, reason: 'Quota mid-run erschöpft' });
              continue;
            }
            await setDeviceTemperature(accessId!, accessSecret!, room.tuya_device_id!, safeTemp);
            // Track this API call
            if (quotaData) {
              quotaData.calls_today++;
              quotaData.calls_this_month++;
              const effDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
              if (quotaData.calls_today >= effDL || quotaData.calls_this_month >= (quotaData.monthly_limit || 900)) {
                quotaExhausted = true;
                console.log(`[apply-recommendations] ⚠️ Quota mid-run erschöpft`);
              }
            }
          }

          // Update room in database
          await supabase
            .from('rooms')
            .update({
              target_temp: safeTemp,
              last_auto_change: now.toISOString(),
              last_thermostat_sync: now.toISOString(),
            })
            .eq('id', room.id);

          // Log the change
          await supabase.from('room_heating_logs').insert({
            room_id: room.id,
            event_type: 'temp_change',
            current_temp: room.target_temp || 0,
            target_temp: safeTemp,
            pv_surplus_w: null,
            timestamp: now.toISOString(),
          });

          results.applied.push({
            roomId: room.id,
            name: room.name,
            oldTemp: currentTemp,
            newTemp: safeTemp,
            reason: recommendation.reason || 'Automatische Anpassung',
          });

        } catch (error) {
          console.error(`[apply-recommendations] Error setting temp for ${room.name}:`, error);
          results.errors.push({
            roomId: room.id,
            name: room.name,
            error: String(error),
          });
        }
      }

      // Persist quota after all calls
      if (quotaData) {
        await supabase.from('system_settings')
          .update({ value: quotaData, updated_at: new Date().toISOString() })
          .eq('key', 'tuya_api_quota');
      }

      console.log(`[apply-recommendations] Applied: ${results.applied.length}, Skipped: ${results.skipped.length}, Errors: ${results.errors.length}${quotaData ? ` | Quota: ${quotaData.calls_today}/${quotaData.daily_limit} heute, ${quotaData.calls_this_month}/${quotaData.monthly_limit} monatlich` : ''}`);

      return new Response(JSON.stringify({
        success: true,
        applied: results.applied.length,
        skipped: results.skipped.length,
        errors: results.errors.length,
        details: results,
        timestamp: now.toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /toggle - Toggle automation for a room
    if (req.method === 'POST' && path === '/toggle') {
      const { roomId, enabled } = await req.json();
      
      if (!roomId) {
        throw new Error('roomId is required');
      }

      await supabase
        .from('rooms')
        .update({ automation_enabled: enabled })
        .eq('id', roomId);

      console.log(`[apply-recommendations] Automation ${enabled ? 'enabled' : 'disabled'} for room ${roomId}`);

      return new Response(JSON.stringify({ success: true, roomId, enabled }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[apply-recommendations] Error:', error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
