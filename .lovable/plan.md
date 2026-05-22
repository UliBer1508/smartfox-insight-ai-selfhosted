## Ziel
Auf dem Handy ist die Tabelle der KI-Vorschläge zu breit und scrollt horizontal. Außerdem sind die Parameter-Chips oben und die Zeilen nicht klickbar — der User möchte Parameter-Infos per Tap öffnen.

## Änderungen in `src/components/heating/AIShadowDecisions.tsx`

### 1. Responsive Darstellung
- Tabelle nur auf `md+` zeigen (`hidden md:block`).
- Auf Mobile (`md:hidden`) eine **Karten-Liste** rendern. Jede Karte zeigt kompakt:
  - Zeile 1: Parameter (mono) + Status-Badge rechts
  - Zeile 2: `Aktuell → Vorschlag` (fett) + Konfidenz
  - Zeile 3: Raum · Zeit · Outcome-Badge
  - Die ganze Karte ist klickbar (`role="button"`, `onClick` toggelt Expand-Panel mit Begründung, Erwartung, Autonomie-Select, „Übernehmen"-Button).

### 2. Klickbare Parameter-Chips (oben, `byParam`)
- Aus den Info-Chips `Button variant="outline" size="sm"` machen.
- Klick setzt einen neuen State `paramFilter` → filtert `filtered` zusätzlich nach `parameter_key`.
- Aktiver Chip wird hervorgehoben; ein „×"-Chip „Filter aufheben" erscheint daneben, wenn gesetzt.

### 3. Klickbare Zeile auf Desktop
- Auch in der bestehenden Tabelle: gesamte `TableRow` per `onClick` togglet Expand (Chevron-Button bleibt als visueller Hint, stoppt aber `propagation`).
- „Übernehmen"-Button stoppt `propagation`, damit Klick nicht expandiert.

### 4. Mini-Verbesserungen Header
- Filter-Buttons (Alle/Offen/Bewertet) auf Mobile in eigene Zeile umbrechen lassen — bereits `flex-wrap`, ggf. `w-full sm:w-auto` am Container.
- Legende `<details>` bleibt wie gehabt (passt schon).

## Keine Logik-/Backend-Änderungen
Nur UI: Filter-State um `paramFilter` erweitert, Card-Layout für Mobile, klickbare Zeilen. Datenmodell, Edge Functions und Apply-Logik unverändert.

## Verifikation
- 390 px Viewport: keine horizontale Scroll-Leiste mehr in der Karte; Karten-Liste sichtbar.
- Tap auf Parameter-Chip filtert die Liste.
- Tap auf Karte/Zeile öffnet Detail-Panel; „Übernehmen" funktioniert ohne Toggle-Konflikt.
- Desktop (`md+`): Tabelle unverändert, zusätzlich row-click expand.
