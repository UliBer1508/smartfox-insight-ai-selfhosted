#!/usr/bin/env node
/**
 * Dienste-Wächter v1.1 (24.11.2026) – läuft als eigener NSSM-Dienst auf jedem PC (Österreich, München)
 * v1.1: Befehl „backup_time“ – Uhrzeit der Sicherung (geplante Aufgabe „Supabase-Sicherung Heizung“) aus der App
 *       ändern (SQL 55, doc/DATENSICHERUNG.md „Uhrzeit ändern“)
 * Doku: doc/SYSTEMSTATUS-2026-11-05.md
 *
 * Alle 30 s:
 *   1. findet alle NSSM-Dienste dieses PCs (Registry, wie services.js im Wallbox-Backend)
 *      + die Zusatzdienste aus config.json (z. B. Tailscale)
 *   2. fragt ihren Zustand ab (nssm status / sc query)
 *   3. meldet alles an die Edge Function system-agent – über eine ausgehende HTTPS-Verbindung.
 *      Dafür braucht es weder Tailscale noch Cloudflare: läuft Tailscale nicht, kommt das
 *      „Start“ aus der App trotzdem an.
 *   4. führt die Befehle aus, die die Antwort mitbringt (Start/Stop/Neustart), und meldet das Ergebnis
 *
 * Sicherheit (doppelt – die Datenbank prüft dieselben Regeln, siehe SQL 22):
 *   - nur Dienste, die hier tatsächlich gefunden wurden; Namen werden nie ungeprüft an die Shell gegeben
 *   - Fernzugriff (Tailscale, Cloudflare): nur Start, nie Stop – sonst sperrt man sich aus
 *   - der Wächter selbst: nur ansehen (er kann sich nicht selbst stoppen; stürzt er ab, startet NSSM ihn neu)
 *
 * Keine npm-Pakete nötig (Node 18+ hat fetch eingebaut).
 * Aufruf zum Testen:  node index.js --test   (zeigt die gefundenen Dienste und endet)
 */

'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = '1.1';
const IS_WINDOWS = process.platform === 'win32';
const VALID_NAME = /^[A-Za-z0-9_.-]{1,80}$/;
const REMOTE_ACCESS = /tailscale|cloudflare|cloudflared/i; // nie aus der Ferne stoppen

// --- Konfiguration ---------------------------------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
} catch (e) {
  console.error(`config.json fehlt oder ist kaputt (${e.message}). Vorlage: config.example.json`);
  process.exit(1);
}
const HOST = String(config.host || '');
if (!/^[a-z0-9-]{1,40}$/.test(HOST) || HOST === 'cloud') {
  console.error('config.json: "host" muss klein geschrieben sein, z. B. "oesterreich" oder "muenchen"');
  process.exit(1);
}
if (!config.endpoint || !config.token || String(config.token).includes('HIER')) {
  console.error('config.json: "endpoint" und "token" eintragen');
  process.exit(1);
}
const SELF = config.self_service || 'DiensteWaechter';
let NSSM = config.nssm_path || 'nssm'; // wird beim Start gesucht, falls nicht im PATH (siehe findNssm)
const INTERVAL_MS = Math.max(15, Number(config.interval_seconds) || 30) * 1000;
const DISCOVERY_MS = Math.max(60, Number(config.discovery_seconds) || 300) * 1000;
const overrides = config.services && typeof config.services === 'object' ? config.services : {};
const extras = (Array.isArray(config.extraServices) ? config.extraServices : [])
  .filter((e) => e && VALID_NAME.test(String(e.name)));

// Geplante Aufgabe der Sicherung (Setup-SupabaseBackup.ps1 -Profil Heizung); in config.json änderbar
const BACKUP_TASK = String(config.backup_task || 'Supabase-Sicherung Heizung');
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const TASK_RE = /^[A-Za-z0-9 _.()-]{1,80}$/;

const log = (...a) => console.log(new Date().toLocaleString('de-AT'), ...a);

// --- Shell-Helfer ----------------------------------------------------------------------------------------
function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      // nssm schreibt UTF-16 mit Nullbytes – entfernen
      const out = String(stdout || '').replace(/\u0000/g, '');
      const errOut = String(stderr || '').replace(/\u0000/g, '');
      resolve({ ok: !err, out, err: errOut || (err ? err.message : '') });
    });
  });
}

// --- NSSM-Dienste finden (Registry-Wert "Application" unter ...\Services\<Name>\Parameters) -----------------
let nssmNames = new Set();
let lastDiscovery = 0;

async function discover() {
  if (!IS_WINDOWS) return new Set();
  const r = await run('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services', '/s', '/f', 'Application', '/v', 'Application'], 30000);
  const found = new Set();
  const keyRe = /\\Services\\([A-Za-z0-9_.-]+)\\Parameters$/i;
  for (const line of r.out.split(/\r?\n/)) {
    const m = line.trim().match(keyRe);
    if (m && VALID_NAME.test(m[1])) found.add(m[1]);
  }
  return found;
}

async function queryStatus(name, kind) {
  if (!IS_WINDOWS || !VALID_NAME.test(name)) return 'unknown';
  if (kind === 'nssm') {
    const r = await run(NSSM, ['status', name], 10000);
    const t = r.out.toUpperCase();
    if (t.includes('RUNNING')) return 'running';
    if (t.includes('STOPPED') || t.includes('PAUSED')) return 'stopped';
  }
  const r = await run('sc', ['query', name], 10000);
  const t = r.out.toUpperCase();
  if (t.includes('RUNNING')) return 'running';
  if (t.includes('STOPPED')) return 'stopped';
  if (t.includes('START_PENDING') || t.includes('STOP_PENDING')) return 'unknown';
  return 'unknown';
}

/**
 * nssm.exe finden: 1. config.nssm_path, 2. im PATH (where nssm),
 * 3. aus dem ImagePath eines vorhandenen NSSM-Dienstes (München: nssm nicht im PATH).
 * @returns {Promise<string|null>}
 */
async function findNssm() {
  if (config.nssm_path) return fs.existsSync(config.nssm_path) ? config.nssm_path : null;
  if (!IS_WINDOWS) return null;
  const w = await run('where', ['nssm'], 10000);
  if (w.ok) {
    const first = w.out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.toLowerCase().endsWith('.exe'));
    if (first) return first;
  }
  const names = await discover();
  for (const name of names) {
    const r = await run('reg', ['query', `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${name}`, '/v', 'ImagePath'], 10000);
    const m = r.out.match(/ImagePath\s+REG_\w+\s+"?([^"\r\n]*nssm[^"\r\n]*?\.exe)"?/i);
    if (m && fs.existsSync(m[1])) return m[1];
  }
  return null;
}

function controlFor(name, kind, wanted) {
  if (name.toLowerCase() === SELF.toLowerCase()) return 'none';
  let c = wanted || (kind === 'nssm' ? 'full' : 'start_only');
  if (!['full', 'start_only', 'none'].includes(c)) c = 'none';
  if (REMOTE_ACCESS.test(name) && c === 'full') c = 'start_only';
  return c;
}

/** Aktuelle Dienstliste mit Zustand */
async function collect() {
  if (Date.now() - lastDiscovery >= DISCOVERY_MS || nssmNames.size === 0) {
    nssmNames = await discover();
    lastDiscovery = Date.now();
  }
  const rows = [];
  for (const name of [...nssmNames].sort((a, b) => a.localeCompare(b))) {
    const o = overrides[name] || {};
    if (o.hidden) continue;
    rows.push({ name, label: o.label || name, url: o.url || null, kind: 'nssm',
                control: controlFor(name, 'nssm', o.control) });
  }
  for (const e of extras) {
    if (nssmNames.has(e.name)) continue;
    rows.push({ name: e.name, label: e.label || e.name, url: e.url || null, kind: 'extra',
                control: controlFor(e.name, 'extra', e.control === 'none' ? 'none' : 'start_only') });
  }
  await Promise.all(rows.map(async (r) => { r.status = await queryStatus(r.name, r.kind); }));
  return rows;
}

// --- Uhrzeit der Sicherung ändern (v1.1) ------------------------------------------------------------------
// Uhrzeit und Aufgabenname sind geprüft (nur Ziffern/Doppelpunkt bzw. einfache Zeichen) – nichts Ungeprüftes in PowerShell.
// Neuer Auslöser: täglich HH:MM Ortszeit (ohne UTC-Bindung – vorher lief die München-Aufgabe nach der Zeitumstellung 1 h früher).
async function setBackupTime(cmd) {
  const t = String(cmd.param || '');
  if (!TIME_RE.test(t)) return { ok: false, message: 'Uhrzeit ungültig' };
  if (!TASK_RE.test(BACKUP_TASK)) return { ok: false, message: 'Aufgabenname in config.json ungültig' };
  if (!IS_WINDOWS) return { ok: false, message: 'nur unter Windows' };
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `$n = '${BACKUP_TASK}'`,
    '$t = Get-ScheduledTask -TaskName $n',
    `Set-ScheduledTask -TaskName $n -TaskPath $t.TaskPath -Trigger (New-ScheduledTaskTrigger -Daily -At '${t}') | Out-Null`,
    '$i = Get-ScheduledTaskInfo -TaskName $n -TaskPath $t.TaskPath',
    "'NEXT=' + $i.NextRunTime.ToString('dd.MM. HH:mm')",
  ].join('; ');
  log(`[Befehl] Sicherung auf ${t} Uhr`);
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], 60000);
  const m = r.out.match(/NEXT=([0-9. :]+)/);
  if (r.ok && m) {
    log(`[Befehl] Sicherung: OK, nächster Lauf ${m[1].trim()}`);
    return { ok: true, message: `täglich ${t} – nächster Lauf ${m[1].trim()}` };
  }
  const err = (r.err || r.out).trim().replace(/\s+/g, ' ');
  let msg = err.slice(0, 300) || 'unbekannter Fehler';
  if (/nicht gefunden|cannot find|No MSFT_ScheduledTask|not found/i.test(err)) msg = `Aufgabe „${BACKUP_TASK}“ auf diesem PC nicht gefunden`;
  else if (/kennwort|password|benutzername|user name|0x8007052E/i.test(err)) msg = 'Die Aufgabe ist mit Kennwort gespeichert – Uhrzeit bitte einmal in der Aufgabenplanung ändern (Trigger bearbeiten)';
  else if (/zugriff|access is denied|0x80070005/i.test(err)) msg = 'Kein Zugriff auf die Aufgabe – Dienste-Wächter läuft ohne Administratorrechte';
  log(`[Befehl] Sicherung: FEHLER (${msg})`);
  return { ok: false, message: msg };
}

// --- Befehle ausführen -------------------------------------------------------------------------------------
async function execute(cmd, rows) {
  if (cmd.action === 'backup_time') return setBackupTime(cmd);
  const svc = rows.find((r) => r.name === cmd.service_name);
  const action = cmd.action;
  if (!svc) return { ok: false, message: 'Dienst auf diesem PC nicht gefunden' };
  if (!['start', 'stop', 'restart'].includes(action)) return { ok: false, message: 'unbekannte Aktion' };
  if (svc.control === 'none') return { ok: false, message: 'nur ansehen' };
  if (svc.control === 'start_only' && action !== 'start') return { ok: false, message: 'nur Start erlaubt (Fernzugriff)' };
  if (!IS_WINDOWS) return { ok: false, message: 'nur unter Windows' };

  log(`[Befehl] ${action} ${svc.name}`);
  let r;
  if (svc.kind === 'nssm') r = await run(NSSM, [action, svc.name], 60000);
  else r = await run('sc', [action === 'stop' ? 'stop' : 'start', svc.name], 60000);

  // Zustand nach kurzer Wartezeit lesen – entscheidet über Erfolg (z. B. „läuft schon“ ist auch ok)
  const want = action === 'stop' ? 'stopped' : 'running';
  let status = 'unknown';
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    status = await queryStatus(svc.name, svc.kind);
    if (status === want) break;
  }
  const ok = status === want;
  const msg = ok
    ? (action === 'stop' ? 'gestoppt' : action === 'restart' ? 'neu gestartet' : 'gestartet')
    : `Zustand danach: ${status}${r.err ? ' – ' + r.err.trim().slice(0, 200) : ''}`;
  log(`[Befehl] ${svc.name}: ${ok ? 'OK' : 'FEHLER'} (${msg})`);
  return { ok, message: msg, status };
}

// --- Verbindung zur Cloud ----------------------------------------------------------------------------------
async function post(body) {
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-token': config.token },
    body: JSON.stringify({ host: HOST, ...body }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

let failures = 0;
let busy = false;
async function tick() {
  if (busy) return; // ein Befehl läuft noch – nächste Runde abwarten
  busy = true;
  let rows;
  try {
    rows = await collect();
    const info = { computer: os.hostname(), node: process.version, uptime_h: Math.round(os.uptime() / 3600) };
    const res = await post({ action: 'report', label: config.label || HOST, version: VERSION, info, services: rows });
    if (failures > 0) log(`[Cloud] wieder verbunden nach ${failures} Fehlversuchen`);
    failures = 0;
    for (const cmd of res.commands || []) {
      const result = await execute(cmd, rows);
      try {
        await post({ action: 'result', id: cmd.id, ok: result.ok, message: result.message, status: result.status || null });
      } catch (e) {
        log('[Cloud] Ergebnis nicht gemeldet:', e.message);
      }
    }
  } catch (e) {
    failures++;
    if (failures === 1 || failures % 20 === 0) log(`[Cloud] Meldung fehlgeschlagen (${failures}×):`, e.message);
  } finally {
    busy = false;
  }
}

// --- Start ---------------------------------------------------------------------------------------------
async function main() {
  // Für install-dienst.bat: nur den Pfad von nssm.exe ausgeben
  if (process.argv.includes('--nssm-path')) {
    const p = await findNssm();
    if (p) console.log(p); else process.exitCode = 1;
    return;
  }
  const found = await findNssm();
  if (found) NSSM = found;
  else if (IS_WINDOWS) console.log('Hinweis: nssm.exe nicht gefunden – Start/Stop von NSSM-Diensten geht nicht (config.json: "nssm_path")');
  log(`Dienste-Wächter v${VERSION} – ${config.label || HOST} (${HOST}), alle ${INTERVAL_MS / 1000} s`);
  if (process.argv.includes('--test')) {
    const rows = await collect();
    console.table(rows.map((r) => ({ Dienst: r.name, Anzeige: r.label, Art: r.kind, Steuerung: r.control, Zustand: r.status })));
    try {
      await post({ action: 'ping' }); // prüft Adresse und Token, schreibt nichts
      console.log('Cloud: OK – Adresse und Token stimmen');
    } catch (e) {
      console.log('Cloud: FEHLER –', e.message);
      if (/HTTP 401/.test(e.message)) console.log('       → Token in config.json und Supabase-Secret SYSTEM_AGENT_TOKEN vergleichen');
      process.exitCode = 1; // install-dienst.bat bricht dann ab
    }
    return;
  }
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
