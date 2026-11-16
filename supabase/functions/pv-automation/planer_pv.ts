// PV-Prognose aus dem Heizplan – reine Funktionen (16.11.2026, Bereinigung Stufe 2b).
// doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md §4.1. Geprüft mit planer_pv_test.ts.

/** PV je 15-min-Abschnitt aus heizplan.plan (start = Epoch-Sekunden des ersten Abschnitts, pv in W). */
export type PlanerPv = { start: number; pv: number[]; grund: string };

/** Reine Funktion: PV-Leistung (W) des Plans im 15-min-Abschnitt, der epochSek enthält (0 außerhalb des Plans). */
export function planerPvW(p: PlanerPv, epochSek: number): number {
  const i = Math.floor((epochSek - p.start) / 900);
  return i >= 0 && i < p.pv.length ? p.pv[i] : 0;
}

/** Reine Funktion: PV-Energie (Wh) des Plans von jetzt bis bisSek. Der laufende Abschnitt zählt anteilig. */
export function planerPvWh(p: PlanerPv, vonSek: number, bisSek: number): number {
  let wh = 0;
  for (let t = vonSek; t < bisSek;) {
    const ende = Math.min(bisSek, p.start + (Math.floor((t - p.start) / 900) + 1) * 900);
    wh += planerPvW(p, t) * (ende - t) / 3600;
    t = ende;
  }
  return wh;
}
