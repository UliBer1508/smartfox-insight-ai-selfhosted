#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.anon_key);

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
    console.log(`Fetching Fronius: ${url}`);
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
    console.error('Fronius Fehler:', error.message);
    return null;
  }
}

// Save reading to database
async function saveReading(froniusData) {
  if (!froniusData) {
    console.log('Keine Fronius-Daten zum Speichern');
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
      console.error('Datenbank Fehler:', error.message);
      return false;
    }
    
    console.log(`Gespeichert: Grid=${reading.power_io}W, PV=${reading.pv_power}W, Verbrauch=${reading.consumption}W, Batterie=${reading.battery_soc}%, BattPower=${reading.battery_power}W`);
    return true;
  } catch (error) {
    console.error('Speichern fehlgeschlagen:', error.message);
    return false;
  }
}

// Main polling loop
async function poll() {
  console.log(`\n${new Date().toLocaleTimeString()} - Fronius-Daten abrufen...`);
  
  const froniusData = await fetchFroniusData();
  
  if (froniusData) {
    await saveReading(froniusData);
  } else {
    console.log('Keine Daten von Fronius erhalten');
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
      console.log('Polling-Intervall aus config.json verwenden');
      return config.polling_interval_seconds;
    }
    
    return data.polling_interval_seconds;
  } catch (error) {
    return config.polling_interval_seconds;
  }
}

// Startup
async function main() {
  console.log('========================================');
  console.log('   Fronius Collector v2.0              ');
  console.log('========================================');
  console.log('');
  console.log(`Fronius: ${config.fronius.ip}`);
  console.log('');
  console.log('Druecke Strg+C zum Beenden');
  console.log('----------------------------------------');
  
  // Test database connection
  try {
    const { error } = await supabase.from('energy_readings').select('id').limit(1);
    if (error) throw error;
    console.log('Datenbank-Verbindung erfolgreich');
  } catch (error) {
    console.error('Datenbank-Verbindung fehlgeschlagen:', error.message);
    console.error('   Bitte ueberpruefe die Supabase-Konfiguration in config.json');
    process.exit(1);
  }
  
  // Get polling interval from database or config
  const pollingInterval = await getPollingInterval();
  console.log(`Intervall: ${pollingInterval} Sekunden`);
  
  // Initial poll
  await poll();
  
  // Start polling loop
  setInterval(poll, pollingInterval * 1000);
  
  // Check for interval changes every 5 minutes
  setInterval(async () => {
    const newInterval = await getPollingInterval();
    if (newInterval !== pollingInterval) {
      console.log(`\nPolling-Intervall geaendert auf ${newInterval}s. Bitte Collector neu starten.`);
    }
  }, 5 * 60 * 1000);
}

main().catch(console.error);
