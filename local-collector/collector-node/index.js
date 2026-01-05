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
    console.error('❌ config.json nicht gefunden!');
    console.error('   Bitte kopiere config.example.json zu config.json und passe die IP-Adressen an.');
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('❌ Fehler beim Laden der Konfiguration:', error.message);
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

// Fetch data from Smartfox
async function fetchSmartfoxData() {
  if (!config.smartfox.enabled) return null;
  
  try {
    const url = `http://${config.smartfox.ip}/all`;
    console.log(`📡 Fetching Smartfox: ${url}`);
    const data = await httpGet(url);
    
    // Calculate power_io (positive = import, negative = export)
    const powerIn = data.power_in || 0;
    const powerOut = data.power_out || 0;
    const powerIo = powerIn - powerOut;
    
    // Calculate PV power from array
    const pvPower = Array.isArray(data.PvPower) 
      ? data.PvPower.reduce((sum, p) => sum + (p || 0), 0) 
      : 0;
    
    return {
      power_io: powerIo,
      energy_in: data.energy_in || 0,
      energy_out: data.energy_out || 0,
      pv_power: pvPower,
      consumption: pvPower + powerIo // consumption = PV + grid import (or - grid export)
    };
  } catch (error) {
    console.error('❌ Smartfox Fehler:', error.message);
    return null;
  }
}

// Fetch data from Fronius
async function fetchFroniusData() {
  if (!config.fronius.enabled) return null;
  
  try {
    const url = `http://${config.fronius.ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`;
    console.log(`📡 Fetching Fronius: ${url}`);
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
      grid_power: site.P_Grid || 0, // positive = import, negative = export
      load_power: Math.abs(site.P_Load || 0),
      battery_power: site.P_Akku || 0
    };
  } catch (error) {
    console.error('❌ Fronius Fehler:', error.message);
    return null;
  }
}

// Save reading to database
async function saveReading(smartfoxData, froniusData) {
  // Combine data from both sources
  const reading = {
    timestamp: new Date().toISOString(),
    power_io: smartfoxData?.power_io ?? froniusData?.grid_power ?? 0,
    energy_in: smartfoxData?.energy_in ?? 0,
    energy_out: smartfoxData?.energy_out ?? 0,
    battery_soc: froniusData?.battery_soc ?? null,
    pv_power: smartfoxData?.pv_power ?? froniusData?.pv_power ?? null,
    consumption: smartfoxData?.consumption ?? froniusData?.load_power ?? null
  };
  
  try {
    const { error } = await supabase
      .from('energy_readings')
      .insert(reading);
    
    if (error) {
      console.error('❌ Datenbank Fehler:', error.message);
      return false;
    }
    
    console.log(`✅ Daten gespeichert: Power=${reading.power_io}W, PV=${reading.pv_power}W, Battery=${reading.battery_soc}%`);
    return true;
  } catch (error) {
    console.error('❌ Speichern fehlgeschlagen:', error.message);
    return false;
  }
}

// Main polling loop
async function poll() {
  console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Daten abrufen...`);
  
  const [smartfoxData, froniusData] = await Promise.all([
    fetchSmartfoxData(),
    fetchFroniusData()
  ]);
  
  if (smartfoxData || froniusData) {
    await saveReading(smartfoxData, froniusData);
  } else {
    console.log('⚠️ Keine Daten von Smartfox oder Fronius erhalten');
  }
}

// Startup
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Smartfox/Fronius Collector v1.0              ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📍 Smartfox: ${config.smartfox.enabled ? config.smartfox.ip : 'deaktiviert'}`);
  console.log(`📍 Fronius:  ${config.fronius.enabled ? config.fronius.ip : 'deaktiviert'}`);
  console.log(`⏱️  Intervall: ${config.polling_interval_seconds} Sekunden`);
  console.log('');
  console.log('Drücke Strg+C zum Beenden');
  console.log('─'.repeat(50));
  
  // Test database connection
  try {
    const { error } = await supabase.from('energy_readings').select('id').limit(1);
    if (error) throw error;
    console.log('✅ Datenbank-Verbindung erfolgreich');
  } catch (error) {
    console.error('❌ Datenbank-Verbindung fehlgeschlagen:', error.message);
    console.error('   Bitte überprüfe die Supabase-Konfiguration in config.json');
    process.exit(1);
  }
  
  // Initial poll
  await poll();
  
  // Start polling loop
  setInterval(poll, config.polling_interval_seconds * 1000);
}

main().catch(console.error);
