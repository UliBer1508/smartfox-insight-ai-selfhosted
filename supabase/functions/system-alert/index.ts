// system-alert – Systemstatus prüfen und bei Problemen eine Mail schicken  (05.11.2026, überarbeitet 08.11.2026)
// Doku: doc/SYSTEMSTATUS-2026-11-05.md, doc/FIX-ALERT-MAILS-2026-11-08.md
//
// Läuft alle 5 min per pg_cron (system-alert-5min, SQL 22):
//   1) Webseiten aus system_settings.system_status_websites aufrufen → system_services (host 'cloud')
//   2) system_problems() lesen – dieselbe Liste, die die App in der Kopfleiste zeigt
//   3) system_alert_state abgleichen und per Mail melden – je Problem GENAU ZWEI Mails (Uli, 08.11.2026):
//        - „Problem“: besteht seit mind. 4 min → Mail mit Beschreibung und Lösungsansatz
//        - „Gelöst“:  ist seit mind. 15 min am Stück weg → Mail mit Dauer
//      Taucht ein Problem innerhalb dieser 15 min wieder auf, gilt es als dasselbe – keine neue Mail.
//      Keine Erinnerungs-Mails mehr (vorher nach 24 h) – die App zeigt offene Probleme weiter an.
//   4) Aufräumen: alte Befehle (30 Tage), erledigte Mail-Zustände (30 Tage)
//
// Mail über Gmail-SMTP (Port 465, wie der Wallbox-Mailer). Secrets: MAIL_USER, MAIL_PASS (App-Passwort),
// ALERT_EMAIL (Empfänger, mehrere mit Komma). Fehlen sie, läuft alles außer dem Versand.
// Aufruf erlaubt mit anon- oder service_role-JWT (Muster aus auto-resolve-api-errors); verify_jwt = false.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const APP_URL = 'https://heizung.steinbockchalets-charge.com';
const MAIL_AFTER_MS = 4 * 60 * 1000;      // Problem muss so lange bestehen, bevor gemeldet wird
const RESOLVE_AFTER_MS = 15 * 60 * 1000;  // so lange muss es am Stück weg sein, bevor „gelöst“ gilt

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function decodeJwtRole(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.replace(/^Bearer\s+/i, '').split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch { return null; }
}

interface Website { name: string; label: string; url: string }
interface Problem { key: string; area: string; text: string }

async function checkWebsite(w: Website) {
  const started = Date.now();
  try {
    const res = await fetch(w.url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    await res.body?.cancel();
    const ms = Date.now() - started;
    // 4xx heißt: Server antwortet (z. B. Login nötig) → erreichbar. 5xx/52x = Tunnel oder Backend weg.
    const ok = res.status < 500;
    return { ...w, ok, detail: `HTTP ${res.status} · ${ms} ms` };
  } catch (e) {
    return { ...w, ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
  }
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' });

function dauer(fromIso: string, toIso: string) {
  const min = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return h < 48 ? `${h} h ${m} min` : `${Math.floor(h / 24)} Tage ${h % 24} h`;
}

// Lösungsansatz je Problemart (Schlüssel aus system_problems(), SQL 27)
function loesung(key: string, text: string): string[] {
  if (key.startsWith('thermo:')) return [
    'Das Thermostat antwortet im Hausnetz nicht (Port 6668). Hat es Strom, regelt es weiter auf den zuletzt gesetzten Sollwert, wird aber nicht mehr gesteuert. Ohne Strom heizt der Raum nicht.',
    '1. Display am Gerät an? Wenn nicht: Sicherung bzw. Stromzufuhr prüfen.',
    '2. Netzwerkkabel (LAN) am Thermostat und am Switch fest? Leuchtet die Link-LED am Switch-Port? In der FritzBox unter Heimnetz nachsehen, ob das Gerät online ist und dieselbe IP wie in config.json hat.',
    '3. Gerät 30 Sekunden stromlos machen (Sicherung), dann warten – der Dienst fragt alle 5 min.',
    '4. Wurde es in der Smart-Life-App neu gekoppelt, hat es einen neuen Local Key: neu holen, in config.json eintragen, Dienst SmartfoxTuya neu starten.',
  ];
  if (key === 'cloud:tuya') return [
    'Der Thermostat-Dienst auf dem Österreich-PC meldet sich nicht – es werden keine Sollwerte gesetzt und keine Temperaturen gelesen.',
    '1. App › Systemstatus (Symbol oben rechts): SmartfoxTuya neu starten.',
    '2. Meldet sich auch der Österreich-PC nicht: PC an? Internet? (siehe eigene Meldung).',
  ];
  if (key.startsWith('err:') && /no_control_channel|local_service_offline/.test(key)) return [
    'pv-automation reiht Befehle ein, der lokale Thermostat-Dienst holt sie nicht ab.',
    '1. App › Systemstatus: SmartfoxTuya neu starten.',
    '2. Hilft das nicht: Log im Dienst-Ordner C:\\Users\\ulibe\\tuya-thermostat ansehen.',
  ];
  if (key.startsWith('err:')) return [
    'Ein Fehler steht seit über 15 min offen.',
    '1. Details in der App unter Übersicht › Fehler.',
    '2. Edge-Function-Logs der genannten Quelle in Supabase ansehen.',
  ];
  if (key === 'cloud:fronius') return [
    'Es kommen keine Messwerte vom Fronius an – die Heizungsautomatik rechnet mit alten Werten.',
    '1. App › Systemstatus: SmartfoxFronius neu starten.',
    '2. Wechselrichter im Hausnetz erreichbar (192.168.188.64)?',
  ];
  if (key.startsWith('host:')) return [
    'Der Dienste-Wächter dieses PCs meldet sich nicht – PC aus, im Ruhezustand oder ohne Internet.',
    '1. PC einschalten bzw. aufwecken, Internet prüfen.',
    '2. Läuft der PC: Dienst DiensteWaechter prüfen (nssm status DiensteWaechter).',
  ];
  if (key.startsWith('svc:cloud:')) return [
    'Die Webseite antwortet nicht oder mit einem Serverfehler.',
    '1. Wallbox-Seite: Cloudflare-Tunnel und Wallbox-Backend auf dem Österreich-PC prüfen (App › Systemstatus).',
    '2. Heizungs-App: Vercel-Status bzw. letzten Deploy prüfen.',
  ];
  if (key.startsWith('svc:')) return [
    'Ein Dienst läuft nicht.',
    '1. App › Systemstatus (Symbol oben rechts): Dienst starten bzw. neu starten.',
    '2. Startet er nicht: Log im Dienst-Ordner ansehen.',
  ];
  if (key.startsWith('cron:')) return [
    'Eine geplante Aufgabe (pg_cron) ist fehlgeschlagen. Die Meldung bleibt 24 h nach dem letzten Fehlschlag stehen.',
    '1. Supabase › Database › Cron Jobs: Fehlermeldung des Laufs ansehen.',
  ];
  if (key === 'cloud:net') return [
    'Ein Function-Aufruf aus einer geplanten Aufgabe kam mit HTTP-Fehler zurück.',
    '1. HTTP 401: Schlüssel im Cron-Befehl falsch. HTTP 5xx: Function abgestürzt.',
    '2. Supabase › Edge Functions › Logs der betroffenen Function ansehen.',
  ];
  if (key.startsWith('muc:')) return [
    'Problem bei der Heizung München (' + text + ').',
    '1. München-PC an? App Heizung München › Systemstatus prüfen.',
    '2. FENECON/Loxone im Münchner Netz erreichbar?',
  ];
  return ['Details in der App (Symbol oben rechts).'];
}

Deno.serve(async (req) => {
  const role = decodeJwtRole(req.headers.get('authorization'));
  if (role !== 'anon' && role !== 'service_role') return json({ error: 'unauthorized' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const summary: Record<string, unknown> = {};

  // 1) Webseiten ------------------------------------------------------------------------------------------
  const { data: setting } = await supabase.from('system_settings').select('value')
    .eq('key', 'system_status_websites').maybeSingle();
  const sites = (Array.isArray(setting?.value) ? setting!.value : [])
    .filter((w: any) => w && /^[A-Za-z0-9_.-]{1,80}$/.test(w.name) && /^https?:\/\//.test(w.url)) as Website[];
  const results = await Promise.all(sites.map(checkWebsite));
  const { error: webErr } = await supabase.rpc('system_web_report', { p_results: results });
  if (webErr) console.error('[web]', webErr.message);
  summary.websites = results.map((r) => `${r.name}: ${r.ok ? 'ok' : 'FEHLER'} (${r.detail})`);

  // 2) Probleme -------------------------------------------------------------------------------------------
  const { data: probData, error: probErr } = await supabase.rpc('system_problems');
  if (probErr) {
    console.error('[problems]', probErr.message);
    return json({ error: probErr.message }, 500);
  }
  const problems = (probData ?? []) as Problem[];
  const current = new Map(problems.map((p) => [p.key, p]));
  summary.problems = problems.length;

  // 3) Zustand abgleichen ---------------------------------------------------------------------------------
  const { data: stateRows } = await supabase.from('system_alert_state').select('*');
  const state = new Map((stateRows ?? []).map((r: any) => [r.key, r]));

  for (const p of problems) {
    const s = state.get(p.key);
    if (!s || s.resolved_at) {
      // neu oder nach Erledigung (> 15 min weg) wieder aufgetreten → neues Problem
      const row = { key: p.key, area: p.area, text: p.text, first_seen: nowIso, last_seen: nowIso,
                    notified_at: null, resolved_at: null, resolved_notified_at: null };
      await supabase.from('system_alert_state').upsert(row, { onConflict: 'key' });
      state.set(p.key, row);
    } else {
      // besteht weiter – auch wenn es zwischendurch kurz weg war (< 15 min): kein neues Problem
      await supabase.from('system_alert_state').update({ text: p.text, area: p.area, last_seen: nowIso }).eq('key', p.key);
      s.text = p.text; s.area = p.area; s.last_seen = nowIso;
    }
  }
  for (const [key, s] of state) {
    // erst nach 15 min am Stück ohne Problem als erledigt werten (vorher: sofort → Mail-Pingpong)
    if (!current.has(key) && !s.resolved_at && now - Date.parse(s.last_seen) >= RESOLVE_AFTER_MS) {
      await supabase.from('system_alert_state').update({ resolved_at: s.last_seen }).eq('key', key);
      s.resolved_at = s.last_seen;
    }
  }

  const fresh: any[] = [], fixed: any[] = [];
  for (const s of state.values()) {
    if (!s.resolved_at) {
      // nur melden, was JETZT besteht (nicht, was gerade in der 15-min-Wartezeit ist)
      if (!s.notified_at && current.has(s.key) && now - Date.parse(s.first_seen) >= MAIL_AFTER_MS) fresh.push(s);
    } else if (s.notified_at && !s.resolved_notified_at) {
      fixed.push(s); // nur „gelöst“ melden, was vorher auch als Problem gemeldet wurde
    }
  }

  // Mail ---------------------------------------------------------------------------------------------------
  const user = Deno.env.get('MAIL_USER');
  const pass = Deno.env.get('MAIL_PASS');
  const to = Deno.env.get('ALERT_EMAIL');
  if (fresh.length + fixed.length > 0) {
    if (!user || !pass || !to) {
      summary.mail = 'nicht konfiguriert (MAIL_USER/MAIL_PASS/ALERT_EMAIL fehlen)';
    } else {
      const open = problems.length;
      const more = (n: number) => (n > 1 ? ` (+${n - 1} weitere)` : '');
      const subject = fresh.length > 0
        ? `Heizung Venediger – Problem: ${fresh[0].text}${more(fresh.length)}`
        : `Heizung Venediger – gelöst: ${fixed[0].text}${more(fixed.length)}`;
      const parts: string[] = [];
      for (const s of fresh) {
        parts.push(`PROBLEM – ${s.area}\n${s.text}\nerkannt: ${fmt(s.first_seen)}\n\nWas tun:\n${loesung(s.key, s.text).join('\n')}`);
      }
      for (const s of fixed) {
        parts.push(`GELÖST – ${s.area}\n${s.text}\nDauer: ${fmt(s.first_seen)} bis ${fmt(s.resolved_at)} (${dauer(s.first_seen, s.resolved_at)})`);
      }
      parts.push(open === 0 ? 'Zurzeit laufen alle Prozesse.' : `Zurzeit offen: ${open}.`);
      parts.push(`Zu jedem Problem kommen genau zwei Mails: diese und eine, wenn es gelöst ist.\nSystemstatus in der App (Symbol oben rechts): ${APP_URL}`);
      try {
        const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
        await transport.sendMail({ from: `"Heizung Venediger" <${user}>`, to, subject, text: parts.join('\n\n────────\n\n') });
        if (fresh.length) await supabase.from('system_alert_state').update({ notified_at: nowIso }).in('key', fresh.map((s) => s.key));
        if (fixed.length) await supabase.from('system_alert_state').update({ resolved_notified_at: nowIso }).in('key', fixed.map((s) => s.key));
        summary.mail = `gesendet: ${subject}`;
      } catch (e) {
        // nicht als gemeldet markieren → nächster Lauf versucht es wieder
        summary.mail = `Fehler: ${e instanceof Error ? e.message : String(e)}`;
        console.error('[mail]', summary.mail);
      }
    }
  }

  // 4) Aufräumen ------------------------------------------------------------------------------------------
  const monthAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
  await supabase.from('service_commands').delete().lt('created_at', monthAgo);
  await supabase.from('system_alert_state').delete().lt('resolved_at', monthAgo);

  console.log('[system-alert]', JSON.stringify(summary));
  return json(summary);
});
