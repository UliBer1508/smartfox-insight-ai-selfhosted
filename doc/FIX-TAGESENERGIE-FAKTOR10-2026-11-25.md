# FIX: Tagesenergie in `daily_pattern_scores` um Faktor 10 zu klein (25.11.2026)

## Befund

- Aufgefallen über die ÖMAG-Gutschrift September 2026 für Haus 315: 99,49 € bei 10,168 ct/kWh, das sind **~980 kWh** Einspeisung. `daily_pattern_scores.feed_in_kwh` zeigt für September **98,5 kWh**.
- Vergleich mit `energie_tag` (stimmt) über 28 Tage (16.10.–24.11.2026): PV × 9,995, Netzbezug × 10,9, Einspeisung × 9,5. Im Oktober Tag für Tag genau 1/10.
- Der Fehler steckt nur in diesen drei Spalten. `energie_tag`, `energie_stunde` und der Verlauf in „Auto-Steuerung“ sind richtig. Den Hinweis „etwa Faktor 10 zu niedrig“ gab es schon im Kommentar in `AnalysisTab.tsx` (12.11.2026), die Ursache war aber nicht behoben.

## Ursache

`get_weekly_energy_summary` (liefert die Tageswerte für `compute-daily-score`) rechnete Energie mit **festen 120 Messungen pro Stunde** (30-s-Takt): `SUM(W) / 120000`.
`energy_readings` kommt aber seit dem **08.07.2026** alle **300 s** (12 pro Stunde). Damit war jede Energie um Faktor 10 zu klein.
Zeitpunkt der Umstellung aus den Daten: Verhältnis PV/Prognose bis 07.07. um 1, ab 09.07. um 0,12.

## Lösung

1. **SQL 60** (`supabase/SQL/60_tagesenergie_zeitgewichtet.sql`): `get_weekly_energy_summary` integriert jetzt **zeitgewichtet**: Leistung × Abstand zur nächsten Messung, Lücken auf 600 s begrenzt, letzte Messung 300 s. Das ist unabhängig vom Messtakt.
   Probe 15.–24.11.2026 gegen `energie_tag`: PV, Netzbezug und Einspeisung stimmen auf 0,01 kWh. Ausnahme 15.11. (Netzwerkstörung) mit 1,7 kWh Abweichung beim Netzbezug.
2. **Altdaten** in `daily_pattern_scores`:
   - ab 26.10.2026 (Rohdaten vorhanden): exakt neu aus der Funktion
   - 09.07.–25.10.2026 (Rohdaten gelöscht): × 10
   - 08.07.2026 (Umstellungstag, nicht rekonstruierbar): PV, Einspeisung, Netzbezug = NULL
   - bis 07.07.2026: waren richtig, unverändert
3. **`compute-daily-score`**: Abzug für Netzbezug im Score 0,5 → **0,05 Punkte/kWh** (max 20). Der Score bleibt dadurch auf derselben Skala wie bisher.

## Nebenwirkungen geprüft

| Wer liest | Wirkung |
|---|---|
| `compute-daily-score` (Score, Eigenverbrauchsquote) | Quote unverändert (alle drei Werte waren gleich skaliert). Score ab 26.10. neu gerechnet, Abweichung im Mittel 0,14, maximal 0,75 Punkte. Ältere Scores bleiben stehen (0,05 × 10-facher Netzbezug = alter Abzug). Rang in der Signatur bleibt. |
| `ai-parameter-advisor` (Mustergedächtnis: „wie viel PV kam an ähnlichen Tagen wirklich“) | **War falsch:** Verhältnis PV/Prognose ~0,12 → „realistisch“ nur ~12 % der Prognose. Jetzt ~100 %. Der Batterie-Vorschlag (Mindest-Ladestand) rechnet damit mehr PV für morgen ein. Er bleibt ein Vorschlag, den Uli bestätigt. |
| `ai-parameter-evaluator` | liest Quote (unverändert) und Score (praktisch unverändert) |
| `useYearlyStats` (Frontend) | Summen PV/Netzbezug jetzt richtig (×10) |
| `bucketWeather` / `bucketPv` | nutzen `peak_power` und die Prognose, unverändert |
| Zeit | Funktion hängt nicht mehr vom Messtakt ab; Lücken werden höchstens mit 600 s gezählt (kein Hochrechnen über Ausfälle) |

## Reihenfolge

1. PR mergen → GitHub-Aktion deployt `compute-daily-score`
2. Danach SQL 60 ausführen (sonst rechnet der nächste Lauf mit dem alten Abzug 0,5 auf richtigen Netzbezug, und der Score fällt für diese Tage zu tief aus)
3. Kontrolle am Ende von SQL 60: Verhältnisse zu `energie_tag` ≈ 1,0
