

# Mobile und PWA Optimierung aller Tabs

## Uebersicht

Die App wird fuer die Nutzung auf Smartphones und als installierte PWA optimiert. Hauptaenderungen betreffen die Navigation (Bottom-Tab-Bar), responsive Grids und PWA-spezifische Anpassungen.

## 1. Bottom-Tab-Bar fuer Mobile (Header.tsx)

Aktuell: Navigation ist in der oberen Header-Leiste mit Buttons, die auf kleinen Bildschirmen umbrechen und schwer zu treffen sind.

Neu: Auf Mobilgeraeten wird eine fixierte Bottom-Tab-Bar angezeigt (typisches PWA/App-Pattern). Der Header wird vereinfacht und zeigt nur Logo + Dark-Mode/Logout.

- Bottom-Bar mit 4 Icons: Dashboard, Heizung, Analyse, Einstellungen
- Aktiver Tab wird farblich hervorgehoben
- `safe-area-inset-bottom` fuer iPhones mit Home-Indicator
- Desktop bleibt unveraendert (Buttons im Header)

## 2. Dashboard-Tab (Index.tsx)

- Widget-Grid von `grid-cols-3` auf `grid-cols-1 sm:grid-cols-3` aendern
- Padding reduzieren auf Mobile (`px-3 py-4` statt `px-4 py-6`)
- `pb-20` am Main-Container hinzufuegen damit Inhalte nicht hinter der Bottom-Bar verschwinden

## 3. Heizungs-Tab (HeatingDashboard.tsx)

- Status-Cards Grid: `grid-cols-2 lg:grid-cols-4` beibehalten (funktioniert bereits)
- Thermostat-Steuerung Header: flex-wrap fuer mobile
- Thermostat-Grid: bereits responsive mit `sm:grid-cols-2 lg:grid-cols-3`

## 4. Analyse-Tab (Index.tsx - innere Tabs)

- TabsList mit `grid-cols-3` bekommt kompaktere Labels auf Mobile
- Icon-only auf kleinen Screens, Text ab `sm:` Breakpoint
- Buttons `w-full` auf Mobile

## 5. PWA Safe-Area und CSS (index.css)

- `env(safe-area-inset-bottom)` fuer Bottom-Bar
- `env(safe-area-inset-top)` fuer Status-Bar bei Standalone-Mode
- Viewport-Meta anpassen: `viewport-fit=cover` in index.html
- Touch-Highlights entfernen fuer natuerlicheres App-Gefuehl

## Technische Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `src/components/energy/Header.tsx` | Bottom-Tab-Bar auf Mobile, vereinfachter Header |
| `src/pages/Index.tsx` | Responsive Grid-Fixes, Bottom-Padding |
| `src/index.css` | Safe-Area CSS, Touch-Optimierungen |
| `index.html` | `viewport-fit=cover` Meta-Tag |

## Ergebnis

- App fuehlt sich auf dem Handy wie eine native App an
- Navigation per Daumen erreichbar (Bottom-Bar)
- Keine abgeschnittenen Inhalte hinter System-UI
- Alle Tabs nutzen den verfuegbaren Platz optimal

