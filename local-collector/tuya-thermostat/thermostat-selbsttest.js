#!/usr/bin/env node
/**
 * thermostat-selbsttest.js – prüft JEDES Thermostat aus config.json einzeln (10.11.2026)
 *
 * Anlass: Kinder Bad liest sich normal, nimmt aber keinen Befehl an. Frage: Sprechen einzelne Thermostate eine
 * andere Protokollversion, haben sie andere Datenpunkte oder ein anderes Befehlsset?
 *
 * Je Gerät:
 *   1. Netz       – TCP-Port 6668 erreichbar?
 *   2. Protokoll  – welche Version antwortet (3.5 / 3.4 / 3.3)? Antwortzeit?
 *   3. Datenpunkte – welche DPs meldet das Gerät, welche fehlen oder sind zusätzlich (Vergleich mit allen anderen)?
 *   4. Schreiben A – harmloser DP 109 (Tastenton) umschalten → zurücklesen → zurückstellen
 *   5. Schreiben B – Sollwert (DP 2) um +0,5 °C → zurücklesen → zurückstellen (wie unser Dienst nur DP 2)
 *   6. Schreiben C – Sollwert zusammen mit Modus „home“ in EINEM Befehl (so wie Dienst v1.3) → zurückstellen
 *   Für jeden Schreibtest wird zusätzlich jede Protokollversion probiert, falls die erste nicht bestätigt.
 *
 * Alles wird am Ende auf den Ausgangswert zurückgestellt. Ergebnis: Tabelle in der Konsole und
 * (wenn SQL 31 ausgeführt ist) eine Zeile je Gerät in public.thermostat_selbsttest → Protokoll in der App.
 *
 * Aufruf (Österreich-PC, Ordner C:\Users\ulibe\tuya-thermostat):
 *     node thermostat-selbsttest.js                 alle Geräte
 *     node thermostat-selbsttest.js "Kinder Bad"    nur ein Gerät
 *     node thermostat-selbsttest.js --nur-lesen     ohne Schreibtests
 *
 * Der Dienst SmartfoxTuya darf weiterlaufen: Thermostate nehmen nur eine Verbindung gleichzeitig an – der Test
 * wiederholt deshalb Verbindungsfehler bis zu 3× mit Pause.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const TuyAPI = require('tuyapi');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const VERSIONS = ['3.5', '3.4', '3.3'];
const T_CONNECT = 6000;
const T_IO = 5000;

const args = process.argv.slice(2);
const NUR_LESEN = args.includes('--nur-lesen');
const NUR_NAME = args.find((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, label) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}
function tcpProbe(ip, port = 6668, timeout = 1500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (ok) => { if (!done) { done = true; s.destroy(); resolve(ok); } };
    s.setTimeout(timeout);
    s.on('connect', () => fin(true));
    s.on('timeout', () => fin(false));
    s.on('error', () => fin(false));
    s.connect(port, ip);
  });
}

async function open(dev, version) {
  const d = new TuyAPI({ id: dev.device_id, key: dev.local_key, ip: dev.ip, version,
    issueGetOnConnect: false, issueRefreshOnConnect: false });
  d.on('error', () => {});
  await withTimeout(d.find(), T_CONNECT, `find v${version}`);
  await withTimeout(d.connect(), T_CONNECT, `connect v${version}`);
  return d;
}
const close = (d) => { try { d.disconnect(); } catch (_) { /* egal */ } };

async function readDps(dev, version) {
  const d = await open(dev, version);
  try {
    const st = await withTimeout(d.get({ schema: true }), T_IO, 'get');
    return st?.dps || {};
  } finally { close(d); }
}

/** Erste Protokollversion finden, die liest. Bis zu 3 Versuche (Dienst kann gerade verbunden sein). */
async function findVersion(dev) {
  const pref = dev.protocol_version ? [dev.protocol_version, ...VERSIONS.filter((v) => v !== dev.protocol_version)] : VERSIONS;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const v of pref) {
      const t0 = Date.now();
      try {
        const dps = await readDps(dev, v);
        return { version: v, ms: Date.now() - t0, dps, attempt };
      } catch (_) { /* nächste Version */ }
    }
    await sleep(4000);
  }
  return null;
}

/** Schreiben + Bestätigung + Zurücklesen. data: { dp: wert } (ein oder mehrere DPs in EINEM Befehl). */
async function writeCheck(dev, version, data) {
  const d = await open(dev, version);
  const t0 = Date.now();
  let ack = false, fehler = null;
  try {
    const keys = Object.keys(data);
    const call = keys.length === 1 ? d.set({ dps: keys[0], set: data[keys[0]] }) : d.set({ multiple: true, data });
    await withTimeout(call, T_IO, 'set');
    ack = true;
  } catch (e) { fehler = e.message; }
  close(d);
  await sleep(1500);
  let nachher = null;
  try { nachher = await readDps(dev, version); } catch (e) { fehler = fehler || `zurücklesen: ${e.message}`; }
  const wirkt = !!nachher && Object.entries(data).every(([k, v]) => nachher[k] === v);
  return { ack, wirkt, ms: Date.now() - t0, fehler, nachher };
}

/** Schreibtest mit allen Protokollversionen (gefundene zuerst). Stellt danach den Ausgangswert wieder her. */
async function writeTest(dev, version, data, restore) {
  const order = [version, ...VERSIONS.filter((v) => v !== version)];
  let first = null, ok = null;
  for (const v of order) {
    let r;
    try { r = await writeCheck(dev, v, data); } catch (e) { r = { ack: false, wirkt: false, fehler: e.message }; }
    if (!first) first = { ...r, version: v };
    if (r.wirkt) { ok = { ...r, version: v }; break; }
  }
  // zurückstellen – nur wenn sich etwas geändert hat
  if (ok) {
    try { await writeCheck(dev, ok.version, restore); } catch (e) { console.log(`   ⚠ Zurückstellen fehlgeschlagen: ${e.message} – bitte prüfen: ${JSON.stringify(restore)}`); }
  }
  return { erste: first, wirkt_mit: ok?.version ?? null, fehler: ok ? null : first?.fehler ?? 'keine Wirkung' };
}

async function saveResults(config, rows) {
  const url = config.supabase?.url;
  const key = config.supabase?.service_role_key || config.supabase?.anon_key;
  if (!url || !key) { console.log('\n(Keine Supabase-Daten in config.json – Ergebnis nur in der Konsole.)'); return; }
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(url, key);
    const { error } = await sb.from('thermostat_selbsttest').insert(rows);
    if (error) console.log(`\n(Speichern nicht möglich: ${error.message} – SQL 31 ausgeführt?)`);
    else console.log(`\n✓ ${rows.length} Ergebnisse gespeichert (App › Protokoll › Thermostate).`);
  } catch (e) { console.log(`\n(Speichern nicht möglich: ${e.message})`); }
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) { console.error(`config.json fehlt: ${CONFIG_PATH}`); process.exit(1); }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  let devices = config.tuya?.devices || [];
  if (NUR_NAME) devices = devices.filter((d) => d.name === NUR_NAME);
  if (devices.length === 0) { console.error(`Kein Gerät gefunden${NUR_NAME ? ` mit Namen "${NUR_NAME}"` : ''}.`); process.exit(1); }

  console.log('='.repeat(78));
  console.log(`Thermostat-Selbsttest · ${devices.length} Gerät(e) · ${new Date().toLocaleString('de-AT')}${NUR_LESEN ? ' · nur lesen' : ''}`);
  console.log('='.repeat(78));

  const results = [];
  for (const dev of devices) {
    const r = { room_id: dev.room_id || null, raum: dev.name, ip: dev.ip, device_id: dev.device_id,
      tcp_ok: false, version: null, lese_ms: null, dps: null, dp_liste: null,
      schreiben_ton: null, schreiben_soll: null, schreiben_soll_mit_modus: null, befund: null };
    process.stdout.write(`\n▶ ${dev.name} (${dev.ip}) … `);
    r.tcp_ok = await tcpProbe(dev.ip);
    if (!r.tcp_ok) { r.befund = 'nicht im Netz (Port 6668 zu)'; console.log(r.befund); results.push(r); continue; }
    const f = await findVersion(dev);
    if (!f) { r.befund = 'Port offen, aber keine Protokollversion antwortet (Schlüssel/ID falsch?)'; console.log(r.befund); results.push(r); continue; }
    r.version = f.version; r.lese_ms = f.ms; r.dps = f.dps; r.dp_liste = Object.keys(f.dps).sort((a, b) => Number(a) - Number(b));
    console.log(`liest mit v${f.version} (${f.ms} ms)`);

    if (!NUR_LESEN) {
      // A: harmloser DP 109 (Tastenton)
      if (typeof f.dps['109'] === 'boolean') {
        const was = f.dps['109'];
        const a = await writeTest(dev, f.version, { '109': !was }, { '109': was });
        r.schreiben_ton = a;
        console.log(`   Schreiben DP 109 (Ton):          ${a.wirkt_mit ? `✓ wirkt (v${a.wirkt_mit})` : `✗ ${a.fehler}`}`);
      }
      // B: Sollwert allein (+0,5 °C)
      const soll = Number(f.dps['2']);
      if (Number.isFinite(soll) && soll >= 50 && soll <= 345) {
        const b = await writeTest(dev, f.version, { '2': soll + 5 }, { '2': soll });
        r.schreiben_soll = b;
        console.log(`   Schreiben DP 2 (Soll +0,5 °C):   ${b.wirkt_mit ? `✓ wirkt (v${b.wirkt_mit})` : `✗ ${b.fehler}`}`);
        // C: Sollwert + Modus home in EINEM Befehl (wie Dienst v1.3)
        const c = await writeTest(dev, f.version, { '4': 'home', '2': soll + 5 }, { '4': f.dps['4'] ?? 'home', '2': soll });
        r.schreiben_soll_mit_modus = c;
        console.log(`   Schreiben DP 4+2 (Modus + Soll): ${c.wirkt_mit ? `✓ wirkt (v${c.wirkt_mit})` : `✗ ${c.fehler}`}`);
      }
    }
    const kaputt = !NUR_LESEN && [r.schreiben_ton, r.schreiben_soll, r.schreiben_soll_mit_modus].filter(Boolean).every((x) => !x.wirkt_mit);
    r.befund = kaputt ? 'liest, nimmt aber KEINEN Schreibbefehl an' : 'ok';
    results.push(r);
  }

  // Datenpunkte vergleichen: was haben die meisten Geräte, was fehlt / ist zusätzlich?
  const lists = results.filter((r) => r.dp_liste);
  const zaehl = {};
  for (const r of lists) for (const k of r.dp_liste) zaehl[k] = (zaehl[k] || 0) + 1;
  const ueblich = Object.keys(zaehl).filter((k) => zaehl[k] > lists.length / 2);
  for (const r of lists) {
    const fehlt = ueblich.filter((k) => !r.dp_liste.includes(k));
    const extra = r.dp_liste.filter((k) => !ueblich.includes(k));
    if (fehlt.length || extra.length) r.befund += ` · DPs abweichend${fehlt.length ? `, fehlt ${fehlt.join(',')}` : ''}${extra.length ? `, zusätzlich ${extra.join(',')}` : ''}`;
  }
  // Einstellungen, die bei uns gleich sein sollten
  const SOLL = { '110': '1', '111': false, '19': 0 };
  for (const r of lists) {
    const abw = Object.entries(SOLL).filter(([k, v]) => r.dps[k] !== undefined && r.dps[k] !== v).map(([k]) => `DP ${k}=${JSON.stringify(r.dps[k])}`);
    if (abw.length) r.befund += ` · Einstellung abweichend: ${abw.join(', ')}`;
  }

  console.log('\n' + '='.repeat(78));
  console.log('ERGEBNIS');
  console.log('='.repeat(78));
  for (const r of results) console.log(`${(r.raum || '').padEnd(18)} ${(r.version ? 'v' + r.version : '–').padEnd(6)} ${r.befund}`);

  await saveResults(config, results.map((r) => ({ ...r, dps: r.dps, dp_liste: r.dp_liste })));
  process.exit(0);
}

main().catch((e) => { console.error('Fehler:', e.message); process.exit(1); });
