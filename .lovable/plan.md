# UI/UX-Verbesserungen (Mobile + Verständlichkeit)

Alle Änderungen reine UI-/Präsentationsänderungen — keine Backend-, Hook- oder Datenmodell-Änderungen. Bestehende Funktionalität bleibt vollständig erhalten.

## 1. Analyse-Tab — Backfill als „Datenpflege"
**Datei:** `src/components/energy/AnalysisPanel.tsx`
- Backfill-Box in `<Collapsible>` einklappen mit Titel **„🔧 Datenpflege (Entwickler)"** (Default: collapsed).
- Erklärtext (`text-xs text-muted-foreground`): *„Tagesscores werden normalerweise automatisch berechnet. Starte einen Backfill nur, wenn historische Daten fehlen oder neu importiert wurden."*
- Button „Backfill starten" → **„Scores jetzt neu berechnen"**.
- Dropdown-Label bekommt Tooltip (`TooltipProvider`/`Tooltip`): *„Für wie viele Tage in der Vergangenheit sollen die KI-Bewertungsscores neu berechnet werden?"*

## 2. Analyse-Tab — Doppelte Tab-Struktur auflösen
**Datei:** `src/pages/Index.tsx` (Block `activeTab === 'analysis'`)
- Innere Card „Heizungs-Optimierung" mit 3 Tabs (Global/Räume/ML-Status) entfernen und ersetzen durch:
  a. **Card „📅 KI-Heizplan"** — Button „Heizplan generieren" + bestehende Periods/Summary-Anzeige (Inhalt aus `value="global"`).
  b. **Info-Card** mit `KI-Autopilot aktiv` (Inhalt aus `value="rooms"`), `rooms.length === 0`-Fallback bleibt.
  c. **`<Accordion type="single" collapsible>`** am Ende mit Item „🧠 KI-Lernstatus & Mustergedächtnis" → enthält `<PatternRecallBlock />` + `<LearningProgress />`, plus Erklärtext zur ML-Follow-Rate und PatternRecall.
- Imports `Tabs/TabsContent/TabsList/TabsTrigger` aus diesem Block entfernen (bleiben woanders ggf. ungenutzt → cleanup).

## 3. Analyse-Tab — Automatik-Boxen mit Erklärtext
**Datei:** `src/components/energy/AnalysisPanel.tsx`
- `AutomationBox` um optionalen `description`-Prop erweitern; Text über Toggle in jeweils einem `<p className="text-xs text-muted-foreground">` rendern.
- Pro Tab passenden Erklärtext (Tag/Woche/Monat — Texte aus Prompt).
- Button-Labels umbenennen: „Tagesanalyse jetzt starten", „Wochenvergleich jetzt starten", „Monatsanalyse jetzt starten".

## 4. Heizung-Tab — Karten-Reihenfolge & Mobile-Struktur
**Datei:** `src/components/heating/HeatingDashboard.tsx`
- Erstes Grid auf 3 Karten reduzieren (`grid md:grid-cols-3 gap-4`): **BatteryStatus, PV-Leistung-Card, AIStatusWidget**.
- `PvForecastCard`, `BatteryReserveStatus`, `MLFollowRateWidget` in neue `<Collapsible>`-Sektion **„📊 Detailansicht KI & Prognose"** mit Erklärtext (3-spaltiges Grid innen, mobile 1-spaltig).
- `AIShadowDecisions`: zusätzliche `CardDescription` mit Schatten-Modus-Erklärung — Anpassung erfolgt in `src/components/heating/AIShadowDecisions.tsx` direkt im vorhandenen `CardHeader` (kein State, kein Logik-Eingriff).
- Neue Section-Reihenfolge:
  1. `ApiErrorBanner`
  2. Top-3 (Battery + PV + AIStatus)
  3. `HeatingOverviewCard` + `EnergyCostWidget` (md:grid-cols-2)
  4. `AIShadowDecisions`
  5. `DailyHeatingSchedule`
  6. Thermostat-Steuerung (`ThermostatCard`-Grid)
  7. Collapsible „📊 Detailansicht KI & Prognose"
  8. Collapsible **„📈 Verlaufscharts"** mit `HeatingHistoryChart` + `SolarGainChart`

## 5. Dashboard-Tab — RoomStatusTable Mobile-Cards
**Datei:** `src/components/heating/RoomStatusTable.tsx`
- `useIsMobile()` hinzufügen (oder Tailwind `sm:hidden`/`hidden sm:block`-Toggle).
- < 640px: vertikale Card-Liste pro Raum mit Raumname, Prio-Badge, aktueller Temp, Zieltemp, Heizstatus-Punkt (grün=aktiv/grau=inaktiv). Bestehende Priority-Edit-Funktion bleibt erhalten (z. B. via Select im Card-Footer).
- ≥ 640px: bestehende Tabelle.

## 6. Einstellungen-Tab — ML-Erklärung in „Anlagen-Konfiguration"
**Datei:** `src/components/energy/SettingsPanel.tsx`
- Direkt unter dem Accordion-Item-Titel ein `<p className="text-xs text-muted-foreground">` mit Text: *„Diese Werte werden von der KI verwendet um PV-Überschuss zu berechnen und Heizentscheidungen zu optimieren. Gib deine tatsächlichen Anlagenwerte ein — je genauer, desto besser lernt die KI."*

## 7. ThermostatCard — Touch-Targets ≥ 44px
**Datei:** `src/components/heating/ThermostatCard.tsx`
- Temperatur +/- Buttons, Refresh-Button: `h-11 w-11` (Icon-Buttons) bzw. Mindest-`h-11` für reguläre Buttons.
- Switches: Wrapper-Klickfläche mit Padding so erweitern, dass mindestens 44×44 px erreicht werden (bestehende Switch-Komponente unverändert).

## 8. Neue Komponente `AIBadge`
**Datei:** `src/components/ui/AIBadge.tsx` (neu)
- Props: `active: boolean`, optional `label?: string` (Default „KI"), optional `className?`.
- Aktiv: grünes Badge (`bg-primary/10 text-primary border-primary/30`) + `animate-pulse` Punkt.
- Inaktiv: graues Badge (`bg-muted text-muted-foreground`).
- Einsatz in `AIStatusWidget` (Titelzeile), `ThermostatCard` (wenn `room.automation_enabled`), `HeatingOverviewCard` (wenn `settings.ai_auto_mode_enabled`).

## Verifikation
- `bun run build` läuft (automatisch).
- Mobile-Viewport (390 px) im Preview: keine doppelten Tab-Leisten, RoomStatusTable als Cards, alle Buttons ≥ 44 px.
- Desktop (≥ 1024 px): Top-3-Grid, alle Sections in neuer Reihenfolge, Collapsibles aufklappbar.
- Bestehende Handler (`handleAnalyze`, `handleSyncThermostats`, `saveRoom` etc.) bleiben unverändert verdrahtet.

## Technische Details
- Verwendete UI-Primitives: `@/components/ui/collapsible`, `@/components/ui/accordion`, `@/components/ui/tooltip`, `@/components/ui/badge`, `@/hooks/use-mobile`.
- Keine Änderungen an Supabase, Edge Functions, Hooks, Typen.
- Keine neuen npm-Dependencies.
