## Was die Karte zeigt

Die Karte "Heizverbrauch" (`HeatingOverviewCard`) summiert pro Zeitraum (Tag / Monat / Jahr) die abgeschlossenen Heiz-Zyklen aller Räume:

- **Zyklen** — wie oft ein Raum geheizt hat
- **Dauer** — überlappungsfreie Gesamtheizzeit (Minuten/Stunden)
- **Energie** — geschätzte Energie in Wh/kWh (aus `room_heating_logs.energy_estimate_wh`)
- **Top‑Verbraucher** — die drei Räume mit höchster Energie im Zeitraum
- "Heizen jetzt: …" — Räume, die laut `rooms.is_heating` aktuell laufen

Datenquelle: `useHeatingConsumption(rooms)` → Tabelle `room_heating_logs` ab Jahresanfang (lokal Europe/Vienna).

## Warum „Tag = 0" und „Monat/Jahr ändern sich nicht"

Zwei Bugs:

**Bug 1 — falscher Event‑Filter (Hauptursache für „Tag = 0")**

In `src/hooks/useHeatingConsumption.ts` werden Zyklen, Dauer und Energie ausschließlich aus `event_type = 'heating_stop'` aggregiert. In der DB existieren aktuell aber zwei Stop‑Typen:

- `heating_stop` (klassisches Erreichen der Solltemperatur) — in den letzten 30 Tagen nur **21** Einträge, in den letzten 7 Tagen **null**.
- `solar_limit_stop` (PV‑Heizung wird durch `solar_limit_temp` beendet) — in den letzten 30 Tagen **749** Einträge mit gefüllten `duration_minutes` und `energy_estimate_wh`.

Heute (27.05.) gibt es noch keine Events, gestern (26.05.) hatte 7 × `solar_limit_stop` — die werden vom Hook ignoriert und deshalb steht „Tag = 0". Die DB‑Funktion `get_heating_history` zählt korrekt beide Typen (`event_type IN ('heating_stop','solar_limit_stop')`); der Frontend‑Hook muss synchron gezogen werden.

**Bug 2 — kein Refresh**

`useHeatingConsumption` lädt nur einmal beim Mount (`useEffect(loadConsumption, [loadConsumption])`). Es gibt:
- kein Intervall‑Polling,
- keinen `visibilitychange`/`focus`‑Trigger,
- keinen Aufruf nach Zyklus‑Updates.

Wenn das Dashboard länger offen ist, ändern sich Monat/Jahr also nie (und Tag erst nach Tab‑Reload). Die meisten anderen Energie‑Widgets pollen alle 30–60 s.

## Fix

Datei: `src/hooks/useHeatingConsumption.ts`

1. In beiden Stellen, die heute nur `heating_stop` prüfen, zusätzlich `solar_limit_stop` akzeptieren:

   ```ts
   const isStopEvent = log.event_type === 'heating_stop'
                    || log.event_type === 'solar_limit_stop';
   if (isStopEvent) stats.cycles += 1;
   if (isStopEvent && log.duration_minutes && log.timestamp) { … }
   ```

   Damit verhält sich der Hook konsistent zur DB‑Funktion `get_heating_history` und zur Logik in `SolarGainChart`.

2. Den „currently heating"-Block (`event_type = 'heating_start'`) unverändert lassen — der zählt nur laufende Zyklen für die Live‑Schätzung.

3. Refresh hinzufügen — analog zum Pattern in `HeatingDashboard`:

   ```ts
   useEffect(() => {
     loadConsumption();
     const id = setInterval(() => {
       if (document.visibilityState === 'visible') loadConsumption();
     }, 60_000);
     const onVisible = () => {
       if (document.visibilityState === 'visible') loadConsumption();
     };
     document.addEventListener('visibilitychange', onVisible);
     window.addEventListener('focus', onVisible);
     return () => {
       clearInterval(id);
       document.removeEventListener('visibilitychange', onVisible);
       window.removeEventListener('focus', onVisible);
     };
   }, [loadConsumption]);
   ```

## Nicht‑Ziel

- Keine DB‑Migrationen, keine Edge‑Function‑Änderungen, kein Eingriff in `room_heating_logs`‑Schema oder die Erzeugung der Events.
- Keine UI‑Änderungen an der Karte selbst — nur die zugrundeliegenden Zahlen werden korrekt und aktuell.

## Erwartetes Ergebnis

- „Tag" zeigt heute die `solar_limit_stop`-Zyklen sobald welche entstehen (gestern wären es 7 Zyklen / ~149 Wh gewesen).
- „Monat" und „Jahr" steigen über den Tag hinweg sichtbar (jede Minute Polling, sofort bei Tab‑Fokus).
- Top‑Verbraucher bleiben konsistent mit dem Solar‑Gain‑Chart.
