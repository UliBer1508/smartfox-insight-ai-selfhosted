## Ziel

Das Badge oben rechts zeigt aktuell nur "Cloud deaktiviert" (rot), wenn die Tuya Cloud aus ist. Da in diesem Zustand die Steuerung über den lokalen LAN-Service (Port 6668) läuft, soll das auch sichtbar gemacht werden.

## Änderung

Datei: `src/components/layout/ControlModeBadge.tsx`

Wenn `cloudDisabled === true`:
- Label: **"Cloud aus · Lokal"** (statt nur "Cloud deaktiviert")
- Icon: `Network` (LAN) statt `Ban` — signalisiert aktive lokale Steuerung
- Farben: weiter rot/warnend, damit klar bleibt, dass Cloud bewusst aus ist, aber mit LAN-Icon als positives Signal "lokal aktiv"
- Tooltip: "Tuya Cloud ist deaktiviert — Steuerung läuft über lokalen Service (LAN, Port 6668)"

Sonst unverändert (Lokal / Cloud).

## Nicht enthalten

- Keine Logik-Änderungen, keine DB-Änderungen
- Keine zusätzlichen Badges, nur Text/Icon/Tooltip des bestehenden Badges
