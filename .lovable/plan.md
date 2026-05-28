## Umsetzungsplan — Smartfox Insight AI Verbesserungen (final)

Validiert gegen Codebase + Memory. Entscheidungen des Users eingearbeitet:
- **Modell bleibt `gemini-2.5-flash-lite`** für `optimize_decision` (1000 RPD passt zur Heartbeat-Frequenz). Schritt 2a aus der Prompt wird **nicht** umgesetzt.
- **`AIAutopilotToggle` nicht zusätzlich** im Heizungs-Dashboard platzieren (Toggle existiert bereits prominent in `HeatingSettingsForm` mit Master-Switch `ai_auto_mode_enabled`). Schritt 3e aus der Prompt wird **nicht** umgesetzt.

---

### 1. Bug-Fix `supabase/functions/analyze-patterns/index.ts`

- **Zeile 198**: `const { isNight } = isNightTimeFromSettings(...)` → `const isNight = isNightTimeFromSettings(...)`. `isNightTimeFromSettings` liefert einen Boolean (siehe Zeile 351 — dort korrekt verwendet).

### 2. KI-Konfiguration `analyze-patterns/index.ts`

- **2b Temperature pro Typ**: `callAI` Signatur erweitern auf `callAI(requestBody, analysisType?)`. `typeTemperatureMap` einführen, statische Logik in Zeile 77 ersetzen durch `typeTemperatureMap[analysisType ?? ''] ?? 0.5`. Aufrufstelle Zeile 1201 mit `type` als zweitem Argument versorgen.
- **2c maxOutputTokens pro Typ**: `typeTokenMap` in `callAI` einführen, in `generationConfig` (Zeile ~74) setzen: `maxOutputTokens: typeTokenMap[analysisType ?? ''] ?? typeTokenMap.default`.
- **2d Automation-History trimmen**: Vor Prompt-Aufbau im `optimize_decision`-Zweig die `automationHistory` per `room_id` auf max. 3 Events gruppieren (`trimmedHistory`), im Prompt-Block ab ~Zeile 601 statt `automationHistory` verwenden.
- **2e Response-Cache** für `optimize_decision`:
  - Cache-Key aus Buckets: PV/200W, SOC/5%, Wien-Stunde.
  - Vor dem KI-Call `system_settings` per REST lesen; wenn Eintrag <15 min alt → cached Response zurückgeben (`cached: true` ergänzt).
  - Nach erfolgreichem KI-Call Ergebnis per `Prefer: resolution=merge-duplicates` upserten.

**Bewusst weggelassen**: Modell-Wechsel (2a) — bleibt bei `gemini-2.5-flash-lite`.

### 3. UI-Umstrukturierung

**3a `src/pages/Index.tsx` — Analysis-Tab bereinigen**
- Card „KI-Heizplan" (Verweis-Card) entfernen.
- Accordion „🧠 KI-Lernstatus & Mustergedächtnis" inkl. `PatternRecallBlock` + `LearningProgress` entfernen.
- Ungenutzte Imports aufräumen (`Brain`, `Accordion*`, `PatternRecallBlock`, `LearningProgress` — nur entfernen wenn sonst nicht mehr genutzt).

**3b `src/pages/Index.tsx` — Dashboard-Tab bereinigen**
- `<RoomStatusTable …>` aus Dashboard entfernen (inkl. Import + `saveRoom`/`updateRoomLocally` aus `useRooms`, falls sonst ungenutzt).
- 3 Bottom-Cards (Messungen, Intervall, Start) in `Accordion` mit Titel „Systeminfo" wrappen (vgl. Schritt 4c).

**3c `src/components/heating/HeatingDashboard.tsx` — Sektionen integrieren**
- Imports ergänzen: `RoomStatusTable`, `PatternRecallBlock`. (`LearningProgress`, `Brain`, `Collapsible*`, `Card*` sind vorhanden.)
- **Nach `<AIShadowDecisions />` (Zeile 276), vor `<DailyHeatingSchedule>` (Zeile 279):**
  1. `<RoomStatusTable rooms onSavePriority={…}>` mit identischer Handler-Logik wie aktuell in `Index.tsx` (optimistic update, Rollback bei Fehler).
  2. *(später, nach Thermostat-Steuerung — siehe 3d)* Collapsible „🧠 KI-Lernstatus & Mustergedächtnis" mit `PatternRecallBlock` + `LearningProgress`.

**3d Reihenfolge im `HeatingDashboard`** (final):
```
1. ApiErrorBanner
2. Live-Status (3 Cards: Battery | PV | AIStatus)
3. Heating & Cost (HeatingOverviewCard | PriceSuggestionBanner+EnergyCostWidget)
4. AIShadowDecisions
5. RoomStatusTable                          ← NEU
6. DailyHeatingSchedule
7. Thermostat-Steuerung
8. Collapsible: KI-Lernstatus & Mustergedächtnis  ← NEU
9. Collapsible: Detailansicht KI & Prognose
10. Collapsible: Verlaufscharts
```
*(Kein zusätzlicher `AIAutopilotToggle` — Master-Switch bleibt in `HeatingSettingsForm`.)*

### 4. Kleinere UI-Verbesserungen

**4a `src/components/heating/LearningProgress.tsx`** — Button „Analyse starten" aus `CollapsibleContent` in den `CardHeader` neben den Refresh-Button verschieben, damit er auch im zugeklappten Zustand sichtbar bleibt. `e.stopPropagation()` am Button-Click, damit der Header-Trigger nicht mitschaltet.

**4b Tab-Labels — `src/components/energy/Header.tsx` + `tabMeta` in `Index.tsx`**
- `dashboard` → „Übersicht"
- `analysis` → „Verlauf & Muster"
- `heating` → „Heizung & KI"
- `settings` → „Einstellungen"
- SEO `title`/`description` in `tabMeta` analog anpassen.

**4c Systeminfo-Accordion** — siehe 3b.

---

### Verifikation

- Build/Type-Check läuft automatisch nach Edits.
- Edge Function nach Deployment 2× mit `type: 'optimize_decision'` triggern → Logs: 1. Call ohne Cache, 2. Call `Cache hit (xmin alt)`.
- Tabs durchklicken: Heizung (RoomStatusTable + KI-Lernstatus-Accordion vorhanden), Verlauf & Muster (nur AnalysisPanel + Räume-Info), Dashboard (keine RoomStatusTable, Systeminfo-Accordion zugeklappt).

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `supabase/functions/analyze-patterns/index.ts` | Bug-Fix `isNight`, Temperature/Tokens pro Typ, History-Trim, Response-Cache |
| `src/pages/Index.tsx` | Analysis-Tab bereinigt, RoomStatusTable raus, Systeminfo-Accordion, Tab-SEO |
| `src/components/heating/HeatingDashboard.tsx` | RoomStatusTable + KI-Lernstatus integriert, Reihenfolge |
| `src/components/heating/LearningProgress.tsx` | „Analyse starten"-Button in Header |
| `src/components/energy/Header.tsx` | Tab-Labels |
