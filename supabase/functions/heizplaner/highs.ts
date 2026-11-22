// Heizplaner – Suche mit HiGHS (22.11.2026) – doc/FIX-PLANER-HIGHS-2026-11-22.md
//
// Uli: „Warum verbessern wir unseren Algorithmus nicht um dieses HiGHS-Modell?“
// Die gierige Suche (plane, modell.ts) schaltet Raum für Raum je halbe Stunde zu und nimmt nichts zurück. An Sonnentagen
// verschenkt sie dadurch Netzstrom (16.11.2026: 7 kWh mehr als die Regeln; EMHASS mit vollständiger Optimierung gleichauf).
// Hier dieselbe Aufgabe als gemischt-ganzzahliges lineares Problem (MILP) für den Open-Source-Löser HiGHS (MIT):
//   – gleiches Raummodell (Estrich S + Luft T, 15-min-Schritte, exakt wie schritt())
//   – gleiche Kosten wie plane(): Netz − Einspeisewert, Komfort-Strafen (Normal, Min, über PV-Max), Restladung, Restwärme
//   – gleiche Regeln als feste Bedingungen (16.11.2026, _shared/heizregeln.ts):
//       · Heizen ohne mindestens halbe PV-Deckung („Netz-Heizen“) nur, solange der Raum ≤ Netzgrenze + Spielraum bleibt
//       · am Sonnentag lädt die Sonne zuerst die Batterie bis heating_min_battery_soc
//       · Leistungsgrenze je Viertelstunde (capW)
//   – Entscheidung je halbe Stunde (BLOCK), feste Räume (manuell, nicht steuerbar) wie vorgegeben
// Bewertet wird das Ergebnis danach mit bewerte() – dieselbe Batterie-Logik (Fronius) wie für alle anderen Pläne.
//
// Wo gerechnet wird: NICHT in Supabase. Probe 22.11.2026: mit den Regeln braucht HiGHS 40–110 s (nativ, 1 Kern), als
// WebAssembly noch länger – Supabase erlaubt ~2 s Rechenzeit. Deshalb baut der Heizplaner nur das Problem (baueLp,
// Aktion highs_eingabe), gelöst wird auf dem Österreich-PC (emhass_bruecke.py, highspy), bewertet wieder hier
// (Aktion highs_bewerten → heizplan_vergleich.planer_highs). Zweck: Prüfstein – wie weit ist die gierige Suche vom Optimum?
//
// Batterie im Löser: frei planbar (Laden/Entladen ≤ Leistung, Wirkungsgrad). Laden aus dem Netz und Einspeisen aus der
// Batterie lohnen sich rechnerisch nicht (Restwert 0,9 < 1, Einspeisefaktor < 1) und kommen deshalb nicht vor.
import { BLOCK, DT_H, waermeKwh, type Batterie, type Gewichte, type PlanRaum, type PlanSlot } from './modell.ts';
import { netzGrenzTemp } from '../_shared/heizregeln.ts';

const M_T = 30;                            // °C, groß genug für jede Temperaturgrenze
const M_W = 30000;                         // W, groß genug für jede Leistungsbilanz


const z = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
const term = (k: number, v: string) => { const c = z(k); return c === 0 ? '' : `${c >= 0 ? '+' : '-'} ${Math.abs(c).toPrecision(10)} ${v}`; };

/** Das Planungsproblem als LP-Text (CPLEX-LP-Format) – für HiGHS in der Cloud oder auf dem Österreich-PC (highspy). */
export function baueLp(raeume: PlanRaum[], slots: PlanSlot[], bat: Batterie, g: Gewichte): string {
  const N = slots.length, R = raeume.length, B = Math.ceil(N / BLOCK);
  const spiel = g.spielraum ?? 0.3;
  const obj: string[] = [], con: string[] = [], bnd: string[] = [], bin: string[] = [];
  let ci = 0;
  const c = (s: string) => con.push(`c${ci++}: ${s}`);
  const hVar = (r: number, b: number) => `hn${r}_${b} + hp${r}_${b}`;       // Heizen = Netz-Heizen + PV-Heizen
  const frei = (r: number, b: number) => raeume[r].fest.slice(b * BLOCK, (b + 1) * BLOCK).every(f => f == null);

  // ---- Heizvariablen je Raum und Block
  for (let r = 0; r < R; r++) for (let b = 0; b < B; b++) {
    if (frei(r, b)) {
      bin.push(`hn${r}_${b}`, `hp${r}_${b}`);
      c(`hn${r}_${b} + hp${r}_${b} <= 1`);
      if (!g.regeln) c(`hp${r}_${b} = 0`);                                  // ohne Regel-Rahmen: nur eine Art Heizen
    } else {
      const v = raeume[r].fest[b * BLOCK] ?? 0;                              // fest: wie vorgegeben (Blockanfang)
      bnd.push(`hn${r}_${b} = ${v}`, `hp${r}_${b} = 0`);
    }
  }

  // ---- Raummodell (exakt wie schritt()) und Komfort
  for (let r = 0; r < R; r++) {
    const rr = raeume[r], p = rr.param;
    bnd.push(`S${r}_0 = ${rr.S0}`, `T${r}_0 = ${rr.T0}`);
    for (let i = 0; i < N; i++) {
      const b = Math.floor(i / BLOCK), sl = slots[i];
      // S' = S + DT(g h − u (S − T))
      c(`S${r}_${i + 1} ${term(-(1 - DT_H * p.u), `S${r}_${i}`)} ${term(-DT_H * p.u, `T${r}_${i}`)} ${term(-DT_H * p.g, `hn${r}_${b}`)} ${term(-DT_H * p.g, `hp${r}_${b}`)} = 0`);
      // T' = T + DT(r u (S − T) − k (T − tout) + s pvkw + c)
      const rhs = DT_H * (p.k * sl.tout + p.s * sl.pvkw + p.c);
      c(`T${r}_${i + 1} ${term(-(1 - DT_H * p.r * p.u - DT_H * p.k), `T${r}_${i}`)} ${term(-DT_H * p.r * p.u, `S${r}_${i}`)} = ${z(rhs)}`);
      bnd.push(`-50 <= S${r}_${i + 1} <= 100`, `-50 <= T${r}_${i + 1} <= 100`);
      // Strafen wie simRaum: pen = DT·gewicht·(ziel·(Z−T)+ + unter·(U−T)+ + sicher·(Si−T)+ + ueber·(T−Max)+)
      const w = DT_H * rr.gewicht;
      c(`dz${r}_${i} + T${r}_${i + 1} >= ${rr.ziel[i]}`); obj.push(term(w * g.ziel, `dz${r}_${i}`));
      if (rr.sicher[i] === rr.unter[i]) {
        c(`du${r}_${i} + T${r}_${i + 1} >= ${rr.unter[i]}`); obj.push(term(w * (g.unter + g.sicher), `du${r}_${i}`));
      } else {
        c(`du${r}_${i} + T${r}_${i + 1} >= ${rr.unter[i]}`); obj.push(term(w * g.unter, `du${r}_${i}`));
        c(`ds${r}_${i} + T${r}_${i + 1} >= ${rr.sicher[i]}`); obj.push(term(w * g.sicher, `ds${r}_${i}`));
      }
      c(`dm${r}_${i} - T${r}_${i + 1} >= ${-rr.max[i]}`); obj.push(term(w * g.ueber, `dm${r}_${i}`));
      // Regel: Netz-Heizen nur, solange der Raum ≤ Netzgrenze + Spielraum bleibt (Prüfung am Slot-Ende wie plane())
      if (g.regeln && frei(r, b)) {
        const grenz = netzGrenzTemp(sl.netz ?? 'normal', rr.unter[i], rr.ziel[i]) + spiel;
        c(`T${r}_${i + 1} ${term(M_T, `hn${r}_${b}`)} <= ${grenz + M_T}`);
      }
    }
    // Restwärme am Planende (asymmetrisch wie waermeWert): wr ≤ Rest·e, wr ≤ Mehr·e  (e = capS·(ΔS + ΔT/r))
    const capS = rr.p / Math.max(1e-6, p.g) / 1000;
    const eS = capS, eT = capS / p.r, e0 = capS * (rr.S0 + rr.T0 / p.r);
    // waermeWert: weniger Wärme als zu Beginn kostet waermeRest – außer der Raum endet am/über seinem Ziel (uz = 1),
    // dann zählt sie wie mehr Wärme nur waermeMehr. wr ≤ Mehr·e immer, wr ≤ Rest·e + M·uz, uz = 1 nur wenn T_N ≥ Ziel.
    const mehr = g.waermeMehr ?? g.waermeRest;
    c(`wr${r} ${term(-mehr * eS, `S${r}_${N}`)} ${term(-mehr * eT, `T${r}_${N}`)} <= ${z(-mehr * e0)}`);
    c(`wr${r} ${term(-g.waermeRest * eS, `S${r}_${N}`)} ${term(-g.waermeRest * eT, `T${r}_${N}`)} ${term(-1000, `uz${r}`)} <= ${z(-g.waermeRest * e0)}`);
    c(`T${r}_${N} ${term(-M_T, `uz${r}`)} >= ${rr.ziel[N - 1] - M_T}`);
    bin.push(`uz${r}`);
    bnd.push(`-1000 <= wr${r} <= 1000`);
    obj.push(term(-1, `wr${r}`));
    void waermeKwh;   // gleiche Formel wie waermeKwh(p, leistung, dT, dS) = capS·(dS + dT/r)
  }

  // ---- Energie: PV − Grundlast − Heizen = Laden − Entladen + Einspeisen − Netz
  for (let i = 0; i < N; i++) {
    const b = Math.floor(i / BLOCK), sl = slots[i];
    const heiz = raeume.map((rr, r) => `${term(rr.p, `hn${r}_${b}`)} ${term(rr.p, `hp${r}_${b}`)}`).join(' ');
    c(`${heiz} + ld${i} - en${i} + ex${i} - nz${i} = ${z(sl.pv - sl.base)}`);
    c(`${heiz} <= ${sl.capW + 1}`);                                          // Leistungsgrenze (wie plane)
    c(`E${i + 1} - E${i} ${term(-DT_H * bat.eta / 1000, `ld${i}`)} ${term(DT_H / bat.eta / 1000, `en${i}`)} = 0`);
    bnd.push(`0 <= ld${i} <= ${bat.maxLadenW}`, `0 <= en${i} <= ${bat.maxEntladenW}`, `0 <= ex${i}`, `0 <= nz${i}`,
             `${bat.minKwh} <= E${i + 1} <= ${bat.capKwh}`);
    obj.push(term(DT_H / 1000, `nz${i}`), term(-g.einspeiseFaktor * DT_H / 1000, `ex${i}`));
    // PV-Heizen: frei = PV − Grundlast − Heizen der anderen (− Batterie zuerst am Sonnentag) ≥ ½ · Leistung des Raums
    if (g.regeln) {
      const ueber = Math.max(0, sl.pv - sl.base);
      const prio = sl.sonnentag && bat.heizMinKwh != null ? Math.min(bat.maxLadenW, ueber) : 0;
      if (prio > 0) {
        bin.push(`q${i}`);                                                   // q = 1: Batterie schon ≥ heizMin
        c(`E${i} ${term(-bat.heizMinKwh!, `q${i}`)} >= 0`);
      }
      for (let r = 0; r < R; r++) {
        if (!frei(r, b)) continue;
        const andere = raeume.map((rr, j) => (j === r ? '' : `${term(rr.p, `hn${j}_${b}`)} ${term(rr.p, `hp${j}_${b}`)}`)).join(' ');
        // pv − base − Σandere − prio·(1−q) ≥ ½p − M(1 − hp)   ⇔   Σandere − prio·q + M·hp ≤ pv − base − prio − ½p + M
        const rhs = sl.pv - sl.base - prio - 0.5 * raeume[r].p + M_W;
        c(`${andere} ${prio > 0 ? term(-prio, `q${i}`) : ''} ${term(M_W, `hp${r}_${b}`)} <= ${z(rhs)}`);
      }
    }
  }
  bnd.push(`E0 = ${bat.eKwh}`);
  obj.push(term(-g.batterieRest, `E${N}`));

  return `Minimize\n obj: ${obj.filter(Boolean).join(' ')}\nSubject To\n ${con.join('\n ')}\nBounds\n ${bnd.join('\n ')}\nBinary\n ${bin.join(' ')}\nEnd\n`;
}

/** Lösung (Spaltenwerte) in einen Heizplan [Raum][Slot] umsetzen. */
export function heizenAusLoesung(raeume: PlanRaum[], N: number, wert: (name: string) => number): number[][] {
  return raeume.map((rr, r) => Array.from({ length: N }, (_, i) => {
    const f = rr.fest[i];
    if (f != null) return f;
    const b = Math.floor(i / BLOCK);
    return (wert(`hn${r}_${b}`) + wert(`hp${r}_${b}`)) >= 0.5 ? 1 : 0;
  }));
}
