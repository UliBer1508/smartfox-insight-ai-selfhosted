

# Plan: Local Key Eingabefeld hinzufuegen

## Uebersicht

Das Raum-Bearbeitungsformular hat Felder fuer "Tuya Device ID" und "Thermostat IP-Adresse", aber es fehlt das Eingabefeld fuer den **Local Key** - obwohl die Datenbank das Feld `local_key` bereits unterstuetzt.

## Aenderungen

### 1. RoomManager.tsx - Local Key Feld hinzufuegen

**Datei:** `src/components/heating/RoomManager.tsx`

Zwischen dem "Tuya Device ID" Feld und dem "PV-Ueberschuss Automatik" Toggle ein neues Eingabefeld einfuegen:

```text
Neues Feld nach Zeile 224:
+--------------------------------------------+
| Local Key                                  |
| [________________________________]         |
| 16-Zeichen Schluessel aus Tuya API         |
+--------------------------------------------+
```

**Technische Details:**
- Feldname: `local_key`
- Input-Typ: Text (password-style optional fuer Sicherheit)
- Placeholder: "16-Zeichen Key aus API Explorer"
- Hilfetext erklaert woher der Key kommt

### 2. Default Room erweitern

In `defaultRoom` (Zeile 24-38) das Feld `local_key: null` hinzufuegen, damit neue Raeume korrekt initialisiert werden.

## Ergebnis

Nach der Aenderung kannst du:
1. Einen Raum bearbeiten (z.B. "Zimmer Uli")
2. Den Local Key `uaD>qJ|v/-P:MqE}` ins neue Feld eingeben
3. Die lokale IP-Adresse eintragen (z.B. `192.168.1.xxx`)
4. Speichern - und der Local Collector kann das Thermostat lokal steuern

## Aufwand

- Minimale Aenderung: ~15 Zeilen Code
- Keine Datenbank-Migration noetig (Spalte existiert bereits)
- Keine neuen Abhaengigkeiten

