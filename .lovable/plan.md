
# Plan: Dialog scrollbar machen

## Problem

Das Raum-Bearbeitungsfenster hat nach dem Hinzufuegen des Local Key Feldes zu viele Eingabefelder. Auf kleineren Bildschirmen oder Mobilgeraeten ist der "Speichern"-Button abgeschnitten und nicht mehr erreichbar.

## Loesung

Den Dialog-Inhalt scrollbar machen, sodass alle Felder erreichbar sind und die Buttons immer sichtbar bleiben.

## Aenderungen

### 1. DialogContent mit maximaler Hoehe und Scrollbereich

**Datei:** `src/components/heating/RoomManager.tsx` (Zeile 107)

Aktuelle Klasse:
```
className="max-w-md"
```

Neue Klasse:
```
className="max-w-md max-h-[85vh] overflow-y-auto"
```

Dies begrenzt die Dialoghoehe auf 85% der Bildschirmhoehe und macht den Inhalt scrollbar.

### 2. Alternative: Nur Formular-Bereich scrollbar, Buttons fixiert

Falls gewuenscht, kann auch nur der Formular-Bereich scrollbar gemacht werden, waehrend die "Abbrechen" und "Speichern" Buttons immer sichtbar am unteren Rand fixiert bleiben.

## Ergebnis

- Dialog passt sich der Bildschirmhoehe an
- Alle Felder sind durch Scrollen erreichbar  
- "Speichern"-Button ist immer sichtbar
- Funktioniert auf Desktop und Mobilgeraeten
