

# Beschreibung "Lokaler Service" korrigieren

## Problem

Die Beschreibung im Einstellungs-Panel sagt "Befehle werden an den lokalen Node.js Collector gesendet", was nicht stimmt. Der Thermostat-Service ist ein **separater Prozess** und nicht Teil des Fronius-Collectors.

## Aenderung in `src/components/energy/SettingsPanel.tsx`

Drei Textstellen werden korrigiert:

1. **Zeile 88** (Radio-Button Beschreibung):
   - Alt: "Befehle werden an den lokalen Node.js Collector gesendet (LAN-Steuerung). Kein Cloud-API-Verbrauch."
   - Neu: "Befehle werden an den lokalen Thermostat-Service gesendet (LAN-Steuerung). Kein Cloud-API-Verbrauch."

2. **Zeile 97** (Info-Alert im lokalen Modus):
   - Alt: "Im lokalen Modus werden alle Thermostat-Befehle ueber den Node.js Collector ausgefuehrt."
   - Neu: "Im lokalen Modus werden alle Thermostat-Befehle ueber den lokalen Thermostat-Service ausgefuehrt."

3. **Zeile 190** (Erklaerung "So funktioniert es"):
   - Pruefen ob der Text dort korrekt ist (bezieht sich auf den Fronius-Collector fuer Energiedaten, was stimmt)

