// Reine Logik der Karte „Heizung jetzt“: Begründung je heizendem Raum und Hinweise „Netzstrom sparen“
// (16.11.2026, doc/FIX-HEIZUNG-JETZT-BEGRUENDUNG-2026-11-16.md). Ohne Datenbankzugriff, damit testbar.
import { Room } from '@/types/room';
import { HeatingSettings } from '@/types/heating';
import { getViennaMinutesSinceMidnight } from '@/lib/dateUtils';

export const TZ = 'Europe/Vienna';
export const roomPowerW = (r: Room) => Number(r.calculated_power_w) || Number(r.heating_power_w) || 800;
export const fmtKW = (w: number) => `${(w / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`;
export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '–';
export type DayModeRoom = { room_id: string; target: number | null; why: string | null };
export type Befehl = { room_id: string; value: number | null; reason: string | null; created_at: string };
export type TState = { room_id: string; befund: string | null; dp101: string | null };
export type Prognose = { hourly: Record<string, number>; sunrise: string | null } | null;

export const fmtC = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
/** Min eines Raums wie in pv-automation: max(Nachtwert, Untergrenze). */
const minOf = (r: Room) => Math.max(Number(r.night_temp) || 0, Number(r.wait_min_temp) || 0);
const aktivBis = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() > Date.now();

const MODUS: Record<string, string> = { battery_gate: 'Batterie-Schutz', evening: 'Abend', wait: 'Wartetag', grid: 'ohne PV', pv: 'PV' };
/** Begründungstext der Automatik lesbar machen: Emoji/„Tagesmodus <modus>:“ → Klartext, „→ 22.5°C“ am Ende weg. */
export function klartext(why: string): string {
  return why
    .replace(/^[^\p{L}\d]+/u, '')
    .replace(/^Tagesmodus\s+(\w+):\s*/, (_, m: string) => `${MODUS[m] ?? m}: `)
    .replace(/^Nacht:\s*/, '')
    .replace(/\s*→\s*[\d.,]+\s*°C$/, '')
    .replace(/\s*\(im Schaltband[^)]*\)/, '')
    .replace(/(\d+\.\d)\d+/g, '$1');
}

export type Grund = { text: string; art: 'manuell' | 'gestoert' | 'nachlauf' | 'automatik' | 'unbekannt' };

/** Warum heizt dieser Raum? Reihenfolge: manuell → nicht steuerbar/Sonne → Nachlauf → Begründung der Automatik. */
export function grundFuer(r: Room, modus: DayModeRoom | undefined, befehle: Befehl[], t: TState | undefined): Grund {
  const cur = Number(r.current_temp) || 0;
  const soll = Number(r.target_temp) || 0;
  const ueberSoll = cur > 0 && soll > 0 && cur >= soll;
  const befundText = t?.befund ? ` · Thermostat: ${t.befund}` : '';
  if (aktivBis(r.manual_override_until))
    return { art: 'manuell', text: `Manuell bis ${fmtTime(r.manual_override_until)} (${fmtC(soll)})${ueberSoll ? ', Thermostat heizt noch nach' : ''}${befundText}` };
  if (r.nicht_steuerbar_seit)
    return { art: 'gestoert', text: `Nicht steuerbar seit ${fmtTime(r.nicht_steuerbar_seit)}${r.nicht_steuerbar_grund ? ` (${r.nicht_steuerbar_grund})` : ''} – heizt, wie das Thermostat will` };
  if (r.fuehler_sonne_seit)
    return { art: 'gestoert', text: `Sonne auf dem Fühler seit ${fmtTime(r.fuehler_sonne_seit)} – Automatik rechnet mit gehaltenem Wert${befundText}` };
  if (t?.befund && /über soll/i.test(t.befund))
    return { art: 'gestoert', text: `Thermostat heizt über Soll (Soll ${fmtC(soll)}, Ist ${fmtC(cur)}) – folgt dem Befehl nicht` };
  if (ueberSoll) {
    // Anstoß: in der letzten Stunde ein Sollwert deutlich über dem heutigen Soll → Thermostat läuft bis Anstoß-Schaltpunkt nach
    const stoss = befehle.find(b => Number(b.value) >= soll + 0.5 && Date.now() - new Date(b.created_at).getTime() < 3600_000);
    return { art: 'nachlauf', text: `Ziel ${fmtC(soll)} erreicht, Thermostat heizt nach`
      + (stoss ? ` (Anstoß ${fmtC(Number(stoss.value))} um ${fmtTime(stoss.created_at)})` : t?.dp101 ? ` (Schaltband ±${fmtC(Number(t.dp101) / 10)})` : '') };
  }
  if (modus?.why) return { art: 'automatik', text: klartext(modus.why) };
  const letzter = befehle.find(b => b.reason);
  if (letzter?.reason) return { art: 'automatik', text: `${klartext(letzter.reason)} (Befehl ${fmtTime(letzter.created_at)})` };
  return { art: 'unbekannt', text: 'Keine Begründung der Automatik (Raum noch nicht neu bewertet)' };
}

/** Prognose der nächsten 3 h: höchster Stundenwert und seine Stunde (Schlüssel „YYYY-MM-DD HH:MM:SS“, Ortszeit). */
function pvBald(p: Prognose): { w: number; um: string } | null {
  if (!p) return null;
  const jetzt = new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace('T', ' ');
  const bis = new Date(Date.now() + 3 * 3600_000).toLocaleString('sv-SE', { timeZone: TZ }).replace('T', ' ');
  let best: { w: number; um: string } | null = null;
  for (const [k, w] of Object.entries(p.hourly)) {
    if (k < jetzt.slice(0, 13) || k > bis) continue;
    if (!best || Number(w) > best.w) best = { w: Number(w), um: k.slice(11, 16) };
  }
  return best;
}

/** Hinweise, wie gerade Netzstrom gespart werden könnte. Reine Anzeige – ändert nichts. */
export function sparHinweise(o: {
  heizend: Room[]; gruende: Map<string, Grund>; netzW: number; night: boolean; settings: HeatingSettings;
  prognose: Prognose; befund: Map<string, TState>;
}): string[] {
  const out: string[] = [];
  const bald = pvBald(o.prognose);
  const pvKommt = !!bald && bald.w >= 2000;
  const ausNetz = o.netzW > 200;

  // Kein Hinweis „Vorlauf senken“ (16.11.2026 nachgerechnet, doc/FIX-BATTERIE-SCHUTZ-PINGPONG-2026-11-16.md):
  // Räume kühlen nahe Min mit 0,3–0,9 °C/h ab, schon mit Vorlauf 0,2 °C startete jeder zweite Heizvorgang unter Min.
  // Ohne Vorlauf fielen Räume unter Min; Warten verschiebt das Heizen nur, statt Netzstrom zu sparen.
  // pv_forecasts.sunrise ist eine Uhrzeit („08:00:00“, Ortszeit) – Vergleich in Minuten seit Mitternacht (Wien).
  if (o.night && o.prognose?.sunrise && o.settings.night_end_time) {
    const [h, m] = o.prognose.sunrise.split(':').map(Number);
    const nachSonne = Number.isFinite(h) ? getViennaMinutesSinceMidnight() - (h * 60 + (m || 0)) : -1;
    if (nachSonne > 60 && (ausNetz || pvKommt))
      out.push(`Nachtbetrieb bis ${o.settings.night_end_time.slice(0, 5)}, Sonnenaufgang war ${o.prognose.sunrise.slice(0, 5)}. `
        + 'Bis Nachtende wartet die Steuerung nicht auf PV. Vorschlag: Nachtende näher an den Sonnenaufgang legen.');
  }
  // 3) Nachlauf über das Ziel hinaus
  const nach = o.heizend.filter(r => o.gruende.get(r.id)?.art === 'nachlauf');
  if (ausNetz && nach.length > 0)
    out.push(`${nach.map(r => r.name).join(', ')} ${nach.length === 1 ? 'heizt' : 'heizen'} über das Ziel hinaus (${fmtKW(nach.reduce((s, r) => s + roomPowerW(r), 0))}). `
      + 'Ursache ist das Schaltband des Thermostats bzw. der Anstoß-Sollwert.');
  // 4) Thermostate, die nicht folgen
  const gestoert = o.heizend.filter(r => o.gruende.get(r.id)?.art === 'gestoert');
  if (gestoert.length > 0)
    out.push(`${gestoert.map(r => r.name).join(', ')}: Thermostat folgt der Automatik nicht – prüfen (Protokoll › Thermostate).`);
  return out;
}

