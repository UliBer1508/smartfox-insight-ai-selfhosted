// EMHASS im Vergleich (22.11.2026) – doc/EMHASS-VERGLEICH-2026-11-22.md
//
// Uli: „Warum versuchen wir nicht das EMHASS-Modell? Wir lassen es nebenher laufen und sehen, was es bringt. Wenn wir
// wissen, welches Modell besser ist, schalten wir es scharf.“ – Stufe 1: EMHASS fast im Original (Open Source, MIT,
// läuft auf dem Österreich-PC, C:\EMHASS), nur mit unseren Daten und Regeln als Grenzen.
//
// Ablauf je Tag (Brücke emhass_bruecke.py, 03:45):
//   1. aktion emhass_eingabe tag=…  → genau die Daten der Gegenrechnung (echte PV ab Mitternacht, Temperaturen um
//      Mitternacht, Batterie, Außentemperatur) im Format von EMHASS „naive-mpc-optim“, 30-min-Schritte.
//   2. EMHASS rechnet den Plan (lineare Optimierung, HiGHS).
//   3. aktion emhass_bewerten → der EMHASS-Plan wird mit DEMSELBEN Raummodell und derselben Batterie-Logik bewertet wie
//      die tatsächliche Steuerung und unser Planer (bewerte) und in heizplan_vergleich.emhass gespeichert.
//      Fair: gleicher Maßstab für alle drei; Netz bereinigt um die Wärme am Tagesende wie beim Planer.
//
// Raummodell für EMHASS: EMHASS kennt je Raum nur EINEN Wärmespeicher (Raumtemperatur, Aufheizrate α, Abkühlkonstante γ,
// Verzögerung). Wir leiten α, γ aus unserem gelernten Modell (Estrich + Luft) ab: γ = langsamste Eigenzeit des
// Zwei-Speicher-Modells, α so, dass der Dauerzustand gleich ist (ΔT = r·g/k je Heizanteil), Verzögerung = schnelle
// Eigenzeit (höchstens 3 h). So rechnet EMHASS mit unserem Wissen, aber mit seinem einfacheren Modell (Stufe 1).
// Innere Wärme c (Nachbarräume, Personen) kennt EMHASS nicht – sie wirkt wie eine um c/k höhere Außentemperatur. Weil
// die Außentemperatur für alle Räume gleich ist, verschieben wir stattdessen alle Temperaturen des Raums um −c/k
// (im linearen Ein-Speicher-Modell gleichwertig). Ohne das fand EMHASS keine Lösung (Waschraum: c/k = 9,5 °C).
// Sonnengewinn s·PV bleibt in Stufe 1 unberücksichtigt (EMHASS heizt dadurch eher etwas mehr).
import { BLOCK, DT_H, bewerte, type RaumParam } from './modell.ts';
import { netzGrenzTemp } from '../_shared/heizregeln.ts';
import { kurzErgebnis, r1, vergleichBasis, wall, type Daten } from './rechnen.ts';

export const SCHRITT_MIN = 30;                     // EMHASS-Zeitschritt (2 Slots à 15 min)
// Regel „Abend/Nacht nur Min“ als Preis: Bei festem Tarif ist EMHASS die Uhrzeit egal, es heizte im Test nachts aus dem
// Netz vor, um morgens Normal zu erreichen. Mit 50 % Aufschlag in Stunden, in denen die Regeln nur Min erlauben und keine
// PV da ist, verschiebt es das Heizen in die Sonnenstunden (Probe 22.11.2026). Bewertet wird mit dem echten Preis.
const NACHT_AUFSCHLAG = 0.5;

/** Zwei-Speicher-Modell (Estrich S, Luft T) auf EMHASS (ein Speicher) abbilden. */
export function emhassRaumwerte(p: RaumParam): { heating_rate: number; cooling_constant: number; thermal_inertia: number; verschiebung: number; reichweite: number } {
  const ru = p.r * p.u;
  const tr = -(p.u + ru + p.k), det = p.u * p.k;
  const disk = Math.sqrt(Math.max(0, tr * tr - 4 * det));
  const lamLangsam = (tr + disk) / 2, lamSchnell = (tr - disk) / 2;      // beide negativ
  const gamma = Math.max(1e-4, -lamLangsam);
  const alpha = gamma * p.r * p.g / Math.max(1e-6, p.k);
  const traeg = Math.min(3, Math.floor((1 / Math.max(1e-6, -lamSchnell)) / (SCHRITT_MIN / 60)) * (SCHRITT_MIN / 60));
  const verschiebung = Math.max(-10, Math.min(10, p.c / Math.max(1e-6, p.k)));   // °C, innere Wärme als Außentemperatur
  return { heating_rate: Math.round(alpha * 1e4) / 1e4, cooling_constant: Math.round(gamma * 1e5) / 1e5, thermal_inertia: traeg,
           verschiebung: Math.round(verschiebung * 100) / 100, reichweite: alpha / gamma };   // reichweite: ΔT bei Dauerheizen
}

const mittel = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
const abrunden = (t: number) => Math.floor(t * 100 + 1e-9) / 100;    // Grenzen nie aufrunden (sonst unlösbar)

/** Höchstes Min je Schritt, das EMHASS sicher einhalten kann – im verschobenen System, Schritt 0 = Start.
 *  Rechnet EMHASS' eigenes Modell (T[t+1] = T[t] + α·Δt·P[t−L]/Pnenn − γ·Δt·(T[t] − außen[t])) mit Dauerheizen ab
 *  Schritt 0: In den ersten L Schritten (Verzögerung) kommt noch keine Wärme an, danach volle Leistung. Mehr als
 *  dieser Verlauf geht nicht; 0,05 °C Abstand, damit Rundung und Ein/Aus-Schritte nicht an die Grenze stoßen.
 *  Liegt das Ziel-Min darunter, bleibt es unverändert. */
export function erreichbarMin(w: { heating_rate: number; cooling_constant: number; thermal_inertia: number },
                              start: number, aussen: number[], zielMin: number): number[] {
  const dt = SCHRITT_MIN / 60, S = aussen.length;
  const L = Math.max(0, Math.min(Math.floor(w.thermal_inertia / dt + 1e-9), S - 1));
  const out: number[] = [start];
  let T = start;
  for (let t = 0; t < S - 1; t++) {
    T = T + (t >= L ? w.heating_rate * dt : 0) - w.cooling_constant * dt * (T - aussen[t]);
    out.push(Math.min(zielMin, T - 0.05));
  }
  out[0] = Math.min(zielMin, start);                                  // Schritt 0 ist ohnehin auf den Start festgelegt
  return out;
}

/** Eingaben für EMHASS „naive-mpc-optim“ für die Gegenrechnung eines Tages. */
export function emhassEingabe(d: Daten, tag: string, nichtSteuerbar: Set<string>) {
  const { b, bat, socStart } = vergleichBasis(d, tag, nichtSteuerbar);
  if (b.raeume.length === 0) return { ok: false, grund: 'keine Temperaturen um Mitternacht' };
  const S = b.slots.length / BLOCK;                                   // 48 Schritte
  const block = (j: number) => [j * BLOCK, j * BLOCK + 1];
  // Räume, die keine Befehle annehmen (fest), plant EMHASS nicht – ihre echte Heizleistung zählt zur Grundlast.
  const frei = b.raeume.filter(r => r.fest.every(f => f == null));
  const festeW = (i: number) => b.raeume.filter(r => !frei.includes(r)).reduce((s, r) => s + (r.fest[i] ?? 0) * r.p, 0);
  const pv = Array.from({ length: S }, (_, j) => Math.round(mittel(block(j).map(i => b.slots[i].pv))));
  const last = Array.from({ length: S }, (_, j) => Math.round(mittel(block(j).map(i => b.slots[i].base + festeW(i)))));
  const aussen = Array.from({ length: S }, (_, j) => r1(mittel(block(j).map(i => b.slots[i].tout))));
  const preis = Number(d.settings?.electricity_price_kwh_cent ?? 29.94) / 100;
  const einsp = Number(d.settings?.feed_in_price_kwh_cent ?? 6.77) / 100;
  const nachtVon = (i: number) => b.slots[i].netz === 'min' && b.slots[i].pv <= b.slots[i].base;   // Abend/Nacht/Sonnentag ohne PV
  const kosten = Array.from({ length: S }, (_, j) => Math.round(preis * (block(j).every(nachtVon) ? 1 + NACHT_AUFSCHLAG : 1) * 1e5) / 1e5);
  const raumDef = frei.map(r => {
    const room = d.raeume.find((x: any) => x.id === r.id) ?? {};
    const min = r.unter[0];
    const normal = Number(room.eco ?? d.settings?.eco_temp ?? 21);
    const pvMax = Math.max(r.max[0], min);
    // Regel-Rahmen als Grenzen: Min hart; Normal als Wunsch nur dort, wo die Regeln Normal aus dem Netz erlauben
    // (Tag ohne genug Sonne), sonst Min. Über Normal bis PV-Max nur, wenn es sich rechnet (Einspeisepreis).
    const wunsch = Array.from({ length: S }, (_, j) => netzGrenzTemp(b.slots[block(j)[0]].netz ?? 'min', min, normal));
    // Obergrenze nie unter der Starttemperatur, sonst hätte EMHASS keine Lösung (der Estrich kühlt langsam aus).
    const oben = Math.max(pvMax, r.T0 + 0.2);
    const { verschiebung: v, reichweite: _reichweite, ...werte } = emhassRaumwerte(r.param);
    const sh = (t: number) => r1(t - v);                              // Temperatur im verschobenen System
    // 25.11.2026: Min je Schritt auf das begrenzen, was EMHASS mit SEINEM Modell überhaupt erreichen kann (siehe
    // erreichbarMin). Vorher galt ein fester Wert min(Min, Start, Dauerzustand) – lag der Raum um Mitternacht schon
    // unter Min (Toilette Eingang 20,9 < 21 °C), kühlte er in der Verzögerungszeit (bis 3 h) unter den Startwert ab,
    // bevor Heizen wirkt → EMHASS „Infeasible“ (16., 18.–20., 24.11.: genau die Tage mit Toilette Eingang < Min).
    const minSchritt = erreichbarMin(werte, sh(r.T0), aussen, r1(min - v)).map(t => t + v);
    const minEff = Math.min(...minSchritt);
    return {
      id: r.id, name: r.name, p: r.p, min_begrenzt: minEff < min - 0.005 ? r1(minEff) : null,
      thermal_config: {
        ...werte, start_temperature: sh(r.T0), sense: 'heat',
        min_temperatures: minSchritt.map(t => abrunden(t - v)),
        max_temperatures: Array(S).fill(sh(oben)),
        desired_temperatures: wunsch.map(sh), overshoot_temperature: sh(oben),
        // Strafe je °C unter dem Wunsch und Schritt, umgerechnet aus unserem Gewicht (kWh je °C·h) in Euro
        penalty_factor: Math.round(Number(d.settings?.planer_gewicht_ziel ?? 0.6) * r.gewicht * preis * (SCHRITT_MIN / 60) * 1000) / 1000,
      },
    };
  });
  const socAnfang = Math.max(0.05, Math.min(1, socStart / 100));
  return {
    ok: true, tag, start: wall(b.eps[0]), schritte: S, schritt_min: SCHRITT_MIN,
    raeume: raumDef.map(({ id, name, p, min_begrenzt }) => ({ id, name, p, min_begrenzt })),
    config: {
      number_of_deferrable_loads: raumDef.length,
      nominal_power_of_deferrable_loads: raumDef.map(r => r.p),
      battery_nominal_energy_capacity: Math.round(bat.capKwh * 1000),
      battery_charge_power_max: bat.maxLadenW, battery_discharge_power_max: bat.maxEntladenW,
      battery_charge_efficiency: bat.eta, battery_discharge_efficiency: bat.eta,
      battery_minimum_state_of_charge: Math.round(bat.minKwh / bat.capKwh * 100) / 100,
      maximum_power_from_grid: Math.round(Math.max(...b.slots.map(s => s.capW)) + Math.max(...last)),
      photovoltaic_production_sell_price: einsp,
    },
    runtime: {
      prediction_horizon: S, soc_init: socAnfang, soc_final: socAnfang,
      pv_power_forecast: pv, load_power_forecast: last, load_cost_forecast: kosten, prod_price_forecast: Array(S).fill(einsp),
      outdoor_temperature_forecast: aussen,
      def_load_config: raumDef.map(r => ({ thermal_config: r.thermal_config })),
    },
  };
}

/** EMHASS-Plan (Leistung je Raum und 30-min-Schritt in W, Reihenfolge wie emhass_eingabe.raeume) mit unserem Maßstab
 *  bewerten. Feste Räume heizen wie in Wirklichkeit, alle anderen nach EMHASS. */
export function emhassBewerten(d: Daten, tag: string, nichtSteuerbar: Set<string>,
                               plan: { raeume: { id: string }[]; leistung_w: number[][]; status?: string; rechenzeit_s?: number }) {
  const { b, bat, g, eIst } = vergleichBasis(d, tag, nichtSteuerbar);
  if (!eIst) return { ok: false, grund: 'keine Temperaturen um Mitternacht' };
  const N = b.slots.length;
  const heizen = b.raeume.map(r => {
    const k = plan.raeume.findIndex(x => x.id === r.id);
    if (k < 0) return r.fest.map(f => f ?? 0);                         // fest oder von EMHASS nicht geplant
    return Array.from({ length: N }, (_, i) => {
      const w = Number(plan.leistung_w[k]?.[Math.floor(i / BLOCK)] ?? 0);
      return w >= 0.5 * r.p ? 1 : 0;
    });
  });
  const e = bewerte(b.raeume, b.slots, bat, g, heizen);
  const heizStd = heizen.reduce((s: number, h) => s + (h as number[]).reduce((x: number, v) => x + Number(v), 0), 0) * DT_H;
  return {
    ok: true, tag,
    emhass: { ...kurzErgebnis(e), netz_bereinigt_kwh: r1(e.netzKwh - (e.waermeKwh - eIst.waermeKwh)),
              heiz_raumstunden: r1(heizStd), status: plan.status ?? null, rechenzeit_s: plan.rechenzeit_s ?? null,
              stufe: 1, bewertet_at: new Date().toISOString() },
  };
}
