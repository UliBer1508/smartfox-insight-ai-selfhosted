// Modellprüfung „Estrich-Maßstab“ (25.11.2026) – doc/PRUEFUNG-ESTRICH-MASSSTAB-2026-11-25.md
//
// Uli: „Wichtig ist, dass wir nicht jetzt falsche Werte einbauen … die KI soll über die Zeit lernen und das Modell
// verbessern, bis wir zu 100 % vorhersagen können, was unsere Aktionen bewirken.“
//
// Frage: Wie groß ist der Wärmespeicher des Estrichs (kWh je °C) – und können die Messdaten das überhaupt entscheiden?
// Das Modell (modell.ts) hat je Raum zwei Speicher (Estrich S, Luft T); gemessen wird nur T. Speichermenge = Leistung / g.
// Gelernt liegt sie bei ~126 kWh/°C fürs Haus, physikalisch (Fläche × ~30 Wh/m²·°C) bei ~7.
//
// Vorgehen je Raum (nur lesen, nichts wird gespeichert):
//   • Daten zeitlich teilen: die ersten 70 % zum Lernen, die letzten 30 % nur zum Prüfen (echte Vorhersage, nicht
//     auswendig gelernt).
//   • frei lernen wie jede Nacht, und zusätzlich mit FEST vorgegebener Speichermenge (Vielfache der Physik).
//   • je Variante: Fehler der 12-h-Vorhersage im Prüfzeitraum – alle Fenster und nur Fenster, in denen geheizt wurde
//     („was bewirken unsere Aktionen“) – sowie die Speichermenge.
// Ist der Fehler über die Speichermengen fast gleich, können die Daten den Maßstab nicht entscheiden: Dann ändert ein
// physikalischer Wert die Vorhersage nicht, macht aber die kWh-Rechnung (Bereinigung, Eco-Bedarf) richtig.
import { lerneRaum, prognoseFehler, simFehler, type Fenster, type RaumParam } from './modell.ts';
import { aufbereiten, fensterFuer, type Daten } from './rechnen.ts';

export const WH_JE_M2_GRAD = 30;                 // Zementestrich ~6 cm: 2000 kg/m³ · 0,06 m · 0,9 kJ/(kg·K) ≈ 30 Wh/(m²·K)
export const FAKTOREN = [0.5, 1, 2, 4, 8, 16];   // Vielfache der physikalischen Speichermenge
const ANTEIL_LERNEN = 0.7;

const rund = (x: number, n = 2) => (Number.isFinite(x) ? +x.toFixed(n) : null);
const kwhJeGrad = (p: RaumParam, leistungW: number) => leistungW / Math.max(1e-6, p.g) / 1000;

function auswerten(p: RaumParam, leistungW: number, lern: Fenster[], pruef: Fenster[], pruefHeiz: Fenster[]) {
  const f = prognoseFehler(p, pruef, 47), fh = prognoseFehler(p, pruefHeiz, 47);
  return {
    kwh_je_grad: rund(kwhJeGrad(p, leistungW), 2),
    fehler_lernen: rund(Math.sqrt(simFehler(p, lern)), 3),        // Wurzel aus mittlerem Quadrat, 24-h-Fenster
    fehler_12h: rund(f.modell, 3), fehler_12h_heizen: rund(fh.modell, 3), n_heizen: fh.n,
    param: { k: rund(p.k, 5), g: rund(p.g, 4), u: rund(p.u, 4), r: rund(p.r, 3), s: rund(p.s, 4), c: rund(p.c, 4) },
  };
}

// 25.11.2026: Supabase begrenzt die Rechenzeit je Aufruf (WORKER_RESOURCE_LIMIT bei allen Räumen und Varianten auf
// einmal) – deshalb mit `faktor` je Aufruf nur EINE Variante: 'frei' oder ein Vielfaches der Physik.
export function modellPruefen(d: Daten, raumId: string, flaecheM2: number | null, faktor?: number | 'frei') {
  const a = aufbereiten(d);
  const raum = d.raeume.find((x: any) => x.id === raumId);
  if (!raum) throw new Error(`Raum ${raumId} unbekannt`);
  const leistungW = Number(raum.p);
  const w24 = fensterFuer(a, raumId, 6, 24), w12 = fensterFuer(a, raumId, 3, 12);
  if (w24.length < 8 || w12.length < 8) return { ok: false, raum: raum.name, grund: `zu wenig Daten (${w24.length} Fenster)` };
  const lern = w24.slice(0, Math.floor(w24.length * ANTEIL_LERNEN));
  const pruef = w12.slice(Math.ceil(w12.length * ANTEIL_LERNEN));
  const pruefHeiz = pruef.filter(w => w.h.slice(0, 48).some(h => h >= 0.5));
  const heizStd = lern.reduce((s, w) => s + w.h.reduce((x, h) => x + h, 0), 0) / 4 / 4;   // grob, Fenster überlappen 4-fach
  const phys = flaecheM2 && flaecheM2 > 0 ? flaecheM2 * WH_JE_M2_GRAD / 1000 : null;   // kWh je °C
  const ergebnis: any = {
    ok: true, raum: raum.name, leistung_w: leistungW, flaeche_m2: flaecheM2, heiz_std_lernen: rund(heizStd, 1),
    fenster_lernen: lern.length, fenster_pruefen: pruef.length, physik_kwh_je_grad: phys != null ? rund(phys, 2) : null,
  };
  if (faktor === 'frei' || faktor === undefined) {
    const frei = lerneRaum(lern, null, 0);
    ergebnis.fehler_12h_gleich = rund(prognoseFehler(frei, pruef, 47).gleich, 3);   // Vergleich „Temperatur bleibt gleich“
    ergebnis.frei = auswerten(frei, leistungW, lern, pruef, pruefHeiz);
  }
  if (phys != null && faktor !== 'frei') {
    ergebnis.fest = (faktor === undefined ? FAKTOREN : [faktor]).map(fk => {
      const g = leistungW / (1000 * phys * fk);                                     // °C/h bei voller Leistung
      return { faktor: fk, ...auswerten(lerneRaum(lern, null, 0, 400, { g }), leistungW, lern, pruef, pruefHeiz) };
    });
  }
  return ergebnis;
}
