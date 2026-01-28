#!/usr/bin/env node

/**
 * Tuya Port-Test v1.0
 * 
 * Testet ob die Thermostate ueber Port 6668 (TuyAPI LAN-Port) erreichbar sind.
 * Benoetigt KEINE Local Keys und KEINE Tuya Cloud API.
 * 
 * Verwendung:
 *   node test-tuya.js           - Alle IPs testen
 *   node test-tuya.js <IP>      - Einzelne IP testen
 *   node test-tuya.js scan      - UDP Discovery
 */

const net = require('net');
const dgram = require('dgram');

// Bekannte Thermostat-IPs (aus Router DHCP-Liste, MAC-Praefix 3C:0B:59)
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
const TIMEOUT_MS = 3000;

// ANSI Farben fuer Terminal-Ausgabe
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

/**
 * Testet ob ein Port auf einer IP erreichbar ist
 */
function testPort(ip, port = TUYA_PORT, timeout = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      cleanup();
      resolve({ ip, port, open: true });
    });

    socket.on('timeout', () => {
      cleanup();
      resolve({ ip, port, open: false, reason: 'timeout' });
    });

    socket.on('error', (err) => {
      cleanup();
      resolve({ ip, port, open: false, reason: err.code || err.message });
    });

    socket.connect(port, ip);
  });
}

/**
 * Testet alle IPs parallel
 */
async function testAllPorts() {
  console.log('');
  console.log(`${colors.cyan}Teste ${THERMOSTAT_IPS.length} Thermostat-IPs auf Port ${TUYA_PORT}...${colors.reset}`);
  console.log('');

  const results = await Promise.all(
    THERMOSTAT_IPS.map(ip => testPort(ip))
  );

  // Ergebnisse sortiert nach IP ausgeben
  results.sort((a, b) => {
    const aParts = a.ip.split('.').map(Number);
    const bParts = b.ip.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
    }
    return 0;
  });

  for (const result of results) {
    const ipPadded = `${result.ip}:${result.port}`.padEnd(22);
    if (result.open) {
      console.log(`  ${ipPadded} ${colors.green}[OFFEN]${colors.reset}     Lokale API verfuegbar`);
    } else {
      const reason = result.reason === 'timeout' ? 'Timeout' : 
                     result.reason === 'ECONNREFUSED' ? 'Verbindung abgelehnt' :
                     result.reason || 'Unbekannt';
      console.log(`  ${ipPadded} ${colors.red}[GESCHL.]${colors.reset}   ${colors.dim}${reason}${colors.reset}`);
    }
  }

  // Zusammenfassung
  const openCount = results.filter(r => r.open).length;
  console.log('');
  console.log('========================================');
  console.log(`Ergebnis: ${openCount}/${results.length} Geraete erreichbar`);
  console.log('');

  if (openCount === results.length) {
    console.log(`${colors.green}Alle Thermostate unterstuetzen lokale LAN-Steuerung!${colors.reset}`);
    console.log('Naechster Schritt: Local Keys mit TinyTuya abrufen');
  } else if (openCount > 0) {
    console.log(`${colors.yellow}Einige Thermostate sind erreichbar.${colors.reset}`);
    console.log('Prüfe Netzwerk/Firewall fuer die anderen.');
  } else {
    console.log(`${colors.red}Keine Thermostate erreichbar.${colors.reset}`);
    console.log('Moegliche Gruende:');
    console.log('  - Nicht im gleichen Netzwerk');
    console.log('  - Firewall blockiert Port 6668');
    console.log('  - Thermostate offline');
    console.log('  - IPs haben sich geaendert');
  }
  console.log('========================================');

  return results;
}

/**
 * UDP Discovery - findet Tuya-Geraete im Netzwerk
 */
function udpScan(duration = 5000) {
  console.log('');
  console.log(`${colors.cyan}UDP Discovery gestartet (${duration/1000}s)...${colors.reset}`);
  console.log('Lausche auf Ports 6666 und 6667...');
  console.log('');

  const devices = new Map();

  // Port 6666 - unverschluesselte Broadcasts
  const socket6666 = dgram.createSocket('udp4');
  socket6666.on('message', (msg, rinfo) => {
    if (!devices.has(rinfo.address)) {
      devices.set(rinfo.address, { port: 6666, data: msg.toString('hex').substring(0, 40) });
      console.log(`  ${colors.green}Gefunden:${colors.reset} ${rinfo.address}:${rinfo.port} (Port 6666)`);
    }
  });
  socket6666.on('error', () => {});
  socket6666.bind(6666);

  // Port 6667 - verschluesselte Broadcasts
  const socket6667 = dgram.createSocket('udp4');
  socket6667.on('message', (msg, rinfo) => {
    if (!devices.has(rinfo.address)) {
      devices.set(rinfo.address, { port: 6667, data: msg.toString('hex').substring(0, 40) });
      console.log(`  ${colors.green}Gefunden:${colors.reset} ${rinfo.address}:${rinfo.port} (Port 6667)`);
    }
  });
  socket6667.on('error', () => {});
  socket6667.bind(6667);

  return new Promise((resolve) => {
    setTimeout(() => {
      socket6666.close();
      socket6667.close();

      console.log('');
      console.log('========================================');
      console.log(`UDP Scan beendet: ${devices.size} Geraet(e) gefunden`);
      
      if (devices.size === 0) {
        console.log('');
        console.log(`${colors.yellow}Keine UDP-Broadcasts empfangen.${colors.reset}`);
        console.log('Das bedeutet NICHT dass lokale Steuerung unmoeglich ist!');
        console.log('Verwende "node test-tuya.js" fuer TCP Port-Test.');
      }
      console.log('========================================');

      resolve(Array.from(devices.entries()));
    }, duration);
  });
}

/**
 * Testet eine einzelne IP
 */
async function testSingleIp(ip) {
  console.log('');
  console.log(`${colors.cyan}Teste ${ip}:${TUYA_PORT}...${colors.reset}`);
  
  const result = await testPort(ip);
  
  console.log('');
  if (result.open) {
    console.log(`${colors.green}[OFFEN]${colors.reset} Port ${TUYA_PORT} ist erreichbar`);
    console.log('Lokale API verfuegbar - Steuerung moeglich mit Local Key');
  } else {
    console.log(`${colors.red}[GESCHLOSSEN]${colors.reset} Port ${TUYA_PORT} nicht erreichbar`);
    console.log(`Grund: ${result.reason || 'Unbekannt'}`);
  }
  console.log('');

  return result;
}

// Header ausgeben
function printHeader() {
  console.log('========================================');
  console.log('   Tuya Port-Test v1.0');
  console.log('========================================');
}

// Main
async function main() {
  const args = process.argv.slice(2);

  printHeader();

  if (args.length === 0) {
    // Alle IPs testen
    await testAllPorts();
  } else if (args[0] === 'scan') {
    // UDP Discovery
    await udpScan();
  } else if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    // Hilfe
    console.log('');
    console.log('Verwendung:');
    console.log('  node test-tuya.js           Alle bekannten IPs testen');
    console.log('  node test-tuya.js <IP>      Einzelne IP testen');
    console.log('  node test-tuya.js scan      UDP Discovery starten');
    console.log('');
    console.log('Bekannte IPs:');
    THERMOSTAT_IPS.forEach(ip => console.log(`  - ${ip}`));
    console.log('');
  } else {
    // Einzelne IP testen
    const ip = args[0];
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      await testSingleIp(ip);
    } else {
      console.log('');
      console.log(`${colors.red}Ungueltige IP-Adresse: ${ip}${colors.reset}`);
      console.log('Verwendung: node test-tuya.js <IP>');
      console.log('');
    }
  }
}

main().catch(console.error);
