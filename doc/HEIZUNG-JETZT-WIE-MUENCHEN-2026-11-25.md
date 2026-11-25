# Heizung jetzt – gleicher Aufbau wie München (25.11.2026)

Uli 24.11.2026: Heizung München wurde entsprechend Venediger gebaut, beide Systeme sollen gleich sein.
Die Karte „Heizung jetzt“ war in beiden Apps auseinandergelaufen. Mockup am 25.11. freigegeben („ja bauen“).

## Gemeinsamer Aufbau (beide Apps)
1. Drei Zahlen: Heizung jetzt · laut Geräten · Grenze. Je Haus anders nur die ersten zwei (Venediger: gemessen /
   laut Thermostaten; München: Wärmepumpe geschätzt / Kreise offen – Wärmepumpe nicht gemessen, Ventile ohne Leistung).
2. Prüfzeile mit Erklärung bei Abweichung (Venediger: `erklaereAbweichung`, unverändert).
3. **Woher kommt der Heizstrom?** Heute/Woche/Monat/Jahr, Balken Sonne/Akku/Netz in kWh – **neu in Venediger**.
4. Räume mit „seit“ und Begründung der Automatik.
5. Netzstrom sparen (nur Hinweise).

## Venediger – Änderungen
- `supabase/SQL/59_heizstrom_herkunft.sql`: `heizstrom_herkunft(p_von)` – Heizstrom ab Datum aus `energie_stunde`,
  anteilig je Stunde: Netz = Heizung × Bezug/Verbrauch, Akku = Heizung × Entladung/Verbrauch, Sonne = Rest.
  Gleiche Feldnamen wie München (`heat_kwh`, `heat_pv_kwh`, `heat_bat_kwh`, `heat_grid_kwh`).
- `src/components/overview/HeatingNow.tsx`: Abschnitt „Woher kommt der Heizstrom?“. Volle Stunden aus der Funktion,
  dazu live der Rest seit der letzten gerechneten Stunde (Heizstrom heute laut `raum_heizung_heute` minus schon
  gerechnet), aufgeteilt wie die Quellen jetzt.
- Nachgerechnet 25.11. bis 11:00: 28,5 kWh – Sonne 2,4 · Akku 1,3 · Netz 24,8. November bis 25.11.: 833 kWh –
  Sonne 96 · Akku 103 · Netz 634.

## Einspielen
SQL 59 im SQL-Editor ausführen, PR mergen (Vercel baut automatisch). Ohne SQL 59 zeigt die Karte den Hinweis, es auszuführen.
