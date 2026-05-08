## Ziel

Sichtbar machen, in welchem Steuerungsmodus (Cloud / Lokal) das System läuft – an den wenigen Stellen, an denen das fürs Verständnis tatsächlich relevant ist. Kein Rauschen, keine doppelten Hinweise.

## Vorgeschlagene Hinweis-Stellen

### 1. Globaler Modus-Badge im App-Header (immer sichtbar)
- Dezenter Badge oben rechts (neben User-Menü / Settings-Icon):
  - Cloud: ☁️ „Cloud"
  - Lokal: 🖧 „Lokal" (in Akzentfarbe)
- Klickbar → springt zu Settings → Tuya-Verbindung
- Tooltip: „Steuerungsmodus: Lokaler Service (LAN, Port 6668)" bzw. „Tuya Cloud API"
- Komponente: neue `ControlModeBadge.tsx`, eingebunden in `Header.tsx` (oder dem App-Layout-Wrapper)

### 2. Thermostat-Steuerung Card (`HeatingDashboard.tsx`)
- In der `CardDescription` der Karte „Thermostat-Steuerung" den Modus zeigen:
  - „Live-Temperaturen und manuelle Steuerung · **Lokaler Service**"
  - Bei Cloud-Mode entsprechend „· Cloud API"
- Mini-Icon vor dem Text (MonitorSmartphone / Cloud)

### 3. „Alle pushen" und „Sync" Buttons (`HeatingDashboard.tsx`)
- Tooltip ergänzen, was im aktuellen Modus passiert:
  - Lokal: „Sendet Befehle über lokalen Service (LAN)"
  - Cloud: „Sendet Befehle via Tuya Cloud API"
- Kein neuer visueller Inhalt, nur `title`-Attribut.

### 4. Toast bei Modus-Umschaltung (`useControlMode.ts`)
- Bestehender Erfolgs-Toast bekommt Beschreibung:
  - Lokal aktiviert: „Befehle laufen jetzt über LAN. Cloud-Quota irrelevant."
  - Cloud aktiviert: „Befehle laufen über Tuya Cloud API. Quota gilt wieder."

### 5. Settings-Panel Akkordeon-Header „Tuya API-Verbindung"
- Im Trigger des Accordion-Items rechts neben dem Titel ein Mini-Badge:
  - „Lokal aktiv" / „Cloud aktiv"
- So sieht man den Modus auch wenn der Akkordeon-Inhalt zu ist

### Bewusst NICHT

- Keine Hinweise pro Thermostat-Karte (zu redundant bei 12 Räumen)
- Kein Hinweis im DailyHeatingSchedule oder PV-Forecast (nicht relevant)
- Keine zusätzliche Info-Banner – der Mode-Badge im Header reicht als „immer sichtbar"

## Komponenten-Änderungen (Übersicht)

| Datei | Änderung |
|---|---|
| `src/components/layout/ControlModeBadge.tsx` | NEU – Badge mit Tooltip + Click-Navigation |
| `src/components/layout/Header.tsx` (oder Hauptlayout) | Badge einbinden |
| `src/components/heating/HeatingDashboard.tsx` | CardDescription + Button-Tooltips |
| `src/hooks/useControlMode.ts` | Toast-Description erweitern |
| `src/components/energy/SettingsPanel.tsx` | Mini-Badge im Accordion-Trigger |

Keine Backend-, DB- oder Edge-Function-Änderungen. Nur Frontend/UI.
