// Reine Helfer fuer die Anzeige der naechtlichen Datensicherung.
// GLEICHE Datei in Hausverwaltung (hausmanagement-selfhosted) und Heizung
// (smartfox-insight-ai-selfhosted), jeweils src/lib/backupStatus.ts - Änderungen in beiden
// Repos gleich halten. Verwendet von: Einstellungen -> Datensicherung
// (HV BackupSettingsCard.tsx, Heizung BackupSettingsSection.tsx) und Systemstatus-Fenster
// (Karte "Sicherungen", SystemBackupsCard.tsx).
// Datenquelle: Tabelle backup_runs der jeweiligen Datenbank, geschrieben vom Skript
// Backup-Supabase.ps1 auf PC München und PC Österreich (Ersatz).

export type BackupRunStatus = 'erfolgreich' | 'warnungen' | 'fehlgeschlagen' | 'pausiert';

export interface BackupRun {
  id: string;
  started_at: string;
  finished_at: string;
  status: BackupRunStatus;
  host: string | null;
  backup_folder: string | null;
  db_bytes: number | null;
  table_count: number | null;
  storage_files: number | null;
  storage_bytes: number | null;
  storage_skipped: boolean;
  deleted_old: number;
  retention_days: number | null;
  schedule_time: string | null;
  messages: string[];
  script_version: string | null;
}

// Gleicher Wortlaut wie in LETZTE-SICHERUNG.txt auf dem PC (Designregel:
// ein Zustand, ein Text - ueberall).
export const BACKUP_STATUS_LABELS: Record<BackupRunStatus, string> = {
  erfolgreich: 'Erfolgreich',
  warnungen: 'Mit Warnungen',
  fehlgeschlagen: 'Fehlgeschlagen',
  pausiert: 'Pausiert',
};

/** Bytes lesbar in deutscher Schreibweise: 4,7 MB / 820 KB / 12 Bytes. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–';
  if (bytes < 1024) return `${bytes} Bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}

/** Letzter Lauf, bei dem die Datenbank wirklich gesichert wurde (auch mit Warnungen). */
export function findLastSuccessfulRun(runs: BackupRun[]): BackupRun | null {
  return runs.find((r) => r.status === 'erfolgreich' || r.status === 'warnungen') ?? null;
}

/**
 * Ist die letzte gelungene Sicherung zu alt?
 * `runs` muss nach finished_at absteigend sortiert sein (wie die Abfrage liefert).
 * Ohne jede gelungene Sicherung gilt: ueberfaellig.
 */
export function isBackupOverdue(runs: BackupRun[], warnAfterHours: number, now: Date = new Date()): boolean {
  const last = findLastSuccessfulRun(runs);
  if (!last) return true;
  const ageHours = (now.getTime() - new Date(last.finished_at).getTime()) / 36e5;
  return ageHours > warnAfterHours;
}

// ------------------------------------------------------------------
// Zwei Sicherungs-PCs (13.11.2026, übernommen aus Heizung München,
// frontend/src/Datensicherung.jsx):
//  - PC München (MINIPC-WEIDMANN) sichert jede Nacht.
//  - PC Österreich (MINIPC-VENEDIGE) ist ERSATZ (Skript v5, "StandbyHours"):
//    Er sichert nur, wenn kein anderer Rechner in den letzten StandbyHours
//    erfolgreich war, und meldet sich sonst nur mit einem Lebenszeichen in
//    system_settings.backup_standby.
//  Rot: keine gelungene Sicherung innerhalb der Warnschwelle.
//  Gelb: Ersatz ist eingesprungen (Hauptrechner prüfen) oder Ersatz meldet sich nicht.
// ------------------------------------------------------------------

/** Lebenszeichen des Ersatz-PCs (system_settings.backup_standby). */
export interface BackupStandby {
  host: string;
  result: string; // 'uebersprungen' | 'gesichert' …
  main_host?: string | null;
  checked_at: string;
  main_finished?: string | null;
  standby_hours?: number | null;
  script_version?: string | null;
}

export interface RechnerStand {
  host: string | null;
  letzter: BackupRun | null;
  gelungen: BackupRun | null;
  ueberfaellig: boolean;
  ersatz?: boolean;
  beat?: BackupStandby;
  zuletztGemeldet?: string | null;
}

const istGelungen = (r: BackupRun) => r.status === 'erfolgreich' || r.status === 'warnungen';

/** Rechnername → verständlicher Name (Windows kürzt auf 15 Zeichen: MINIPC-VENEDIGE). */
export function rechnerName(host: string | null | undefined): string {
  if (!host) return 'unbekannter Rechner';
  const h = host.toUpperCase();
  if (h.includes('WEIDMANN')) return 'PC München';
  if (h.includes('VENEDIG')) return 'PC Österreich';
  return host;
}

/** Stand je Rechner: letzter Lauf, letzte gelungene Sicherung, überfällig? `runs` neueste zuerst. */
export function standJeRechner(runs: BackupRun[], warnStunden: number, jetzt: number = Date.now()): RechnerStand[] {
  const map = new Map<string, RechnerStand>();
  for (const r of runs) {
    const key = r.host || '?';
    if (!map.has(key)) map.set(key, { host: r.host, letzter: r, gelungen: null, ueberfaellig: false });
    const e = map.get(key)!;
    if (!e.gelungen && istGelungen(r)) e.gelungen = r;
  }
  return [...map.values()].map((e) => ({
    ...e,
    ueberfaellig: !e.gelungen || (jetzt - new Date(e.gelungen.finished_at).getTime()) / 36e5 > warnStunden,
  }));
}

/** Gesamturteil mit Ersatz-Rechner. Gleiche Regeln wie in der München-App. */
export function bewerteSicherung(
  runs: BackupRun[],
  standby: BackupStandby | null,
  warnStunden: number,
  jetzt: number = Date.now(),
) {
  const alt = (ts?: string | null) => !ts || (jetzt - new Date(ts).getTime()) / 36e5 > warnStunden;
  const rechner = standJeRechner(runs, warnStunden, jetzt);
  let ersatz: RechnerStand | null = null;
  if (standby?.host) {
    ersatz = rechner.find((r) => r.host === standby.host) ?? null;
    if (!ersatz) {
      ersatz = { host: standby.host, letzter: null, gelungen: null, ueberfaellig: true };
      rechner.push(ersatz);
    }
    ersatz.ersatz = true;
    ersatz.beat = standby;
    const zeiten = [standby.checked_at, ersatz.letzter?.finished_at]
      .filter(Boolean)
      .map((t) => new Date(t as string).getTime());
    ersatz.zuletztGemeldet = zeiten.length ? new Date(Math.max(...zeiten)).toISOString() : null;
  }
  // Hauptrechner zuerst, Ersatz darunter
  rechner.sort((a, b) => Number(!!a.ersatz) - Number(!!b.ersatz));
  const haupt = rechner.filter((r) => !r.ersatz);
  const neueste = findLastSuccessfulRun(runs);
  const rot = alt(neueste?.finished_at);
  const gelb: string[] = [];
  if (!rot) {
    for (const h of haupt) {
      if (h.ueberfaellig) {
        gelb.push(
          `${rechnerName(h.host)} hat seit mehr als ${warnStunden} h nicht gesichert` +
            (ersatz ? ` – ${rechnerName(ersatz.host)} ist eingesprungen` : '') +
            `. Die Daten sind gesichert, ${rechnerName(h.host)} bitte prüfen.`,
        );
      }
    }
  }
  if (ersatz && alt(ersatz.zuletztGemeldet)) {
    gelb.push(
      `${rechnerName(ersatz.host)} (Ersatz) meldet sich seit mehr als ${warnStunden} h nicht – fällt der Hauptrechner aus, sichert niemand. Bitte prüfen.`,
    );
  }
  return { rechner, ersatz, neueste, rot, gelb };
}

/** Zeigt der Ersatz-PC zuletzt „übersprungen“ (Lebenszeichen neuer als sein letzter Lauf)? */
export function ersatzUebersprungen(r: RechnerStand): boolean {
  return (
    !!r.ersatz &&
    r.beat?.result === 'uebersprungen' &&
    (!r.letzter || new Date(r.beat.checked_at).getTime() > new Date(r.letzter.finished_at).getTime())
  );
}

// ------------------------------------------------------------------
// Kurzfassung je Datenbank für das Systemstatus-Fenster (23.11.2026):
// Karte „Sicherungen“ unter „Alles läuft“ – Hausverwaltung und Heizung.
// Rot (keine gelungene Sicherung in der Warnschwelle) zählt als Problem im
// Symbol der Kopfleiste, Gelb nur als Hinweis.
// ------------------------------------------------------------------

export interface SicherungKurz {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'off';
  text: string;
  /** Text für die Problemliste (nur bei Rot) */
  problem: string | null;
}

export function sicherungKurz(
  label: string,
  runs: BackupRun[] | null,
  standby: BackupStandby | null,
  warnStunden: number,
  aktiv = true,
  jetzt: number = Date.now(),
): SicherungKurz {
  if (!runs) return { label, tone: 'off', text: 'Stand nicht abrufbar', problem: null };
  if (!aktiv) return { label, tone: 'off', text: 'pausiert (Einstellungen › Datensicherung)', problem: null };
  const { neueste, rot, gelb, ersatz } = bewerteSicherung(runs, standby, warnStunden, jetzt);
  const teile: string[] = [];
  if (neueste) {
    const std = Math.round((jetzt - new Date(neueste.finished_at).getTime()) / 36e5);
    const wann = std < 1 ? 'vor weniger als 1 h' : std < 48 ? `vor ${std} h` : `vor ${Math.round(std / 24)} Tagen`;
    teile.push(`zuletzt ${wann} · ${rechnerName(neueste.host)} · ${formatBytes(neueste.db_bytes)}`);
  } else {
    teile.push('keine gelungene Sicherung in 14 Tagen');
  }
  if (ersatz && ersatzUebersprungen(ersatz)) teile.push(`${rechnerName(ersatz.host)} übersprungen`);
  if (gelb.length) teile.push(gelb[0]);
  return {
    label,
    tone: rot ? 'bad' : gelb.length ? 'warn' : 'ok',
    text: teile.join(' · '),
    problem: rot
      ? `${label}: ${neueste ? `letzte gelungene Sicherung vor mehr als ${warnStunden} h` : 'keine gelungene Sicherung'} – Sicherungs-PCs prüfen.`
      : null,
  };
}
