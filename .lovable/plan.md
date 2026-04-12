

# Warum die Räume trotz 6.5kW Export nicht auf Komfort schalten

## Ursache

Das System erkennt den Überschuss korrekt und **will** schalten, aber die Tuya API-Quota ist erschöpft:

- **Monatslimit**: 900 Calls
- **Bereits verbraucht**: 374 (41% nach 12 von 30 Tagen)
- **Dynamisches Tagesbudget**: 526 Rest / 19 Tage = 27 - 2 Reserve = **25 Calls/Tag**
- **Heute verbraucht**: **32 Calls** → Budget überschritten

Das eigentliche Problem ist strukturell: Bei 12 Räumen und einem 2-Minuten-Intervall reichen 25 Calls pro Tag nicht aus. Ein einziger Sync aller 12 Thermostate verbraucht 12 Calls — nach 2 Syncs + ein paar Temperatur-Änderungen ist das Tagesbudget weg.

## Lösung: Intelligenteres API-Budget-Management

### Änderung 1: Sync nur für Räume mit Änderungsbedarf

**`supabase/functions/pv-automation/index.ts`**

Statt alle 12 Thermostate blind zu syncen, nur die Räume kontaktieren bei denen sich die Zieltemperatur tatsächlich ändert. Der Pre-Sync (Status lesen) sollte seltener stattfinden (z.B. alle 30 Minuten statt alle 5) und nur Räume betreffen die gerade heizen oder geschaltet werden sollen.

### Änderung 2: Batch-Temperatur-Befehle gruppieren

Aktuell wird pro Raum ein eigener API-Call gemacht. Stattdessen:
- Nur Räume verarbeiten, die tatsächlich eine Temperatur-Änderung brauchen (Differenz >= 0.5°C)
- "Keine Änderung nötig" Räume überspringen ohne API-Call
- Dadurch sinkt der Verbrauch von ~12 Calls pro Zyklus auf 2-4

### Änderung 3: PV-Überschuss-Priorität bei Quota-Knappheit

Wenn das Tagesbudget unter 30% ist ABER hoher PV-Überschuss vorliegt (>3kW Export, Batterie >90%):
- Trotzdem die **Top-3 Prioritäts-Räume** auf Komfort schalten (max 3 Calls)
- Sync überspringen — nur schreiben, nicht lesen
- Damit wird das PV-Potenzial genutzt statt Strom ins Netz zu verschenken

### Änderung 4: Tages-Counter-Reset prüfen

Der Counter steht auf 32, aber es ist unklar ob wirklich 32 erfolgreiche API-Calls stattfanden oder ob der Counter durch fehlgeschlagene Calls aufgebläht wurde. Sicherstellen dass nur erfolgreiche Calls gezählt werden (das wurde laut Memory bereits implementiert — prüfen ob es korrekt funktioniert).

### Betroffene Dateien
1. `supabase/functions/pv-automation/index.ts` — Sync-Optimierung, PV-Priorität bei Quota-Knappheit, selektivere API-Calls

### Technische Details
- Pre-Sync Intervall von 5 auf 30 Minuten erhöhen
- Temperatur-Änderungen nur senden wenn Differenz >= 0.5°C
- Neuer Modus `quota_low_pv_priority`: Bei <30% Tagesbudget + >3kW Export werden max 3 priorisierte Räume geschaltet
- Geschätzter Effekt: Tagesverbrauch sinkt von ~30-40 auf ~10-15 Calls

