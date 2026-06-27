#!/usr/bin/env node

/**
 * Config-Generator fuer den Tuya Thermostat Service
 * Liest Thermostat-Daten aus der rooms-Tabelle und generiert config.json
 * 
 * Aufruf: node generate-config.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://pflnniklvqbwjwrjswaz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbG5uaWtsdnFid2p3cmpzd2F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDA3MjcsImV4cCI6MjA5NzkxNjcyN30.RADpIsCnV8ZgwozN6EfewE_ARWyKW7s9pmEWJe07uYA';

async function main() {
  console.log('========================================');
  console.log('   Tuya Config-Generator v1.0');
  console.log('========================================');
  console.log('');

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

  const devices = [];
  let warnings = 0;

  for (const room of rooms) {
    if (!room.thermostat_local_ip) {
      console.warn(`  ⚠  ${room.name}: Keine lokale IP (thermostat_local_ip ist null)`);
      warnings++;
      continue;
    }
    if (!room.local_key) {
      console.warn(`  ⚠  ${room.name}: Kein Local Key`);
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

    console.log(`  ✓  ${room.name}: ${room.thermostat_local_ip}`);
  }

  console.log('');

  const configObj = {
    tuya: {
      sync_interval_seconds: 60,
      command_poll_seconds: 5,
      devices: devices
    },
    supabase: {
      url: SUPABASE_URL,
      anon_key: SUPABASE_KEY
    }
  };

  const configPath = path.join(process.cwd(), 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2));

  console.log(`✓  config.json geschrieben (${devices.length} Geraete)`);

  if (warnings > 0) {
    console.log(`\n⚠  ${warnings} Raeume uebersprungen (fehlende IP oder Local Key)`);
    console.log('   Fuehre auto-discover.js aus oder trage IPs manuell ein.');
  }

  console.log('\nNaechster Schritt: npm start');
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
