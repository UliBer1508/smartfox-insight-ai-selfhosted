## Ziel
Die gesamte Vorschlagsliste (mobile Cards + Desktop-Tabelle) in `AIShadowDecisions.tsx` als Ganzes ein- und ausklappbar machen.

## Änderungen (nur UI, `src/components/heating/AIShadowDecisions.tsx`)

1. Neuer State `listCollapsed: boolean` (Default: `false`).
2. Im Listen-Header (über Filter/„Alle aufklappen") einen Toggle-Button ergänzen:
   - Label: „Liste einklappen" / „Liste ausklappen"
   - Icon: `ChevronUp` / `ChevronDown`
   - Zeigt Anzahl der gefilterten Vorschläge als Badge daneben.
3. Wenn `listCollapsed === true`:
   - Mobile Cards-Block und Desktop-Tabelle werden nicht gerendert.
   - Bestehender „Alle aufklappen/zuklappen"-Button wird ausgeblendet (greift nur auf sichtbare Items).
   - Filter-Chips (Parameter) und Status-Filter bleiben sichtbar, damit man bei Bedarf vorfiltern kann.
4. Standardverhalten bleibt: Liste sichtbar wie bisher.

## Nicht betroffen
- Keine Logik-, Datenmodell- oder Backend-Änderungen.
- `expanded`-Set für einzelne Items bleibt unverändert.
- AIAutopilotToggle und AIDailyPlanCard oberhalb unverändert.

## Verifikation
- Klick auf „Liste einklappen" versteckt sowohl mobile Cards (390px) als auch Desktop-Tabelle.
- Erneuter Klick zeigt Liste mit vorherigem `expanded`-Zustand wieder an.
- Filter und Param-Chips funktionieren weiter und beeinflussen den Badge-Zähler.
