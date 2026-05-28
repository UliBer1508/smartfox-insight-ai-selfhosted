# Mobile-Ansicht Optimierung

Bei 390px Viewport sind mehrere Komponenten horizontal überlaufend oder schlecht umgebrochen. Hier die identifizierten Probleme + Fixes.

## Identifizierte Probleme

### 1. `ProgressCockpit.tsx` — "KI-Zusammenfassung"-Karte (Hauptproblem, vom User markiert)
- Button "Text neu erzeugen" überläuft die Karte rechts; Text wird abgeschnitten (`erzeug…`).
- Ursache: `flex justify-between` mit fixem Button-Label, kein Wrap, kein `shrink-0` auf den Icon-Teilen.

### 2. `ProgressCockpit.tsx` — Trend-Zeile
- "TREND (1 TAGE) | Ø 100 % · Best 100 % · Min 100 %" bricht awkward auf 3 Zeilen mit Spalten-Layout.
- Auch "Heizung aus PV / Netzbezug / Score"-Grid: Label und Wert kollabieren auf zwei Zeilen.

### 3. `ApiErrorBanner.tsx` — Thermostat-Verbindungsfehler-Banner
- "Erneut versuchen"-Button schneidet rechts ab; Titel + Code + Button in einer Flex-Row zu breit.

### 4. `RoomStatusTable` — Zimmernamen werden truncated
- "Wirtschaftsr…", "Toilette Ein…" abgeschnitten, da Spalte zu schmal ist.

### 5. Raum-Karten Header (`HeatingDashboard`/`RoomCard`)
- "Zimmer…" abgeschnitten, weil KI-Badge + Sync-Button in derselben Zeile zu viel Platz nehmen.

## Lösungskonzept

### Fix A — ProgressCockpit (`src/components/energy/stats/ProgressCockpit.tsx`)
1. KI-Zusammenfassung-Header: Button-Layout responsive machen.
   - Container `flex-col sm:flex-row sm:items-start`, Button bekommt eigene Zeile auf Mobile.
   - Button-Label mobil verkürzen: Icon + "Neu" (sm:inline „Text neu erzeugen").
   - `whitespace-nowrap` + `shrink-0` auf Button verhindert Restbruch.
2. Trend-Zeile: vom Spalten-Layout auf zwei Zeilen umstellen — Label oben, Werte als komma-separierte Inline-Zeile darunter. Auf `sm:` zurück zu Original-Grid.
3. Sub-KPI-Grid (Heizung aus PV / Netzbezug / Score): `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` mit Inline-Label-Value-Anzeige unter 640px.

### Fix B — ApiErrorBanner (`src/components/heating/ApiErrorBanner.tsx`)
- Header: `flex-col sm:flex-row` mit Button in eigener Zeile auf Mobile (volle Breite).
- Titel + Fehlercode auf Mobile umbrechen (`flex-wrap`, kein truncate).
- Error-Liste: aktuelle `truncate` Beibehalten, aber Tap-to-expand-Detail später möglich (außerhalb dieses Scopes).

### Fix C — RoomStatusTable
- Auf Mobile (`<sm`): kompaktere Darstellung — Spalten "Aktuell / Eco / Ziel / Prio / PV / KI" zu „Aktuell · Ziel · Status" verkleinern; oder horizontales Scrollen mit `overflow-x-auto` und min-width auf der Tabelle, statt Name-Truncate. Variante mit `overflow-x-auto` ist minimal-invasiv und reicht.
- Zusätzlich `max-w-[10ch]` Truncate entfernen; stattdessen `min-w-0` + Tabelle in horizontalem Scroll-Container.

### Fix D — Raum-Karten Header
- In der Raum-Card Header-Zeile: Zimmer-Name `flex-1 min-w-0 truncate` lassen, aber KI-Badge auf Mobile in zweite Zeile verschieben (`flex-wrap` auf dem Header-Container).

### Fix E — Defensive Sweep
- Globale Prüfung: jedes `flex items-center justify-between` mit Button/Badge in einem Card-Header bekommt `flex-wrap gap-2` als Default — dadurch vermeiden wir weitere Mobile-Überläufe in Zukunft.
- Betroffene Komponenten zusätzlich kurz verifizieren: `BatterySocSuggestionCard`, `BatteryReserveStatus`, `AIShadowDecisions` (Card-Header), `LearningProgress` (Header mit „Analyse starten"-Button).

## Verifikation
- Nach jedem Fix: Mobile-Screenshot bei 390×844, Crop der betroffenen Karte mit `zoom_image` zur Bestätigung.
- Desktop (≥1024) muss unverändert bleiben — alle Anpassungen via `sm:`/`md:` Breakpoint nur unter 640px aktiv.

## Geänderte Dateien
- `src/components/energy/stats/ProgressCockpit.tsx`
- `src/components/heating/ApiErrorBanner.tsx`
- `src/components/heating/RoomStatusTable.tsx`
- `src/components/heating/HeatingDashboard.tsx` oder die Raum-Card-Komponente (Header-Wrap)
- evtl. `src/components/dashboard/BatterySocSuggestionCard.tsx`, `src/components/heating/AIShadowDecisions.tsx`, `src/components/heating/LearningProgress.tsx` (defensive Wraps)

## Was nicht geändert wird
- Desktop-Layout, Tab-Struktur, Datenfluss, Edge-Functions
- Bottom-Tab-Bar (funktioniert korrekt sticky-bottom)
