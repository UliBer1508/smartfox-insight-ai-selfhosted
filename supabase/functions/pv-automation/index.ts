import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default-Schwellwerte (werden aus DB überschrieben)
const DEFAULT_PV_SURPLUS_THRESHOLD_ON = 500;   // Watt - Heizen aktivieren
const DEFAULT_PV_SURPLUS_THRESHOLD_OFF = 200;  // Watt - Heizen deaktivieren (Hysterese)
const DEFAULT_MIN_SWITCH_INTERVAL_MIN = 5;     // Minuten zwischen Umschaltungen

interface EnergyReading {
  power_io: number;
  battery_soc: number | null;
  pv_power: number | null;
  timestamp: string;
}

interface Room {
  id: string;
  name: string;
  tuya_device_id: string | null;
  comfort_temp: number;
  eco_temp: number;
  target_temp: number | null;
  pv_auto_enabled: boolean;
  pv_auto_active: boolean | null;
  pv_auto_last_change: string | null;
}

interface HeatingSettings {
  min_battery_soc: number;
  pv_surplus_threshold_on: number | null;
  pv_surplus_threshold_off: number | null;
  min_switch_interval_min: number | null;
}

// Tuya API Helper Functions (reused from tuya-control)
const tokenCache: { token: string; expiresAt: number } | null = null;

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
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function sha256Hash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getAccessToken(accessId: string, accessSecret: string): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  const timestamp = now.toString();
  const method = 'GET';
  const path = '/v1.0/token?grant_type=1';
  const contentHash = await sha256Hash('');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const signStr = accessId + timestamp + stringToSign;
  const sign = await hmacSha256(accessSecret, signStr);

  const response = await fetch(`https://openapi.tuyaeu.com${path}`, {
    method,
    headers: {
      'client_id': accessId,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
    },
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`Failed to get Tuya token: ${data.msg}`);
  }

  return data.result.access_token;
}

async function tuyaRequest(
  accessId: string,
  accessSecret: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const token = await getAccessToken(accessId, accessSecret);
  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const contentHash = await sha256Hash(bodyStr);
  const stringToSign = [method, contentHash, '', path].join('\n');
  const signStr = accessId + token + timestamp + stringToSign;
  const sign = await hmacSha256(accessSecret, signStr);

  const response = await fetch(`https://openapi.tuyaeu.com${path}`, {
    method,
    headers: {
      'client_id': accessId,
      'access_token': token,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
      'Content-Type': 'application/json',
    },
    body: bodyStr || undefined,
  });

  return response.json();
}

async function setDeviceTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  temperature: number
): Promise<unknown> {
  const path = `/v1.0/devices/${deviceId}/commands`;
  const commands = {
    commands: [
      { code: 'temp_set', value: Math.round(temperature * 10) }
    ]
  };
  return tuyaRequest(accessId, accessSecret, 'POST', path, commands);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const tuyaAccessId = Deno.env.get('TUYA_ACCESS_ID');
  const tuyaAccessSecret = Deno.env.get('TUYA_ACCESS_SECRET');
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace('/pv-automation', '');

    // GET /status - Aktuellen Status abrufen
    if (path === '/status' && req.method === 'GET') {
      const { data: latestReading } = await supabase
        .from('energy_readings')
        .select('power_io, battery_soc, pv_power, timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      const { data: rooms } = await supabase
        .from('rooms')
        .select('id, name, pv_auto_enabled, pv_auto_active, pv_auto_last_change, comfort_temp, eco_temp, target_temp')
        .eq('pv_auto_enabled', true);

      const { data: settings } = await supabase
        .from('heating_settings')
        .select('min_battery_soc, pv_surplus_threshold_on, pv_surplus_threshold_off, min_switch_interval_min')
        .limit(1)
        .single();

      const thresholdOn = settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON;
      const thresholdOff = settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF;

      const surplus = latestReading?.power_io || 0;
      const batterySoc = latestReading?.battery_soc || 0;
      const minBatterySoc = settings?.min_battery_soc || 20;

      return new Response(JSON.stringify({
        success: true,
        status: {
          currentSurplus: surplus,
          batterySoc: batterySoc,
          minBatterySoc: minBatterySoc,
          batteryOk: batterySoc >= minBatterySoc,
          surplusOk: surplus >= thresholdOn,
          thresholds: {
            on: thresholdOn,
            off: thresholdOff
          },
          rooms: rooms || [],
          lastReading: latestReading?.timestamp
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST /check - PV-Automatik ausführen
    if (path === '/check' && req.method === 'POST') {
      console.log('[PV-Automation] Starting check...');

      // 1. Letzte Energiemessung abrufen
      const { data: latestReading, error: readingError } = await supabase
        .from('energy_readings')
        .select('power_io, battery_soc, pv_power, timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (readingError || !latestReading) {
        console.log('[PV-Automation] No energy readings found');
        return new Response(JSON.stringify({
          success: false,
          error: 'No energy readings available'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const reading = latestReading as EnergyReading;
      const surplus = reading.power_io; // Positiv = Einspeisung/Überschuss
      const batterySoc = reading.battery_soc || 0;
      
      console.log(`[PV-Automation] Current surplus: ${surplus}W, Battery SOC: ${batterySoc}%`);

      // 2. Heating Settings abrufen
      const { data: settingsData } = await supabase
        .from('heating_settings')
        .select('min_battery_soc, pv_surplus_threshold_on, pv_surplus_threshold_off, min_switch_interval_min')
        .limit(1)
        .single();

      const settings = settingsData as HeatingSettings | null;
      const minBatterySoc = settings?.min_battery_soc || 20;
      const thresholdOn = settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON;
      const thresholdOff = settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF;
      const minSwitchIntervalMs = (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN) * 60 * 1000;

      // 3. Batterie-Check: Nur heizen wenn Batterie ausreichend geladen
      if (batterySoc < minBatterySoc) {
        console.log(`[PV-Automation] Battery SOC (${batterySoc}%) below minimum (${minBatterySoc}%), skipping automation`);
        return new Response(JSON.stringify({
          success: true,
          message: 'Battery below minimum SOC, automation paused',
          batterySoc,
          minBatterySoc
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 4. Räume mit PV-Automatik laden
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, name, tuya_device_id, comfort_temp, eco_temp, target_temp, pv_auto_enabled, pv_auto_active, pv_auto_last_change')
        .eq('pv_auto_enabled', true)
        .not('tuya_device_id', 'is', null);

      if (roomsError || !roomsData || roomsData.length === 0) {
        console.log('[PV-Automation] No rooms with PV automation enabled');
        return new Response(JSON.stringify({
          success: true,
          message: 'No rooms with PV automation enabled'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const rooms = roomsData as Room[];
      console.log(`[PV-Automation] Found ${rooms.length} rooms with PV automation`);

      // 5. Tuya Credentials prüfen
      if (!tuyaAccessId || !tuyaAccessSecret) {
        console.error('[PV-Automation] Tuya credentials not configured');
        return new Response(JSON.stringify({
          success: false,
          error: 'Tuya credentials not configured'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const results: Array<{
        roomId: string;
        roomName: string;
        action: string;
        newTemp?: number;
        success: boolean;
        error?: string;
      }> = [];

      const now = new Date();

      // 6. Für jeden Raum die Automatik ausführen
      for (const room of rooms) {
        const roomResult = {
          roomId: room.id,
          roomName: room.name,
          action: 'none',
          success: true
        } as typeof results[0];

        try {
          const isCurrentlyActive = room.pv_auto_active === true;
          const lastChange = room.pv_auto_last_change ? new Date(room.pv_auto_last_change) : null;
          
          // Mindestzeit seit letzter Umschaltung prüfen
          if (lastChange && (now.getTime() - lastChange.getTime()) < minSwitchIntervalMs) {
            roomResult.action = 'skipped_cooldown';
            results.push(roomResult);
            console.log(`[PV-Automation] ${room.name}: Skipping, cooldown active`);
            continue;
          }

          let shouldActivate = false;
          let shouldDeactivate = false;

          // Hysterese-Logik mit konfigurierbaren Schwellwerten
          if (!isCurrentlyActive && surplus >= thresholdOn) {
            // Aktivieren bei genug Überschuss
            shouldActivate = true;
          } else if (isCurrentlyActive && surplus < thresholdOff) {
            // Deaktivieren wenn Überschuss unter Schwelle fällt
            shouldDeactivate = true;
          }

          if (shouldActivate) {
            // Auf Komfort-Temperatur setzen
            const targetTemp = room.comfort_temp;
            console.log(`[PV-Automation] ${room.name}: Activating, setting to ${targetTemp}°C`);
            
            if (room.tuya_device_id) {
              const result = await setDeviceTemperature(
                tuyaAccessId,
                tuyaAccessSecret,
                room.tuya_device_id,
                targetTemp
              );
              console.log(`[PV-Automation] ${room.name}: Tuya response:`, JSON.stringify(result));
            }

            // Status in DB aktualisieren
            await supabase
              .from('rooms')
              .update({
                pv_auto_active: true,
                pv_auto_last_change: now.toISOString(),
                target_temp: targetTemp
              })
              .eq('id', room.id);

            roomResult.action = 'activated';
            roomResult.newTemp = targetTemp;
          } else if (shouldDeactivate) {
            // Auf Eco-Temperatur zurücksetzen
            const targetTemp = room.eco_temp;
            console.log(`[PV-Automation] ${room.name}: Deactivating, setting to ${targetTemp}°C`);
            
            if (room.tuya_device_id) {
              const result = await setDeviceTemperature(
                tuyaAccessId,
                tuyaAccessSecret,
                room.tuya_device_id,
                targetTemp
              );
              console.log(`[PV-Automation] ${room.name}: Tuya response:`, JSON.stringify(result));
            }

            // Status in DB aktualisieren
            await supabase
              .from('rooms')
              .update({
                pv_auto_active: false,
                pv_auto_last_change: now.toISOString(),
                target_temp: targetTemp
              })
              .eq('id', room.id);

            roomResult.action = 'deactivated';
            roomResult.newTemp = targetTemp;
          } else {
            roomResult.action = 'no_change';
            console.log(`[PV-Automation] ${room.name}: No change needed (active: ${isCurrentlyActive}, surplus: ${surplus}W)`);
          }

          results.push(roomResult);
        } catch (error) {
          console.error(`[PV-Automation] Error processing room ${room.name}:`, error);
          roomResult.action = 'error';
          roomResult.success = false;
          roomResult.error = error instanceof Error ? error.message : 'Unknown error';
          results.push(roomResult);
        }
      }

      console.log('[PV-Automation] Check completed:', JSON.stringify(results));

      return new Response(JSON.stringify({
        success: true,
        surplus,
        batterySoc,
        minBatterySoc,
        thresholds: {
          on: thresholdOn,
          off: thresholdOff
        },
        results
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[PV-Automation] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
