# FIX: „Heizung jetzt“ erklärt den Mehrverbrauch selbst – Auto und Batterie (14.11.2026)

## Anlass

Die Karte „Heizung jetzt“ zeigte um 11:30 „4,5 kW mehr, als die heizenden Räume erklären. Läuft etwas anderes
(Espressomaschine, Herd, Warmwasser, Auto)?“. Uli: „Warum schaust du nicht beim Wallbox-Manager, ob das Auto geladen wird,
hast du die Batterie geprüft?“

Geprüft 14.11.2026 11:35 (Wallbox-Backend `/api/state`, Fronius):
- Tesla (P30X) seit 07:46 angesteckt, Sitzung „Auto-Ladung“ 25,6 kWh, um 11:35 „suspended“ (0 W). Das erklärt den
  Mehrverbrauch am Morgen (07:45: 11,1 kW Haus, davon ~2,6 kW Heizung).
- Batterie lädt mit 4–6 kW (SOC 48 → 56 %). Laden zählt nicht im Hausverbrauch.
- Um 11:30: Haus 4,7 kW, Heizung 0, Auto 0 → die 4,5 kW sind sehr wahrscheinlich Warmwasser (Smartfox gibt Überschuss
  nach der Batterie an den Heizstab; keine Schnittstelle, siehe `doc/SCHNITTSTELLEN-HAUS-VENEDIGER.md` §1a).

## Umsetzung (SCHNITTSTELLEN §5, erster Teil)

- **SQL 43:** `energy_readings.auto_w` (W, beide Wallboxen). Ausgeführt.
- **Fronius-Collector** (`local-collector/smartfox-collector/index.js`): liest bei jeder Messung `GET /api/state` des
  Wallbox-Backends (`config.json` → `wallbox.state_url`, Standard `http://localhost:8080/api/state`, `wallbox.enabled: false`
  schaltet ab) und schreibt die Summe `power` als `auto_w`. Fehler → `null`, die Messung wird trotzdem gespeichert.
  Die Keba wird nicht direkt gefragt (Modbus nicht doppeln).
- **App „Heizung jetzt“:** gemessen = Verbrauch − Grundlast − Auto. Der Hinweis sagt selbst, ob das Auto lädt, ob die
  Batterie lädt oder abgibt, und bei Rest mit Sonne „wahrscheinlich Warmwasser“, ohne Sonne „Warmwasser oder ein Gerät“.
  Ohne Wallbox-Daten steht „Auto unbekannt“.

## Einspielen

1. PR mergen (App über Vercel).
2. Österreich-PC: `git pull` in `C:\Heizung\repo`, `local-collector\smartfox-collector\index.js` nach
   `C:\Users\ulibe\smartfox-collector\` kopieren, Dienst **SmartfoxFronius** neu starten.
3. Prüfen: `select timestamp, auto_w from energy_readings order by timestamp desc limit 5;` – Werte statt `null`.

Offen: Warmwasser-Leistung direkt vom Smartfox (SCHNITTSTELLEN §1a), dann kann auch „Warmwasser“ gemessen statt vermutet werden.
