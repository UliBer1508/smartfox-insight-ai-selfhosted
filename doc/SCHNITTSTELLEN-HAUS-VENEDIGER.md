# Geräte und Schnittstellen – Haus Venediger (12.11.2026)

**Anlass (Uli, 12.11.2026):** „Warum sind diese Sachen nicht dokumentiert und im Repo?“ – Die Smartfox-IP stand nur in
der Systemdoku-Tabelle („Daten nicht mehr genutzt“), die Wallbox nur im eigenen Repo `Wallbox-Backend`. Diese Seite
führt alles an einer Stelle zusammen. **Vor jeder neuen Datenquelle hier nachsehen und diese Seite nachziehen.**

## 1. Geräte im Hausnetz (192.168.188.x)

| Gerät | IP | Schnittstelle | Wer regelt es | Heizung liest heute | geplant |
|---|---|---|---|---|---|
| Fronius Wechselrichter + Batterie 13,8 kWh | .64 | HTTP `/solar_api/v1/GetPowerFlowRealtimeData.fcgi` | Fronius/Smartfox | **ja** – PV, Verbrauch, Netz, Batterie, SOC (`energy_readings`) | – |
| Smartfox Pro (Energiemanager) | .45 | HTTP `/values.xml` (auch `/all`), ohne Anmeldung | Smartfox selbst: Überschuss → Batterie, dann Warmwasser und Auto | nein | Warmwasser-Leistung `htPowerMeasValue` (kW) |
| Warmwasser-Heizstab | – | über Smartfox (Analogausgang) | Smartfox, mit Überschuss; ohne Sonne bei Bedarf aus dem Netz | nein | über Smartfox |
| Keba P30C – Gäste-Wallbox | .36 | Modbus TCP 502, Unit 255 | **Wallbox-Backend** (Freigabe nach Bezahlung) | nein | Leistung über Wallbox-Backend |
| Keba P30X – Tesla | .63 | Modbus TCP 502 | Smartfox (PV-Überschuss) + eCarUp; ohne Sonne bei Bedarf Netz | nein | Leistung über Wallbox-Backend |
| 12 × Thermostat TGP508 | siehe `rooms.thermostat_local_ip` / `config.json` des Dienstes | Tuya lokal v3.5, TCP 6668, **eine** Verbindung je Gerät | **Heizung** (einziger Steuerweg) | ja (SmartfoxTuya) | – |
| Österreich-PC (minipc-venediger) | .34 | – | – | – | – |

Grundsatz (Uli, 01.11.2026): Die Heizung steuert nur über die Thermostate. Smartfox, Fronius und die Wallboxen werden
nur **gelesen**.

## 2. Dienste auf dem Österreich-PC (NSSM)

| Dienst | Ordner | Aufgabe |
|---|---|---|
| SmartfoxFronius | `C:\Users\ulibe\smartfox-collector` | Fronius → `energy_readings` (Repo: `local-collector/smartfox-collector`) |
| SmartfoxTuya | `C:\Users\ulibe\tuya-thermostat` | Thermostate lesen/steuern (Repo-Stand v1.1, läuft v1.3 – K8) |
| Wallbox-Backend | `C:\Users\ulibe\Wallbox-Backend` | Gäste-Laden, Keba über Modbus, SQLite-Ladevorgänge; Port 8080 (Repo `UliBer1508/Wallbox-Backend`) |
| alexa-bridge | im Wallbox-Backend-Repo | Alexa |
| DiensteWaechter | `C:\Heizung\repo\local-collector\dienste-waechter` | Systemstatus in der App |
| Tailscale, Cloudflare-Tunnel | – | Fernzugriff |

## 3. Wallbox-Backend – was die Heizung lesen kann

- `GET http://localhost:8080/api/state` – je Wallbox Zustand und aktuelle Leistung (`watt`), Ladung der Sitzung (kWh).
  Das Backend fragt die Keba alle 3 s (lädt) bzw. 10 s (frei) ab – **die Heizung fragt die Keba nicht selbst**
  (Modbus-Zugriffe nicht doppeln).
- `GET http://localhost:8080/api/sessions?limit=200` – Ladevorgänge mit Beginn, Ende, kWh.
- Beide ohne Anmeldung, nur im LAN erreichbar. Doku: `Wallbox-Backend/Docs/WALLBOX-PROJEKT.md`.

## 4. Warum der Planer Warmwasser und Auto braucht

- **Mit Sonne** gibt der Smartfox einen Teil des Überschusses an Warmwasser und Auto. Die Heizung kann das nicht
  steuern. Für die Momentan-Steuerung ist es schon richtig erfasst: Die Einspeisung sinkt, wenn der Heizstab läuft
  (`doc/memory/hotwater-smartfox-autonomous.md` – keine zusätzliche Reserve abziehen). Für den **24-h-Plan** fehlt
  die Vorhersage, wann und wie viel.
- **Ohne Sonne** laden Warmwasser und Auto aus dem Netz – oder zuerst aus der Batterie, weil Fronius/Smartfox auf
  0 W Netzbezug regeln. Lädt das Auto abends, fehlt der Batteriestrom nachts der Heizung.
- Gemessen 29.10.–11.11.2026: rund 205 kWh Verbrauch neben Heizung und Grundlast, davon geschätzt ~60 kWh aus dem
  Netz und ~30 kWh aus der Batterie (`doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md`).

## 5. Nächster Schritt (offen, Entscheidung Uli)

Fronius-Collector liest jede Minute zusätzlich Smartfox `/values.xml` (Warmwasser) und Wallbox-Backend `/api/state`
(Auto, je Box) und schreibt sie als eigene Spalten neben PV/Netz/Batterie. Daraus lernt der Planer die Muster.
Am Wallbox-Backend und am Smartfox ändert sich nichts.
