#!/usr/bin/env node

/**
 * Fronius + Tuya Local Collector v3.0
 * 
 * Sammelt Energiedaten von Fronius und steuert Thermostate lokal über TuyAPI
 */

const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

// TCP-Preflight: prüft ob Tuya Port 6668 in <1s erreichbar ist
function tcpProbe(ip, port = 6668, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) {}
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

// Verarbeitet ein Array in Batches von N parallel
async function runInBatches(items, batchSize, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(worker));
    results.push(...batchResults);
  }
  return results;
}

// Load configuration
let config;
try {
  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('config.json nicht gefunden!');
    console.error('   Bitte kopiere config.example.json zu config.json und passe die Werte an.');
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Fehler beim Laden der Konfiguration:', error.message);
  process.exit(1);
}

// Initialize Supabase client (service_role key bypasses RLS for collector access)
const supabaseKey = config.supabase.service_role_key || config.supabase.anon_key;
const supabase = createClient(config.supabase.url, supabaseKey);

// Initialize Thermostat Controller (wenn aktiviert)
let thermostatCtrl = null;
if (config.tuya?.enabled) {
  try {
    const ThermostatController = require('./tuya-thermostat');
    thermostatCtrl = new ThermostatController();
    console.log('[Init] TuyAPI Thermostat-Controller geladen');
  } catch (error) {
    console.error('[Init] TuyAPI nicht verfuegbar:', error.message);
    console.error('   Installiere mit: npm install tuyapi');
  }
}

let lastThermostatSync = 0;
let lastAutomationTrigger = 0;
let lastModeCheck = 0;
const AUTOMATION_INTERVAL_MS = 2 * 60 * 1000; // 2 Minuten
const MODE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // alle 5min Mode neu prüfen

// Aktueller Tuya-Steuermodus ('cloud' | 'local'). Default cloud → keine ML-Datenverdichtung.
let currentMode = 'cloud';
// Letzter bekannter Heizstatus pro room_id für Event-Detection (nur Lokalmodus)
const lastHeatingState = new Map(); // room_id → { is_heating, since_ts, current_temp }
// Letztes PV-Power-Reading (für Sample-Anreicherung)
let lastPvPower = null;

async function refreshControlMode() {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'tuya_control_mode')
      .maybeSingle();
    if (error) return;
    const v = data?.value;
    const mode = (typeof v === 'string' ? v : v?.mode) || 'cloud';
    if (mode !== currentMode) {
      console.log(`[Mode] Steuermodus gewechselt: ${currentMode} → ${mode}`);
      currentMode = mode;
      if (mode !== 'local') {
        // Reset Heating-State-Cache bei Wechsel weg von local
        lastHeatingState.clear();
      }
    }
  } catch (_) { /* ignore */ }
}
// HTTP GET request helper
function httpGet(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Fetch data from Fronius
async function fetchFroniusData() {
  try {
    const url = `http://${config.fronius.ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`;
    const data = await httpGet(url);
    
    const site = data?.Body?.Data?.Site || {};
    const inverters = data?.Body?.Data?.Inverters || {};
    
    // Get battery SOC from first inverter
    let batterySoc = null;
    for (const key in inverters) {
      if (inverters[key].SOC !== undefined) {
        batterySoc = inverters[key].SOC;
        break;
      }
    }
    
    return {
      battery_soc: batterySoc,
      pv_power: site.P_PV || 0,
      grid_power: site.P_Grid || 0,
      load_power: Math.abs(site.P_Load || 0),
      battery_power: site.P_Akku !== undefined ? site.P_Akku : null
    };
  } catch (error) {
    console.error('[Fronius] Fehler:', error.message);
    return null;
  }
}

// Save reading to database
async function saveReading(froniusData) {
  if (!froniusData) {
    return false;
  }

  const reading = {
    timestamp: new Date().toISOString(),
    power_io: froniusData.grid_power,
    energy_in: 0,
    energy_out: 0,
    battery_soc: froniusData.battery_soc,
    pv_power: froniusData.pv_power,
    consumption: froniusData.load_power,
    battery_power: froniusData.battery_power
  };
  
  try {
    const { error } = await supabase
      .from('energy_readings')
      .insert(reading);
    
    if (error) {
      console.error('[DB] Fehler:', error.message);
      return false;
    }
    
    console.log(`[Fronius] Grid=${reading.power_io}W, PV=${reading.pv_power}W, Verbrauch=${reading.consumption}W, Batterie=${reading.battery_soc}%`);
    return true;
  } catch (error) {
    console.error('[DB] Speichern fehlgeschlagen:', error.message);
    return false;
  }
}

// Sync all thermostats and update database
async function syncThermostats() {
  if (!thermostatCtrl || !config.tuya?.devices?.length) return;
  
  const total = config.tuya.devices.length;
  console.log(`[Tuya] ${total} Thermostate synchronisieren (TCP-Preflight + Batches á 3)...`);
  const startedAt = Date.now();

  // 1. TCP-Preflight: alle Geräte parallel in <1s prüfen
  const reachability = await Promise.all(
    config.tuya.devices.map(async (d) => ({
      device: d,
      online: await tcpProbe(d.ip, 6668, 1000)
    }))
  );

  const online = reachability.filter(r => r.online);
  const offline = reachability.filter(r => !r.online);

  // Offline-Geräte sofort als Fehler loggen
  for (const { device } of offline) {
    console.error(`[Tuya] ${device.name}: offline (TCP 6668 unerreichbar)`);
    await supabase.from('api_errors').insert({
      source: 'tuya-local',
      error_type: 'device_offline',
      error_message: 'TCP 6668 unerreichbar (Preflight)',
      device_id: device.device_id,
      room_name: device.name
    });
  }

  // 2. Online-Geräte in Batches á 3 parallel verarbeiten
  const results = await runInBatches(online.map(r => r.device), 3, async (deviceConfig) => {
    const status = await thermostatCtrl.getStatus(deviceConfig);

    if (status.success) {
      const { error } = await supabase.from('rooms').update({
        current_temp: status.current_temp,
        target_temp: status.target_temp,
        is_heating: status.is_heating,
        last_thermostat_sync: new Date().toISOString()
      }).eq('id', deviceConfig.room_id);

      if (!error) {
        console.log(`[Tuya] ${deviceConfig.name}: ${status.current_temp}°C -> ${status.target_temp}°C (Heizen: ${status.is_heating ? 'Ja' : 'Nein'})`);
        return { name: deviceConfig.name, ok: true };
      }
      console.error(`[Tuya] ${deviceConfig.name} DB-Update Fehler:`, error.message);
      return { name: deviceConfig.name, ok: false, error: error.message };
    }

    console.error(`[Tuya] ${deviceConfig.name}: ${status.error}`);
    await supabase.from('api_errors').insert({
      source: 'tuya-local',
      error_type: 'connection_error',
      error_message: status.error,
      device_id: deviceConfig.device_id,
      room_name: deviceConfig.name
    });
    return { name: deviceConfig.name, ok: false, error: status.error };
  });

  const ok = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  const fail = total - ok;
  const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[Tuya] Sync fertig in ${dur}s — OK: ${ok}/${total}, Fehler: ${fail} (offline: ${offline.length})`);
}

// Process pending commands from PWA
async function processCommands() {
  if (!thermostatCtrl || !config.tuya?.devices?.length) return;
  
  // Fetch pending commands with room info
  const { data: commands, error } = await supabase
    .from('thermostat_commands')
    .select('*, rooms(tuya_device_id, name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('[Commands] Fehler beim Laden:', error.message);
    return;
  }
  
  if (!commands?.length) return;
  
  console.log(`[Commands] ${commands.length} Befehle verarbeiten...`);
  
  for (const cmd of commands) {
    // Find device config by tuya_device_id from rooms table
    const deviceConfig = config.tuya.devices.find(
      d => d.device_id === cmd.rooms?.tuya_device_id
    );
    
    if (!deviceConfig) {
      // Try to find by room_id directly from config
      const altDeviceConfig = config.tuya.devices.find(
        d => d.room_id === cmd.room_id
      );
      
      if (!altDeviceConfig) {
        await supabase.from('thermostat_commands').update({
          status: 'failed',
          error_message: 'Device nicht in config.json konfiguriert',
          executed_at: new Date().toISOString()
        }).eq('id', cmd.id);
        console.error(`[Commands] Device fuer Room ${cmd.room_id} nicht gefunden`);
        continue;
      }
      
      // Use alt config
      Object.assign(deviceConfig || {}, altDeviceConfig);
    }
    
    const targetDevice = deviceConfig || config.tuya.devices.find(d => d.room_id === cmd.room_id);
    
    if (!targetDevice) {
      await supabase.from('thermostat_commands').update({
        status: 'failed',
        error_message: 'Device nicht konfiguriert',
        executed_at: new Date().toISOString()
      }).eq('id', cmd.id);
      continue;
    }
    
    // Mark as executing
    await supabase.from('thermostat_commands').update({
      status: 'executing'
    }).eq('id', cmd.id);
    
    let result = { success: false, error: 'Unknown command' };
    
    // Execute command
    switch (cmd.command) {
      case 'set_temp':
        result = await thermostatCtrl.setTemperature(targetDevice, cmd.value);
        break;
      case 'set_mode':
        result = await thermostatCtrl.setMode(targetDevice, cmd.value);
        break;
      default:
        result = { success: false, error: `Unbekannter Befehl: ${cmd.command}` };
    }
    
    // Update command status
    await supabase.from('thermostat_commands').update({
      status: result.success ? 'executed' : 'failed',
      error_message: result.error || null,
      executed_at: new Date().toISOString()
    }).eq('id', cmd.id);
    
    if (result.success) {
      console.log(`[Commands] Ausgefuehrt: ${targetDevice.name} -> ${cmd.command}=${cmd.value}`);
      
      // Resolve any existing errors for this device
      await supabase.from('api_errors').update({
        resolved_at: new Date().toISOString()
      }).eq('device_id', targetDevice.device_id).is('resolved_at', null);
    } else {
      console.error(`[Commands] Fehlgeschlagen: ${targetDevice.name} -> ${result.error}`);
    }
  }
}

// Trigger pv-automation Edge Function
async function triggerPvAutomation() {
  try {
    const url = `${config.supabase.url}/functions/v1/pv-automation`;
    const https = require('https');
    const postData = JSON.stringify({ action: 'check' });
    
    return new Promise((resolve) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabase.anon_key}`,
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[PV-Auto] Edge Function erfolgreich aufgerufen');
          } else {
            console.error(`[PV-Auto] Fehler: HTTP ${res.statusCode}`);
          }
          resolve();
        });
      });
      req.on('error', (err) => {
        console.error('[PV-Auto] Aufruf fehlgeschlagen:', err.message);
        resolve();
      });
      req.on('timeout', () => {
        req.destroy();
        console.error('[PV-Auto] Timeout');
        resolve();
      });
      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('[PV-Auto] Fehler:', error.message);
  }
}

// Main polling loop
async function poll() {
  const now = Date.now();
  
  console.log(`\n${new Date().toLocaleTimeString()} - Polling...`);
  
  // Fronius-Daten abrufen (jedes Mal)
  const froniusData = await fetchFroniusData();
  if (froniusData) {
    await saveReading(froniusData);
  }
  
  // Thermostat-Befehle verarbeiten (jedes Mal, für schnelle Reaktion)
  await processCommands();
  
  // PV-Automation triggern (alle 2 Minuten)
  if (now - lastAutomationTrigger >= AUTOMATION_INTERVAL_MS) {
    await triggerPvAutomation();
    lastAutomationTrigger = now;
  }
  
  // Thermostate synchronisieren (alle X Sekunden)
  const syncInterval = (config.tuya?.sync_interval_seconds || 60) * 1000;
  if (now - lastThermostatSync >= syncInterval) {
    await syncThermostats();
    lastThermostatSync = now;
  }
}

// Fetch polling interval from database
async function getPollingInterval() {
  try {
    const { data, error } = await supabase
      .from('data_retention_settings')
      .select('polling_interval_seconds')
      .limit(1)
      .single();
    
    if (error || !data) {
      return config.polling_interval_seconds;
    }
    
    return data.polling_interval_seconds;
  } catch (error) {
    return config.polling_interval_seconds;
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\n[Shutdown] Beende Collector...');
  
  if (thermostatCtrl) {
    await thermostatCtrl.disconnectAll();
  }
  
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Startup
async function main() {
  console.log('========================================');
  console.log('   Fronius + Tuya Collector v3.0       ');
  console.log('========================================');
  console.log('');
  console.log(`Fronius: ${config.fronius.ip}`);
  
  if (config.tuya?.enabled && thermostatCtrl) {
    console.log(`Tuya: ${config.tuya.devices?.length || 0} Thermostate konfiguriert (lokal)`);
  } else if (config.tuya?.enabled) {
    console.log('Tuya: Aktiviert aber TuyAPI nicht installiert');
  } else {
    console.log('Tuya: Deaktiviert');
  }
  
  console.log('');
  console.log('Druecke Strg+C zum Beenden');
  console.log('----------------------------------------');
  
  // Test database connection
  try {
    const { error } = await supabase.from('energy_readings').select('id').limit(1);
    if (error) throw error;
    console.log('[DB] Verbindung erfolgreich');
  } catch (error) {
    console.error('[DB] Verbindung fehlgeschlagen:', error.message);
    console.error('   Bitte ueberpruefe die Supabase-Konfiguration in config.json');
    process.exit(1);
  }
  
  // Get polling interval from database or config
  const pollingInterval = await getPollingInterval();
  console.log(`[Config] Polling-Intervall: ${pollingInterval} Sekunden`);
  
  if (config.tuya?.enabled) {
    console.log(`[Config] Thermostat-Sync: alle ${config.tuya.sync_interval_seconds || 60} Sekunden`);
  }
  
  // Initial poll
  await poll();
  
  // Start polling loop
  setInterval(poll, pollingInterval * 1000);
  
  // Check for interval changes every 5 minutes
  setInterval(async () => {
    const newInterval = await getPollingInterval();
    if (newInterval !== pollingInterval) {
      console.log(`\n[Config] Polling-Intervall geaendert auf ${newInterval}s. Bitte Collector neu starten.`);
    }
  }, 5 * 60 * 1000);
}

main().catch(console.error);
