# Tuya-Lizenz erneuert – Thermostat-Uhrzeit wieder korrekt (15.11.2026)

## Problem
Die 12 Thermostate (TGP508 / BEOK) hatten eine falsche Uhrzeit. Folge: Zeitprogramme und Nachtmodus der Geräte
liefen zur falschen Zeit.

## Ursache
Die Tuya-Cloud-Lizenz (IoT Core / Develop Base Resource auf der Tuya IoT Platform) war abgelaufen. Die Thermostate
holen ihre Uhrzeit über die Tuya-Cloud – ohne gültige Lizenz bekommen sie keine korrekte Zeit, auch wenn die
Steuerung im Lokal-Modus (Port 6668) weiterläuft.

## Lösung
Am 15.11.2026 die Lizenz auf https://iot.tuya.com verlängert (Cloud → Projekt → IoT Core Service verlängern).
Danach zeigen alle Thermostate wieder die richtige Uhrzeit. Keine Code- oder Datenbankänderung.

## Wartung – alle 6 Monate erneuern

| Erneuert am | Nächste Erneuerung |
|---|---|
| 15.11.2026 | ca. 15.05.2027 (Erinnerung am Handy: 08.05.2027, wiederkehrend alle 6 Monate) |

Nach jeder Erneuerung prüfen:
1. Uhrzeit an den Thermostaten korrekt
2. `service_health`: `devices_ok` 12/12 und frischer `last_sync`
3. Keine offenen `device_offline`-Einträge in `api_errors`
4. Einstellungen › Tuya Cloud: Ablaufdatum zeigt das neue Datum
5. Diese Tabelle um eine Zeile ergänzen

## Diagnose-Hinweis
Zeigen die Thermostate eine falsche Uhrzeit oder fällt die Cloud-Steuerung (`tuya-control`) aus, **zuerst den
Lizenzstatus auf iot.tuya.com prüfen**, bevor Dienst, Netzwerk oder `local_key` untersucht werden.

## Nebenwirkungen
Keine – reine Verlängerung des Tuya-Abos, kein Eingriff in Code, Datenbank oder Dienste.
