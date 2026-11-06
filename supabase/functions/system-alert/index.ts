// system-alert – Systemstatus prüfen und bei Problemen eine Mail schicken  (05.11.2026)
// Doku: doc/SYSTEMSTATUS-2026-11-05.md
//
// Läuft alle 5 min per pg_cron (system-alert-5min, SQL 22):
//   1) Webseiten aus system_settings.system_status_websites aufrufen → system_services (host 'cloud')
//   2) system_problems() lesen – dieselbe Liste, die die App in der Kopfleiste zeigt
//   3) system_alert_state abgleichen und per Mail melden:
//        - neues Problem, das seit mind. 4 min besteht (ein Aussetzer löst keine Mail aus)
//        - Problem ist wieder weg („wieder in Ordnung“)
//        - Erinnerung, wenn ein Problem nach 24 h immer noch besteht
//   4) Aufräumen: alte Befehle (30 Tage), erledigte Mail-Zustände (30 Tage)
//
// Mail über Gmail-SMTP (Port 465, wie der Wallbox-Mailer). Secrets: MAIL_USER, MAIL_PASS (App-Passwort),
// ALERT_EMAIL (Empfänger, mehrere mit Komma). Fehlen sie, läuft alles außer dem Versand.
// Aufruf erlaubt mit anon- oder service_role-JWT (Muster aus auto-resolve-api-errors); verify_jwt = false.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const APP_URL = 'https://heizung.steinbockchalets-charge.com';
const MAIL_AFTER_MS = 4 * 60 * 1000;        // Problem muss so lange bestehen
const REMIND_AFTER_MS = 24 * 3600 * 1000;   // Erinnerung, wenn noch offen

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
      // neu oder nach Erledigung wieder aufgetreten → neu beginnen
      const row = { key: p.key, area: p.area, text: p.text, first_seen: nowIso, last_seen: nowIso,
                    notified_at: null, resolved_at: null, resolved_notified_at: null };
      await supabase.from('system_alert_state').upsert(row, { onConflict: 'key' });
      state.set(p.key, row);
    } else {
      await supabase.from('system_alert_state').update({ text: p.text, area: p.area, last_seen: nowIso }).eq('key', p.key);
      s.text = p.text; s.area = p.area;
    }
  }
  for (const [key, s] of state) {
    if (!current.has(key) && !s.resolved_at) {
      await supabase.from('system_alert_state').update({ resolved_at: nowIso }).eq('key', key);
      s.resolved_at = nowIso;
    }
  }

  const fresh: any[] = [], remind: any[] = [], fixed: any[] = [];
  for (const s of state.values()) {
    if (!s.resolved_at) {
      if (!s.notified_at && now - Date.parse(s.first_seen) >= MAIL_AFTER_MS) fresh.push(s);
      else if (s.notified_at && now - Date.parse(s.notified_at) >= REMIND_AFTER_MS) remind.push(s);
    } else if (s.notified_at && !s.resolved_notified_at) {
      fixed.push(s); // nur melden, was vorher auch gemeldet wurde
    }
  }

  // Mail ---------------------------------------------------------------------------------------------------
  const user = Deno.env.get('MAIL_USER');
  const pass = Deno.env.get('MAIL_PASS');
  const to = Deno.env.get('ALERT_EMAIL');
  if (fresh.length + remind.length + fixed.length > 0) {
    if (!user || !pass || !to) {
      summary.mail = 'nicht konfiguriert (MAIL_USER/MAIL_PASS/ALERT_EMAIL fehlen)';
    } else {
      const open = problems.length;
      const subject = fresh.length > 0
        ? `Heizung Venediger: ${fresh[0].text}${fresh.length > 1 ? ` (+${fresh.length - 1} weitere)` : ''}`
        : remind.length > 0
          ? `Heizung Venediger: immer noch ${open === 1 ? '1 Problem' : `${open} Probleme`}`
          : `Heizung Venediger: wieder in Ordnung${open > 0 ? ` (noch ${open} offen)` : ''}`;
      const line = (s: any) => `• ${s.area}: ${s.text}`;
      const parts: string[] = [];
      if (fresh.length) parts.push('Neues Problem:\n' + fresh.map(line).join('\n'));
      if (remind.length) parts.push('Besteht seit über 24 Stunden:\n' + remind.map(line).join('\n'));
      if (fixed.length) parts.push('Wieder in Ordnung:\n' + fixed.map((s) => `• ${s.area}: ${s.text} (seit ${fmt(s.first_seen)})`).join('\n'));
      parts.push(open === 0 ? 'Zurzeit laufen alle Prozesse.' : `Zurzeit offen: ${open}.`);
      parts.push(`Systemstatus in der App (Symbol oben rechts): ${APP_URL}`);
      try {
        const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
        await transport.sendMail({ from: `"Heizung Venediger" <${user}>`, to, subject, text: parts.join('\n\n') });
        const sentKeys = [...fresh, ...remind].map((s) => s.key);
        if (sentKeys.length) await supabase.from('system_alert_state').update({ notified_at: nowIso }).in('key', sentKeys);
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
