# Tab „Auto-Steuerung“ mit Verlauf und Wirkung (12.11.2026)

**Uli, 12.11.2026:**
- „Ich möchte eine Darstellung, wie die Vorgaben im Zeitablauf verbessert werden.“
- „Der Planer hat eine gute Darstellung – warum wird die Art und Weise des Planers nicht verwendet?“
- „Wir benötigen Tag, Woche, Monat, Jahr, Vergleich Vorwoche, Vormonat, Vorjahr.“
- „Auch wenn wir die Daten jetzt nicht haben, wir werden sie in Zukunft haben.“
- „Ich möchte die Kosten sehen für den Netzbezug.“
- „Die Auto-Steuerung soll das erste Fenster vor Übersicht sein. Wo sind die Steuerungselemente, wie kann ich
  eingreifen, wenn die KI nicht richtig optimiert, und warum heißt der Tab nicht Auto-Steuerung?“

## Tab „Auto-Steuerung“ (erster Tab, Startseite)

1. **Steuerung**
   - Modus: Aus / Schatten / Steuern. „Steuern“ ist noch gesperrt und wird nach der Freigabe des Mockups gebaut.
   - Eingriffe (bestehende Einstellungen, hier an einem Platz):
     - Sparsamer ↔ wärmer (`planer_gewicht_ziel`)
     - Höchstleistung ohne Sonne (`max_grid_heating_power_w`)
     - Sicherheit unter Untergrenze (`planer_sicherheit_abstand`)
   - Hinweise zu einzelnen Räumen: manuell übersteuert, Automatik aus, Thermostat nicht steuerbar.
   - KI-Vorschläge (Verweis auf KI › Zu entscheiden).
2. **Plan:** Die bisherige Ansicht „KI › Planer“, unverändert und hierher umgezogen.
3. **Verlauf und Wirkung** (`VerlaufView` / `VerlaufAnsicht`), dieselben Bausteine wie der Planer (`planerTeile.tsx`).
   - **Zeitraum:** Tag, Woche (Mo–So), Monat oder Jahr, mit ◀ ▶ zum Blättern.
   - **Vergleich:** Vorperiode, Vorjahr oder aus. Er ist nach Position im Zeitraum ausgerichtet und erscheint grau gestrichelt.
   - **Kacheln:**
     - PV mit Eigennutzung, Verbrauch nach Heizung, Warmwasser+Auto und Haus
     - Netz mit Autarkie, **Kosten Netz** mit Einspeiseerlös
     - Batterie geladen/entladen, Netz bei leerer Batterie
     - Haus unter Eco, Planer bei gleicher Sonne
   - **Prozentwerte** sind Unterschiede **je Tag**, damit unvollständige Zeiträume vergleichbar sind.
   - **Grafiken:**
     - Leistung je Stunde (Tag/Woche) bzw. Energie je Tag/Monat
     - Batterie
     - Netzkosten mit Planer
     - Raum-Stunden unter Eco
   - Violette Marken ▼n zeigen die Genehmigungszeitpunkte der KI-Vorschläge.
   - **Wirkung je Vorschlag:** 3 Tage vorher gegen 3 Tage nachher, für Netz, Kosten, Haus und Netz bei leerer Batterie. Zwei Vorschläge vom selben Tag sind „nicht trennbar“.

## Daten (SQL 35, ausgeführt 12.11.2026)

- `energie_stunde` / `energie_tag` werden **nie gelöscht**. Gefüllt per Cron `energie-verlauf` stündlich um :07 (ohne HTTP), nachgetragen ab 13.10.2026, dem ältesten vorhandenen Messwert.
- **Warum nötig:**
  - `energy_readings` bleibt nur 30 Tage, Raumtemperaturen nur 14 Tage.
  - `hourly_aggregates` wird seit 13.10. nicht mehr geschrieben.
  - `daily_pattern_scores` liegt um etwa Faktor 10 daneben (01.11.: 1,0 statt 10,5 kWh PV). Das ist auch die Ursache der „3,4 % Eigenverbrauch“ im Mustergedächtnis.
- **Heizung** = „heizt“ × gemessene Raumleistung, zeitgewichtet. Erst ab 29.10. vorhanden, weil die Raumdaten vorher gelöscht wurden.
- **Warmwasser + Auto** = Verbrauch − Heizung − Grundlast (gemessen 240 W), bis Wallbox- und Warmwasser-Werte gemessen werden.
- **Kosten** werden mit dem Preis gerechnet, der an dem Tag galt (`energy_price_history`, sonst Einstellungen). Grundgebühr je Tag = Jahresgebühr / 365.
- **Vorjahr** gibt es ab November 2027. Für 2025 wäre nur ein Solar.web-Export möglich.

## Ersetzt (Arbeitsregel „neu ersetzt alt im selben PR“)

| alt | neu |
|---|---|
| KI › Planer (Abschnitt 2) | Auto-Steuerung › Plan (gleiche Komponente) |
| Analyse › Woche/Monat/Jahr: `ProgressCockpit`, `YearTrendChart` auf `daily_pattern_scores`, `EnergyCostWidget` auf `energy_daily_costs` | Auto-Steuerung › Verlauf auf `energie_tag`; Analyse zeigt dort einen Verweis. Die Tagesansicht der Analyse bleibt. |
| `hourly_aggregates`, `daily_patterns`, `daily_pattern_scores`, `energy_daily_costs` (Tabellen) | `energie_stunde`, `energie_tag`. Die alten Tabellen und ihre Funktionen (`aggregate-energy-data`, `compute-daily-score`, `analysis-summary`) werden mit Bereinigung Stufe 2 abgeschaltet, weil das Mustergedächtnis sie noch liest. |
