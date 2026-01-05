import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TUYA_API_BASE = 'https://openapi.tuyaeu.com';

interface TuyaToken {
  access_token: string;
  expire_time: number;
  refresh_token: string;
  uid: string;
}

let cachedToken: TuyaToken | null = null;
let tokenExpiry = 0;

// Create HMAC-SHA256 signature for Tuya API
async function createSign(
  accessId: string,
  accessSecret: string,
  timestamp: string,
  signStr: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(accessSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signStr));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

// Get Tuya access token
async function getAccessToken(accessId: string, accessSecret: string): Promise<string> {
  const now = Date.now();
  
  if (cachedToken && tokenExpiry > now + 60000) {
    return cachedToken.access_token;
  }

  const timestamp = now.toString();
  const signStr = accessId + timestamp;
  const sign = await createSign(accessId, accessSecret, timestamp, signStr);

  const response = await fetch(`${TUYA_API_BASE}/v1.0/token?grant_type=1`, {
    method: 'GET',
    headers: {
      'client_id': accessId,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
    },
  });

  const data = await response.json();
  console.log('Token response:', JSON.stringify(data));

  if (!data.success) {
    throw new Error(`Failed to get token: ${data.msg}`);
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
  
  // Build string to sign: client_id + access_token + t + stringToSign
  const stringToSign = method.toUpperCase() + '\n' +
    crypto.subtle.digest('SHA-256', new TextEncoder().encode('')).then(h => 
      Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
    ) + '\n' +
    '\n' +
    path;

  // Simplified signing for GET requests
  const signStr = accessId + token + timestamp;
  const sign = await createSign(accessId, accessSecret, timestamp, signStr);

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

  console.log(`Tuya API Request: ${method} ${path}`);

  const response = await fetch(`${TUYA_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  console.log('Tuya API Response:', JSON.stringify(data));

  if (!data.success) {
    throw new Error(`Tuya API error: ${data.msg} (code: ${data.code})`);
  }

  return data.result;
}

// Get all devices from Tuya Cloud
async function getDevices(accessId: string, accessSecret: string): Promise<unknown[]> {
  // First get the user ID from token
  const token = await getAccessToken(accessId, accessSecret);
  
  // Get devices using the user's home
  try {
    // Try to get devices directly via user
    const timestamp = Date.now().toString();
    const signStr = accessId + token + timestamp;
    const sign = await createSign(accessId, accessSecret, timestamp, signStr);

    // Get user info first
    const userResponse = await fetch(`${TUYA_API_BASE}/v1.0/token/${token}`, {
      method: 'GET',
      headers: {
        'client_id': accessId,
        'access_token': token,
        'sign': sign,
        'sign_method': 'HMAC-SHA256',
        't': timestamp,
      },
    });
    const userData = await userResponse.json();
    console.log('User data:', JSON.stringify(userData));

    if (userData.success && userData.result?.uid) {
      const uid = userData.result.uid;
      const devices = await tuyaRequest(accessId, accessSecret, 'GET', `/v1.0/users/${uid}/devices`);
      return devices as unknown[];
    }
  } catch (error) {
    console.error('Error getting devices via user:', error);
  }

  return [];
}

// Get device status
async function getDeviceStatus(accessId: string, accessSecret: string, deviceId: string): Promise<unknown> {
  return await tuyaRequest(accessId, accessSecret, 'GET', `/v1.0/devices/${deviceId}/status`);
}

// Set device temperature
async function setDeviceTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  temperature: number
): Promise<unknown> {
  // Temperature is usually in 0.1°C units for Tuya thermostats
  const tempValue = Math.round(temperature * 10);
  
  return await tuyaRequest(accessId, accessSecret, 'POST', `/v1.0/devices/${deviceId}/commands`, {
    commands: [
      { code: 'temp_set', value: tempValue }
    ]
  });
}

// Parse thermostat status from Tuya response
function parseThermostatStatus(status: unknown[]): { currentTemp: number; targetTemp: number; isHeating: boolean } {
  let currentTemp = 0;
  let targetTemp = 0;
  let isHeating = false;

  if (Array.isArray(status)) {
    for (const item of status) {
      const s = item as { code: string; value: unknown };
      switch (s.code) {
        case 'temp_current':
          currentTemp = Number(s.value) / 10;
          break;
        case 'temp_set':
          targetTemp = Number(s.value) / 10;
          break;
        case 'switch':
        case 'mode':
          if (s.value === 'heat' || s.value === true) {
            isHeating = true;
          }
          break;
        case 'work_state':
          isHeating = s.value === 'heating';
          break;
      }
    }
  }

  return { currentTemp, targetTemp, isHeating };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessId = Deno.env.get('TUYA_ACCESS_ID');
    const accessSecret = Deno.env.get('TUYA_ACCESS_SECRET');

    if (!accessId || !accessSecret) {
      throw new Error('Tuya credentials not configured');
    }

    const url = new URL(req.url);
    const path = url.pathname.replace('/tuya-control', '');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // GET /devices - List all Tuya devices
    if (req.method === 'GET' && path === '/devices') {
      console.log('Fetching Tuya devices...');
      const devices = await getDevices(accessId, accessSecret);
      
      return new Response(JSON.stringify({ success: true, devices }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /status - Get status for device(s)
    if (req.method === 'POST' && path === '/status') {
      const { deviceId } = await req.json();
      
      if (deviceId) {
        const status = await getDeviceStatus(accessId, accessSecret, deviceId);
        const parsed = parseThermostatStatus(status as unknown[]);
        
        return new Response(JSON.stringify({ success: true, status: parsed }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get status for all configured rooms
      const { data: rooms } = await supabase
        .from('rooms')
        .select('*')
        .not('tuya_device_id', 'is', null);

      const results = [];
      for (const room of rooms || []) {
        try {
          const status = await getDeviceStatus(accessId, accessSecret, room.tuya_device_id);
          const parsed = parseThermostatStatus(status as unknown[]);
          
          // Update room in database
          await supabase
            .from('rooms')
            .update({
              current_temp: parsed.currentTemp,
              target_temp: parsed.targetTemp,
              is_heating: parsed.isHeating,
              last_thermostat_sync: new Date().toISOString(),
            })
            .eq('id', room.id);

          results.push({ roomId: room.id, name: room.name, ...parsed });
        } catch (error) {
          console.error(`Error fetching status for room ${room.name}:`, error);
          results.push({ roomId: room.id, name: room.name, error: String(error) });
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /set-temp - Set temperature for a device
    if (req.method === 'POST' && path === '/set-temp') {
      const { deviceId, temperature, roomId } = await req.json();
      
      if (!deviceId || temperature === undefined) {
        throw new Error('deviceId and temperature are required');
      }

      await setDeviceTemperature(accessId, accessSecret, deviceId, temperature);

      // Update room in database if roomId provided
      if (roomId) {
        await supabase
          .from('rooms')
          .update({
            target_temp: temperature,
            last_thermostat_sync: new Date().toISOString(),
          })
          .eq('id', roomId);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /sync-all - Sync all thermostat statuses
    if (req.method === 'POST' && path === '/sync-all') {
      const { data: rooms } = await supabase
        .from('rooms')
        .select('*')
        .not('tuya_device_id', 'is', null);

      const results = [];
      for (const room of rooms || []) {
        try {
          const status = await getDeviceStatus(accessId, accessSecret, room.tuya_device_id);
          const parsed = parseThermostatStatus(status as unknown[]);

          await supabase
            .from('rooms')
            .update({
              current_temp: parsed.currentTemp,
              target_temp: parsed.targetTemp,
              is_heating: parsed.isHeating,
              last_thermostat_sync: new Date().toISOString(),
            })
            .eq('id', room.id);

          results.push({ roomId: room.id, name: room.name, ...parsed, synced: true });
        } catch (error) {
          console.error(`Error syncing room ${room.name}:`, error);
          results.push({ roomId: room.id, name: room.name, error: String(error), synced: false });
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
