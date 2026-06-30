# Fix: "Alle pushen"-Fehler + Eco/Komfort-Widerspruch

## Diagnose

**1. "Alle pushen" wirft Fehler**
Die Anlage läuft im **lokalen Steuerungsmodus** (`tuya_control_mode = local`). Die Buttons „Alle pushen" (HeatingDashboard) und „Sync now" (Raum-Übersicht) rufen aber die **Cloud**-Edge-Function `tuya-control/push-all-temps` auf. Diese blockt im Local-Modus mit HTTP 403 (`„Cloud-Modus deaktiviert"`). `supabase.functions.invoke` wertet 403 als Fehler → es erscheint nur eine generische Fehler-Meldung.

**2. Raumübersicht „Eco" vs. Tagesprogramm „Komfort"**
Kein echter Konflikt:
- Das Badge im *Heizungs-Tagesprogramm* zeigt nur den **theoretischen** Modus aus Uhrzeit + PV-Überschuss (850W > Schwelle 200W → „Komfort").
- Die *Raum-Übersicht* zeigt die **tatsächlichen** Soll-Temperaturen (Eco 21°).
- Die Räume stehen auf Eco, weil sie **komfort-gesättigt** sind (`comfort_saturated_at` heute gesetzt) — das ist laut Optimierungsstrategie korrekt (Estrich speichert Wärme, 1 Call zurück auf Eco). Das Badge ist nur irreführend, weil es die Sättigung ignoriert.

## Lösung

### A) Push im Local-Modus reparieren (`src/hooks/usePushAllTemps.ts`)
`usePushAllTemps` modus-bewusst machen (analog `useTuyaControl.setTemperature`):
- Modus via `useControlMode()` lesen.
- **Local-Modus:** alle Räume mit `tuya_device_id` + `target_temp` laden und je Raum eine Zeile in `thermostat_commands` (`command: 'set_temp'`, `value: target_temp`, `status: 'pending'`) einfügen; `last_thermostat_sync` aktualisieren. Erfolgs-Toast „N Sollwerte an lokalen Service gesendet". Kein Cloud-Quota-Verbrauch.
- **Cloud-Modus:** bestehender Aufruf bleibt unverändert.
- Rückgabeobjekt vereinheitlichen (`{ success, successCount, totalCount }`), damit `RoomStatusTable.handleSyncNow` und `HeatingDashboard` weiter funktionieren.

### B) Tagesprogramm-Badge ehrlich machen (`src/components/heating/DailyHeatingSchedule.tsx`)
- Neben dem theoretischen PV-Modus den **tatsächlichen** Zustand aus den Räumen ableiten (Mehrheits-Soll vs. eco/comfort je Raum).
- Wenn theoretisch „Komfort", die Räume aber faktisch auf Eco stehen (Komfort-Sättigung), Badge auf **„Eco"** setzen mit kleinem Zusatz-Hinweis **„Komfort gesättigt"** (Tooltip/Untertitel), statt fälschlich „Komfort" anzuzeigen.
- Pro-Raum-Hervorhebung der aktiven Temperatur-Spalte an der **echten** `target_temp` ausrichten (nicht nur am globalen Modus), damit Tabelle und Badge konsistent zur Raum-Übersicht sind.
- Die drei Referenz-Kacheln (Nacht/Eco/Komfort mit PV-Schwelle) bleiben als Erklärung erhalten.

## Technische Details
- `thermostat_commands`-Insert-Muster ist bereits in `useTuyaControl.ts` etabliert (set_temp/pending) und wird vom lokalen Node-Collector über LAN (Port 6668) abgearbeitet.
- Komfort-Sättigung erkennbar über `target_temp <= eco_temp` bei theoretischem Komfort-Modus; `comfort_saturated_at` ist in der DB vorhanden (optional zusätzlich abfragbar, für die UI reicht der Temperaturvergleich).
- Reine Frontend-/Hook-Änderungen, keine Edge-Function- oder DB-Schema-Änderung nötig.

## Geänderte Dateien
- `src/hooks/usePushAllTemps.ts` — Local-/Cloud-Verzweigung
- `src/components/heating/DailyHeatingSchedule.tsx` — Badge & Spalten-Highlight an echtem Raumzustand
