

# Analyse: Batterie-Logik Morgenverhalten

## Aktueller Stand

| Parameter | Wert |
|-----------|------|
| Wien-Zeit | ~07:32 (Nachtmodus bis 09:00) |
| Batterie SOC | 45.5% |
| target_battery_soc | **80%** |
| PV-Prognose | 27.5 kWh (sonniger Tag) |

## Was um 09:00 passiert

Die Batterie-Logik wurde korrekt implementiert. **Aber**: Bei `target_battery_soc = 80%` und aktuell 45.5% Batterie wird das System **auf PV warten** statt sofort zu heizen — trotz erwartetem Sonnentag.

Du hattest gesagt: "heute hat die batterie noch 47%, dies kann zum aufheizen genutzt werden wenn der tag sonnig werden soll". Das bedeutet, der Schwellwert von 80% ist **zu hoch**. Bei einem Sonnentag mit 27.5 kWh reichen 40-50% Batterie zum morgendlichen Aufheizen, da die Batterie tagsüber locker wieder geladen wird.

## Zweites Problem: Morning-Wait nur für Solar-Räume

Die `isMorningWaitPeriod` wird nur für Räume mit `has_solar_gain = true` aufgerufen (Zeile 1044). Alle anderen Räume gehen direkt in die Grid-Fallback-Logik und heizen sofort auf `eco_temp` — **unabhängig von der Batterie**.

## Logs

Die Edge Function Logs zeigen nur Boot/Shutdown-Events. Die `console.log`-Ausgaben der aktuellen (deployet um 06:32 UTC) Version werden erst beim nächsten Cron-Aufruf (jede 2 Minuten) sichtbar. Da aktuell Nachtmodus aktiv ist, wird die Morning-Wait-Logik erst ab 09:00 Wien-Zeit relevant.

## Vorschlag

Den `target_battery_soc` in den Heizungs-Einstellungen von **80% auf 40%** senken. Dann würde die Logik bei 45.5% Batterie + Sonnentag sofort heizen statt zu warten.

Dies ist eine reine Einstellungs-Änderung in der Datenbank — kein Code-Change nötig.

