/**
 * Zentrale Datums-Utilities für konsistente Zeitzonen-Behandlung
 * 
 * WICHTIG: Verwende diese Funktionen statt toISOString().split('T')[0]!
 * toISOString() konvertiert zu UTC, was um Mitternacht das falsche Datum liefert.
 */

/**
 * Lokales Datum als String (YYYY-MM-DD) - KORREKT für lokale Zeitzone
 * Beispiel: Am 14.01.2026 um 00:30 MEZ gibt dies "2026-01-14" zurück
 * (nicht "2026-01-13" wie toISOString().split('T')[0])
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Lokale Mitternacht als ISO-String für DB-Queries
 * Gibt den ISO-String für 00:00:00 des lokalen Tages zurück
 */
export function getLocalMidnightISO(date: Date = new Date()): string {
  const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  return localMidnight.toISOString();
}

/**
 * Lokales Tagesende (23:59:59.999) als ISO-String für DB-Queries
 */
export function getLocalEndOfDayISO(date: Date = new Date()): string {
  const localEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return localEnd.toISOString();
}

/**
 * Konvertiere ein Datum (Date oder String) zu lokalem Datums-String
 */
export function formatLocalDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return getLocalDateString(d);
}

/**
 * Start eines bestimmten Tages in der Vergangenheit als ISO-String
 * @param daysAgo Anzahl Tage in der Vergangenheit (0 = heute)
 */
export function getLocalMidnightDaysAgoISO(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return getLocalMidnightISO(date);
}
