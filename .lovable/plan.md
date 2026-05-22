## Ziel
Die Karte „KI-Parameter-Vorschläge" verständlicher machen: klarer Bezug zum KI-Autopilot, plus eine kompakte Legende für die Filter (Alle / Offen / Bewertet) und die Modi (Schatten / Vorschlag / Auto).

## Änderungen in `src/components/heating/AIShadowDecisions.tsx`

1. **Titel anpassen**
   - `KI-Parameter-Vorschläge` → `KI-Autopilot · Parameter-Vorschläge`
   - So wird sichtbar, dass diese Karte das Herz des Autopiloten ist (Whitelist + Decision-Log + Apply).

2. **Kurzbeschreibung schärfen**
   - Ein Satz: „Der KI-Autopilot analysiert das System alle 15 Minuten, schlägt Parameter-Änderungen vor und wendet sie – je nach Modus – automatisch oder erst nach deiner Freigabe an."

3. **Kompakte Legende (collapsible `<details>` direkt unter der Beschreibung)**
   Zwei kleine Blöcke nebeneinander, mit denselben Badge-Styles wie in der Tabelle, damit Farbe = Bedeutung:

   **Filter (Tabs oben rechts)**
   - **Alle** – jeder gespeicherte Vorschlag der letzten Tage
   - **Offen** – Vorschlag wurde noch nicht bewertet (Outcome-Score fehlt)
   - **Bewertet** – Outcome wurde nach ~60 min gemessen, Score sichtbar (positiv = hat geholfen, negativ = hat geschadet → ggf. Auto-Rollback)

   **Modus pro Parameter (Spalte „Modus" / Dropdown)**
   - **Schatten** (grau) – KI loggt nur, ändert nichts. Lernphase.
   - **Vorschlag** (outline) – KI speichert Vorschlag, du klickst „Anwenden".
   - **Auto** (blau) – KI wendet selbst an, sobald `ai_auto_mode_enabled` aktiv ist; bei Score < −0.3 automatischer Rollback.

4. **Keine Logik-Änderungen** – nur Text, Titel und eine eingeklappte Legende. Tabelle, Datenfluss und Edge Functions bleiben unberührt.

## Verifikation
- Karte rendert mit neuem Titel.
- Legende ist standardmäßig eingeklappt, öffnet auf Klick.
- Bestehende Filter-Buttons und Modus-Badges verhalten sich unverändert.
