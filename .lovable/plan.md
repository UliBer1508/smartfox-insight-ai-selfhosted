## Banner "Aktive Verbraucher" entfernen

Der orange Banner ist obsolet, sobald wir Tuya-Calls reduzieren und nur noch Soll-Zustände setzen — Live-Heizleistung pro Raum lässt sich dann nicht mehr ehrlich anzeigen.

## Änderungen

**`src/pages/Index.tsx`**
- Zeile 16: Import `ConsumptionExplainer` entfernen
- Zeile 224: `<ConsumptionExplainer …/>`-Verwendung entfernen

**`src/components/energy/ConsumptionExplainer.tsx`**
- Datei löschen

**`src/hooks/useConsumptionAnalysis.ts`**
- Datei löschen (wird nur vom Banner verwendet)

**`src/hooks/useConsumerLogging.ts`**
- Prüfen: wird das Hook noch woanders verwendet? Falls nein → löschen. Falls ja → behalten.

## Was bleibt erhalten

- `consumer_logs`-Tabelle: bleibt (historische Daten)
- `useActiveHeatingRooms`-Hook: bleibt (wird auch von `RoomStatusTable` verwendet)
- Alle anderen Energy-Widgets (EnergyChart, EnergyStats, PowerStats, …): unverändert
