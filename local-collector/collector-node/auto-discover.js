#!/usr/bin/env node

/**
 * Tuya Auto-Discovery v1.0
 * 
 * Scannt alle bekannten Thermostat-IPs, liest die Device-ID aus
 * und ordnet sie automatisch den Raeumen in der Datenbank zu.
 * 
 * Aufruf: node auto-discover.js
 */

const TuyAPI = require('tuyapi');
const net = require('net');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tvqmhdpcixkfsudxughs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cW1oZHBjaXhrZnN1ZHh1Z2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NjAxODQsImV4cCI6MjA4MTMzNjE4NH0.3WDZXuxGECexP_wjvmK5QTFvJakMW2-SLs7FRzxoFKI';

// Alle bekannten Thermostat-IPs aus dem Netzwerk
const THERMOSTAT_IPS = [
  '192.168.188.42',
  '192.168.188.43',
  '192.168.188.68',
  '192.168.188.78',
  '192.168.188.79',
  '192.168.188.107',
  '192.168.188.114',
  '192.168.188.171',
  '192.168.188.173',
  '192.168.188.186',
  '192.168.188.197'
];

const TUYA_PORT = 6668;
const PORT_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 5000;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Schneller TCP-Port-Check
 */
function checkPort(ip, port = TUYA_PORT, timeout = PORT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const done = (open) => {
      if (!resolved) { resolved = true; socket.destroy(); resolve(open); }
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, ip);
  });
}

/**
 * Versucht sich mit einer IP und einem bestimmten Local Key zu verbinden.
 * Gibt bei Erfolg die Device-ID zurueck, sonst null.
 */
function tryConnect(ip, deviceId, localKey) {
  return new Promise(async (resolve) => {
    const device = new TuyAPI({
      id: deviceId,
      key: localKey,
      ip: ip,
      version: '3.3',
      issueRefreshOnConnect: true
    });

    const timer = setTimeout(() => {
      try { device.disconnect(); } catch (e) {}
      resolve(null);
    }, CONNECT_TIMEOUT_MS);

    device.on('error', () => {});

    try {
      await device.find({ timeout: 3 });
      await device.connect();
      const status = await device.get({ schema: true });
      clearTimeout(timer);
      
      // Erfolg! Device-ID ist die, mit der wir uns verbunden haben
      try { await device.disconnect(); } catch (e) {}
      resolve(deviceId);
    } catch (err) {
      clearTimeout(timer);
      try { device.disconnect(); } catch (e) {}
      resolve(null);
    }
  });
}

async function main() {
  console.log('========================================');
  console.log('   Tuya Auto-Discovery v1.0');
  console.log('========================================');
  console.log('');

  // 1. Raeume aus DB laden
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('id, name, tuya_device_id, local_key, thermostat_local_ip')
    .not('tuya_device_id', 'is', null)
    .not('local_key', 'is', null);

  if (error) {
    console.error(`${colors.red}Datenbankfehler:${colors.reset}`, error.message);
    process.exit(1);
  }

  if (!rooms?.length) {
    console.error(`${colors.red}Keine Raeume mit tuya_device_id und local_key gefunden!${colors.reset}`);
    process.exit(1);
  }

  console.log(`Lade ${rooms.length} Raeume aus der Datenbank...`);
  console.log('');

  // Map: device_id -> room
  const deviceRoomMap = new Map();
  for (const room of rooms) {
    deviceRoomMap.set(room.tuya_device_id, room);
  }

  // Alle bekannten device_id + local_key Paare
  const knownDevices = rooms.map(r => ({
    device_id: r.tuya_device_id,
    local_key: r.local_key,
    name: r.name
  }));

  // 2. Port-Check fuer alle IPs
  console.log(`Pruefe Port ${TUYA_PORT} auf ${THERMOSTAT_IPS.length} IPs...`);
  const portResults = await Promise.all(
    THERMOSTAT_IPS.map(async ip => ({ ip, open: await checkPort(ip) }))
  );

  const reachableIps = portResults.filter(r => r.open).map(r => r.ip);
  const unreachableIps = portResults.filter(r => !r.open).map(r => r.ip);

  console.log(`  ${colors.green}${reachableIps.length} erreichbar${colors.reset}, ${colors.red}${unreachableIps.length} nicht erreichbar${colors.reset}`);
  
  for (const ip of unreachableIps) {
    console.log(`  ${ip.padEnd(20)} ${colors.red}[PORT GESCHLOSSEN]${colors.reset}`);
  }
  console.log('');

  // 3. Fuer jede erreichbare IP: Alle device_id/key Paare durchprobieren
  console.log(`Scanne ${reachableIps.length} erreichbare IPs...`);
  console.log('');

  let matched = 0;
  let skipped = 0;
  const results = [];

  for (const ip of reachableIps) {
    let found = false;

    for (const dev of knownDevices) {
      process.stdout.write(`  ${ip.padEnd(20)} Teste ${dev.name}... \r`);
      
      const result = await tryConnect(ip, dev.device_id, dev.local_key);
      
      if (result) {
        // Match gefunden!
        const room = deviceRoomMap.get(result);
        if (room) {
          // IP in DB schreiben
          const { error: updateError } = await supabase
            .from('rooms')
            .update({ thermostat_local_ip: ip })
            .eq('id', room.id);

          if (updateError) {
            console.log(`  ${ip.padEnd(20)} ${colors.red}DB-Fehler: ${updateError.message}${colors.reset}`);
          } else {
            const shortId = room.tuya_device_id.substring(0, 10) + '...';
            console.log(`  ${ip.padEnd(20)} -> ${room.name.padEnd(20)} (${shortId})   ${colors.green}[ZUGEORDNET]${colors.reset}`);
            matched++;
            results.push({ ip, room: room.name, status: 'matched' });
          }
          found = true;
          break;
        }
      }
      
      // Kurze Pause zwischen Versuchen
      await sleep(500);
    }

    if (!found) {
      console.log(`  ${ip.padEnd(20)} -> Kein Match in der Datenbank              ${colors.yellow}[UEBERSPRUNGEN]${colors.reset}`);
      skipped++;
      results.push({ ip, room: null, status: 'no_match' });
    }
  }

  // 4. Zusammenfassung
  console.log('');
  console.log('========================================');
  console.log(`Ergebnis: ${matched}/${reachableIps.length} IPs zugeordnet, ${skipped} ohne Match`);
  
  if (unreachableIps.length > 0) {
    console.log(`${colors.yellow}${unreachableIps.length} IPs waren nicht erreichbar (Port ${TUYA_PORT} geschlossen)${colors.reset}`);
  }

  if (matched > 0) {
    console.log(`${colors.green}thermostat_local_ip fuer ${matched} Raeume aktualisiert${colors.reset}`);
  }

  if (matched === 0) {
    console.log('');
    console.log(`${colors.yellow}Keine Zuordnungen gefunden. Moegliche Gruende:${colors.reset}`);
    console.log('  - Local Keys stimmen nicht (neu abrufen mit TinyTuya)');
    console.log('  - Geraete antworten nicht (Firmware-Update?)');
    console.log('  - Timeout zu kurz (CONNECT_TIMEOUT_MS erhoehen)');
  }

  console.log('========================================');
}

main().catch(err => {
  console.error(`${colors.red}Fehler:${colors.reset}`, err.message);
  process.exit(1);
});
