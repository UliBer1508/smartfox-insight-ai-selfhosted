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

export type Grund = { text: string; art: 'manuell' | 'gestoert' | 'sonne' | 'abschalten' | 'nachlauf' | 'automatik' | 'unbekannt' };
/** Stufe A (16.11.2026): Die Steuerung hält einen Befehl über die Haltezeit, statt ihn gleich umzukehren
 *  (system_settings „haltezeit_aktiv“, doc/FIX-HIN-UND-HER-STUFE-A-2026-11-16.md). */
export type Halt = { room_id: string; bis: string; befehl_wert: number; befehl_um: string; vorschlag: number };
export function haltText(h: Halt | undefined, nowMs = Date.now()): string {
  if (!h || new Date(h.bis).getTime() <= nowMs) return '';
  return ` · Haltezeit bis ${fmtTime(h.bis)}: Befehl ${fmtC(Number(h.befehl_wert))} von ${fmtTime(h.befehl_um)} bleibt (sonst ${fmtC(Number(h.vorschlag))}), damit es nicht hin und her geht`;
}
/** So lange nach einem Ausschaltbefehl gilt „heizt über Soll“ noch als normale Verzögerung (min). */
export const ABSCHALT_VERZOEGERUNG_MIN = 15;

/** Warum heizt dieser Raum? Reihenfolge: manuell → nicht steuerbar/Sonne → Nachlauf → Begründung der Automatik. */
export function grundFuer(r: Room, modus: DayModeRoom | undefined, befehle: Befehl[], t: TState | undefined, halt?: Halt): Grund {
  const g = grundOhneHalt(r, modus, befehle, t);
  const ht = haltText(halt);
  return ht && (g.art === 'automatik' || g.art === 'nachlauf' || g.art === 'unbekannt') ? { ...g, text: g.text + ht } : g;
}

function grundOhneHalt(r: Room, modus: DayModeRoom | undefined, befehle: Befehl[], t: TState | undefined): Grund {
  const cur = Number(r.current_temp) || 0;
  const soll = Number(r.target_temp) || 0;
  const ueberSoll = cur > 0 && soll > 0 && cur >= soll;
  const befundText = t?.befund ? ` · Thermostat: ${t.befund}` : '';
  if (aktivBis(r.manual_override_until))
    return { art: 'manuell', text: `Manuell bis ${fmtTime(r.manual_override_until)} (${fmtC(soll)})${ueberSoll ? ', Thermostat heizt noch nach' : ''}${befundText}` };
  if (r.nicht_steuerbar_seit)
    return { art: 'gestoert', text: `Nicht steuerbar seit ${fmtTime(r.nicht_steuerbar_seit)}${r.nicht_steuerbar_grund ? ` (${r.nicht_steuerbar_grund})` : ''} – heizt, wie das Thermostat will` };
  if (r.fuehler_sonne_seit)
    return { art: 'sonne', text: `Sonne auf dem Fühler seit ${fmtTime(r.fuehler_sonne_seit)} – Automatik rechnet mit gehaltenem Wert${befundText}` };
  if (t?.befund && /über soll/i.test(t.befund)) {
    // 16.11.2026: „heizt über Soll“ ist eine Momentaufnahme beim Auslesen (alle 5 min). Kam der Befehl, der das Soll gesenkt
    // hat, vor weniger als 15 min, meldet das Thermostat nur verzögert – kein Fehler (Bad Uli/Waschraum 11:12 → 11:15).
    const senk = befehle.find(b => b.value != null && Number(b.value) <= soll + 0.05);
    const minSeit = senk ? (Date.now() - new Date(senk.created_at).getTime()) / 60_000 : Infinity;
    if (minSeit < ABSCHALT_VERZOEGERUNG_MIN)
      return { art: 'abschalten', text: `Ausschaltbefehl um ${fmtTime(senk!.created_at)} (Soll ${fmtC(soll)}) – Thermostat meldet beim letzten Auslesen noch „heizt“, das ist normal` };
    return { art: 'gestoert', text: `Thermostat heizt seit ${senk ? fmtTime(senk.created_at) : 'über 3 h'} trotz Soll ${fmtC(soll)} (Ist ${fmtC(cur)}) – folgt dem Befehl nicht` };
  }
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
  // Nur echte Störungen (länger als 15 min über Soll oder als nicht steuerbar markiert), mit konkretem Schritt
  if (gestoert.length > 0)
    out.push(`${gestoert.map(r => r.name).join(', ')}: Thermostat folgt der Automatik seit über ${ABSCHALT_VERZOEGERUNG_MIN} min nicht. `
      + 'Die Wirkungsprüfung testet es und markiert es als „nicht steuerbar“. Hilft das nicht: Thermostat am Gerät aus- und wieder einschalten.');
  return out;
}


// ---------------------------------------------------------------- Abweichung gemessen ↔ laut Thermostaten
// 16.11.2026: Uli – „ich kann hier nicht antworten und weiß die Antwort nicht, das sollte doch die KI wissen“.
// Statt einer Frage erklärt die Karte die Abweichung selbst, soweit die Daten es hergeben:
//   1. Fronius misst nur alle 5 min: Räume, die nach der Messung eingeschaltet haben, zählen für den Vergleich nicht.
//      Räume, die seit der Messung ausgeschaltet haben (last_heating_end > Messzeit), zählen mit.
//   2. Messung älter als 7 min → kein Vergleich.
//   3. Bleiben „zu wenig“: Welche Kombination der heizenden Räume passt am besten zur Messung? Die übrigen Räume heizen
//      wahrscheinlich gerade nicht, obwohl das Thermostat „heizt“ meldet.
//   4. Bleibt „zu viel“: mit Sonne wahrscheinlich Warmwasser (Heizstab, Smartfox, nicht messbar), ohne Sonne ein Gerät im Haus.
export const ABWEICHUNG_HINWEIS_W = 500;
export type RaumMitZeit = Room & { heizt_seit?: string | null; last_heating_end?: string | null };

export function erklaereAbweichung(o: {
  gemessenW: number | null; messungAt: string | null | undefined; heizend: RaumMitZeit[]; alleRaeume: RaumMitZeit[];
  mitPv: boolean; autoText: string; nowMs?: number;
  /** Räume mit Ausschaltbefehl vor < 15 min, die noch „heizt“ melden (grundFuer art 'abschalten'). */
  abschaltIds?: Set<string>;
}): { ok: boolean; text: string } {
  const now = o.nowMs ?? Date.now();
  if (o.gemessenW == null || !o.messungAt) return { ok: true, text: 'Keine aktuellen Fronius-Daten.' };
  const messMs = new Date(o.messungAt).getTime();
  const alterMin = Math.round((now - messMs) / 60_000);
  if (alterMin > 7) return { ok: false, text: `Die letzte Fronius-Messung ist ${alterMin} min alt – kein Vergleich möglich. Läuft der Fronius-Collector?` };

  // 1) Stand zur Messzeit
  const spaeter = o.heizend.filter(r => r.heizt_seit && new Date(r.heizt_seit).getTime() > messMs);
  const vorher = o.heizend.filter(r => !spaeter.includes(r));
  const seitAus = o.alleRaeume.filter(r => !r.is_heating && r.last_heating_end && new Date(r.last_heating_end).getTime() > messMs);
  const zurMessung = [...vorher, ...seitAus];
  const soll = zurMessung.reduce((s, r) => s + roomPowerW(r), 0);
  const diff = o.gemessenW - soll;
  const zeitText = (spaeter.length || seitAus.length)
    ? ` Fronius misst nur alle 5 min (letzte Messung ${fmtTime(o.messungAt)}):`
      + (spaeter.length ? ` ${spaeter.map(r => `${r.name} heizt erst seit ${fmtTime(r.heizt_seit)}`).join(', ')}` : '')
      + (spaeter.length && seitAus.length ? ';' : '')
      + (seitAus.length ? ` ${seitAus.map(r => `${r.name} hat um ${fmtTime(r.last_heating_end)} aufgehört`).join(', ')}` : '')
      + ' – zählt für den Vergleich noch so, wie es zur Messung war.'
    : '';

  if (Math.abs(diff) <= ABWEICHUNG_HINWEIS_W)
    return { ok: true, text: `Messung und Thermostate passen zusammen.${zeitText}` };

  if (diff < 0) {
    // 2b) Räume mit frischem Ausschaltbefehl zuerst herausnehmen – sie melden „heizt“ nur verzögert
    const abs = zurMessung.filter(r => o.abschaltIds?.has(r.id));
    if (abs.length > 0) {
      const ohne = soll - abs.reduce((s, r) => s + roomPowerW(r), 0);
      if (Math.abs(o.gemessenW - ohne) <= ABWEICHUNG_HINWEIS_W)
        return { ok: true, text: `Messung und Thermostate passen zusammen: ${abs.map(r => r.name).join(', ')} `
          + `${abs.length === 1 ? 'hat' : 'haben'} gerade den Ausschaltbefehl bekommen und ziehen keinen Strom mehr – `
          + `das Thermostat meldet „heizt“ nur verzögert.${zeitText}` };
    }
    // 3) Beste Kombination der heizenden Räume zur Messung (höchstens 12 Räume → 4096 Kombinationen)
    const kand = zurMessung.slice(0, 12);
    let best = { mask: (1 << kand.length) - 1, fehler: Math.abs(diff) };
    for (let m = 0; m < (1 << kand.length); m++) {
      let w = 0;
      for (let i = 0; i < kand.length; i++) if (m & (1 << i)) w += roomPowerW(kand[i]);
      const f = Math.abs(o.gemessenW - w);
      if (f < best.fehler - 1) best = { mask: m, fehler: f };
    }
    const aus = kand.filter((_, i) => !(best.mask & (1 << i)));
    if (aus.length > 0 && best.fehler <= 300) {
      return { ok: false, text: `${fmtKW(-diff)} weniger als gemeldet.${zeitText} Die Messung passt, wenn ${aus.map(r => r.name).join(', ')} gerade nicht `
        + `${aus.length === 1 ? 'heizt' : 'heizen'}: Das Thermostat meldet „heizt“, zieht aber (noch) keinen Strom. `
        + 'Bleibt das über mehrere Messungen so, stimmt die Raumleistung nicht (Einstellungen › Räume).' };
    }
    return { ok: false, text: `${fmtKW(-diff)} weniger als gemeldet.${zeitText} Keine Kombination der heizenden Räume passt – vermutlich stimmen mehrere Raumleistungen nicht (Einstellungen › Räume).` };
  }
  // 4) zu viel
  return { ok: false, text: `${fmtKW(diff)} mehr, als die heizenden Räume erklären.${zeitText} ${o.autoText}. `
    + (o.mitPv
      ? 'Wahrscheinlich Warmwasser: Der Smartfox gibt Überschuss an den Heizstab (keine Schnittstelle, daher nicht messbar).'
      : 'Ohne Sonne wahrscheinlich ein Gerät im Haus (Herd, Espressomaschine) oder Warmwasser.') };
}
