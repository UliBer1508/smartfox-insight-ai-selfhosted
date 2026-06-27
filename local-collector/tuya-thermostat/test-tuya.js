#!/usr/bin/env node

/**
 * Tuya Port-Test v1.1
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

// Alle 12 Thermostat-IPs aus der Datenbank
const THERMOSTAT_IPS = [
  '192.168.188.27',   // Zimmer Luis
  '192.168.188.42',   // Büro
  '192.168.188.78',   // Wirtschaftsraum
  '192.168.188.108',   // Kinder Bad
  '192.168.188.149',   // Haustür
  '192.168.188.157',   // Waschraum
  '192.168.188.161',   // Flur
  '192.168.188.165',   // Wohnzimmer
  '192.168.188.173',   // Zimmer Uli
  '192.168.188.176',   // Toilette Eingang
  '192.168.188.180',   // Bad Uli
  '192.168.188.197',   // Zimmer Luca
];

const TUYA_PORT = 6668;
const TIMEOUT_MS = 3000;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function testPort(ip, port = TUYA_PORT, timeout = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const cleanup = () => { if (!resolved) { resolved = true; socket.destroy(); } };
    socket.setTimeout(timeout);
    socket.on('connect', () => { cleanup(); resolve({ ip, port, open: true }); });
    socket.on('timeout', () => { cleanup(); resolve({ ip, port, open: false, reason: 'timeout' }); });
    socket.on('error', (err) => { cleanup(); resolve({ ip, port, open: false, reason: err.code || err.message }); });
    socket.connect(port, ip);
  });
}

async function testAllPorts() {
  console.log('');
  console.log(`${colors.cyan}Teste ${THERMOSTAT_IPS.length} Thermostat-IPs auf Port ${TUYA_PORT}...${colors.reset}`);
  console.log('');

  const results = await Promise.all(THERMOSTAT_IPS.map(ip => testPort(ip)));

  results.sort((a, b) => {
    const aParts = a.ip.split('.').map(Number);
    const bParts = b.ip.split('.').map(Number);
    for (let i = 0; i < 4; i++) { if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i]; }
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

  const openCount = results.filter(r => r.open).length;
  console.log('');
  console.log('========================================');
  console.log(`Ergebnis: ${openCount}/${results.length} Geraete erreichbar`);
  console.log('');

  if (openCount === results.length) {
    console.log(`${colors.green}Alle Thermostate unterstuetzen lokale LAN-Steuerung!${colors.reset}`);
  } else if (openCount > 0) {
    console.log(`${colors.yellow}Einige Thermostate sind erreichbar.${colors.reset}`);
  } else {
    console.log(`${colors.red}Keine Thermostate erreichbar.${colors.reset}`);
  }
  console.log('========================================');
  return results;
}

async function testSingleIp(ip) {
  console.log('');
  console.log(`${colors.cyan}Teste ${ip}:${TUYA_PORT}...${colors.reset}`);
  const result = await testPort(ip);
  console.log('');
  if (result.open) {
    console.log(`${colors.green}[OFFEN]${colors.reset} Port ${TUYA_PORT} ist erreichbar`);
  } else {
    console.log(`${colors.red}[GESCHLOSSEN]${colors.reset} Port ${TUYA_PORT} nicht erreichbar (${result.reason})`);
  }
  return result;
}

function udpScan(duration = 5000) {
  console.log(`\n${colors.cyan}UDP Discovery (${duration/1000}s)...${colors.reset}\n`);
  const devices = new Map();
  const socket6666 = dgram.createSocket('udp4');
  socket6666.on('message', (msg, rinfo) => {
    if (!devices.has(rinfo.address)) {
      devices.set(rinfo.address, true);
      console.log(`  ${colors.green}Gefunden:${colors.reset} ${rinfo.address}`);
    }
  });
  socket6666.on('error', () => {});
  socket6666.bind(6666);

  const socket6667 = dgram.createSocket('udp4');
  socket6667.on('message', (msg, rinfo) => {
    if (!devices.has(rinfo.address)) {
      devices.set(rinfo.address, true);
      console.log(`  ${colors.green}Gefunden:${colors.reset} ${rinfo.address}`);
    }
  });
  socket6667.on('error', () => {});
  socket6667.bind(6667);

  return new Promise((resolve) => {
    setTimeout(() => {
      socket6666.close();
      socket6667.close();
      console.log(`\n${devices.size} Geraet(e) gefunden`);
      resolve();
    }, duration);
  });
}

async function main() {
  console.log('========================================');
  console.log('   Tuya Port-Test v1.1 (12 Geraete)');
  console.log('========================================');

  const args = process.argv.slice(2);
  if (args.length === 0) await testAllPorts();
  else if (args[0] === 'scan') await udpScan();
  else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(args[0])) await testSingleIp(args[0]);
  else console.log(`\nVerwendung:\n  node test-tuya.js          Alle 12 IPs testen\n  node test-tuya.js <IP>     Einzelne IP\n  node test-tuya.js scan     UDP Discovery\n`);
}

main().catch(console.error);
