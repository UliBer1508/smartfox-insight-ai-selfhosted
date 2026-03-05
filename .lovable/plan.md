

# "Letzte Aktionen" durch Echtzeit-Heizstatus ersetzen

## Problem

Die "Letzte Aktionen" zeigen historische `learning_events` (alle "vor 1 Tag"). Der User will sehen, **was jetzt gerade passiert** -- welche Raeume aktiv heizen, seit wann, mit welcher Leistung.

## Loesung

Den `useActiveHeatingRooms` Hook (existiert bereits) im AIStatusWidget nutzen statt `useAIStats.recentActions`:

### Aenderungen in `AIStatusWidget.tsx`

1. **Import `useActiveHeatingRooms`** statt der recentActions aus useAIStats
2. **"Letzte Aktionen" ersetzen durch "Aktive Heizungen"**: Zeigt pro Raum:
   - Flame-Icon + Raumname + Leistung (z.B. "Buero 600W")
   - Dauer seit Start (z.B. "seit 23 Min")
3. Wenn keine Raeume heizen: "Keine aktive Heizung"
4. Gesamtleistung als Zusammenfassung anzeigen (z.B. "Gesamt: 1.8 kW")

### Betroffene Datei

- `src/components/heating/AIStatusWidget.tsx` -- Collapsible-Inhalt der "Letzte Aktionen" Section ersetzen

Die historischen learning_events bleiben im `useAIStats` Hook fuer den Lernfortschritt erhalten, werden nur nicht mehr in der Aktions-Liste angezeigt.

