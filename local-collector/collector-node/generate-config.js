#!/usr/bin/env node

/**
 * Config-Generator fuer den Fronius + Tuya Collector
 * 
 * Liest Thermostat-Daten aus der rooms-Tabelle und generiert config.json
 * 
 * Aufruf: node generate-config.js --fronius-ip 192.168.188.64
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase-Verbindung (gleiche Credentials wie Collector)
const SUPABASE_URL = 'https://tvqmhdpcixkfsudxughs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cW1oZHBjaXhrZnN1ZHh1Z2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NjAxODQsImV4cCI6MjA4MTMzNjE4NH0.3WDZXuxGECexP_wjvmK5QTFvJakMW2-SLs7FRzxoFKI';

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let froniusIp = '192.168.188.64'; // Default
  
  const ipIndex = args.indexOf('--fronius-ip');
  if (ipIndex !== -1 && args[ipIndex + 1]) {
    froniusIp = args[ipIndex + 1];
  }
  
  console.log('========================================');
  console.log('   Config-Generator v1.0');
  console.log('========================================');
  console.log(`Fronius IP: ${froniusIp}`);
  console.log('');
  
  // Supabase-Abfrage
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('id, name, tuya_device_id, local_key, thermostat_local_ip')
    .not('tuya_device_id', 'is', null);
  
  if (error) {
    console.error('Datenbankfehler:', error.message);
    process.exit(1);
  }
  
  if (!rooms?.length) {
    console.error('Keine Raeume mit tuya_device_id gefunden!');
    process.exit(1);
  }
  
  console.log(`${rooms.length} Thermostate in der Datenbank gefunden\n`);
  
  // Devices zusammenbauen
  const devices = [];
  let warnings = 0;
  
  for (const room of rooms) {
    if (!room.thermostat_local_ip) {
      console.warn(`⚠  ${room.name}: Keine lokale IP eingetragen (thermostat_local_ip ist null)`);
      warnings++;
      continue;
    }
    
    if (!room.local_key) {
      console.warn(`⚠  ${room.name}: Kein Local Key vorhanden`);
      warnings++;
      continue;
    }
    
    devices.push({
      name: room.name,
      room_id: room.id,
      device_id: room.tuya_device_id,
      local_key: room.local_key,
      ip: room.thermostat_local_ip
    });
    
    console.log(`✓  ${room.name}: ${room.thermostat_local_ip}`);
  }
  
  console.log('');
  
  // Config-Objekt
  const config = {
    fronius: {
      ip: froniusIp
    },
    tuya: {
      enabled: devices.length > 0,
      sync_interval_seconds: 60,
      devices: devices
    },
    polling_interval_seconds: 30,
    supabase: {
      url: SUPABASE_URL,
      anon_key: SUPABASE_KEY
    }
  };
  
  // Schreiben
  const configPath = path.join(process.cwd(), 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  console.log(`✓  config.json geschrieben (${devices.length} Geraete)`);
  
  if (warnings > 0) {
    console.log(`\n⚠  ${warnings} Raeume uebersprungen (fehlende IP oder Local Key)`);
    console.log('   Trage die IPs per SQL ein:');
    console.log("   UPDATE rooms SET thermostat_local_ip = '192.168.188.XXX' WHERE name = 'RAUMNAME';");
  }
  
  console.log('\nNaechster Schritt: npm start');
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
