Ziel: Räume sofort stoppen, wenn Ist-Temperatur über Ziel liegt (besonders ohne PV), statt minutenlang weiter als „Heizt“ zu laufen.

Kurzdiagnose (aus Code + Daten):
1) In `pv-automation` wird der Cooldown sehr früh geprüft (`continue`), dadurch werden Sicherheits-Korrekturen (Runterregeln/Aus) teilweise verzögert.
2) Die „Skip“-Logik prüft primär Sollwert/Status-Flags; ein Raum kann trotz `current_temp > target_temp` noch als „nicht änderungsbedürftig“ durchgehen.
3) `is_heating` in `tuya-control` vertraut aktuell zu stark auf `work_state`; dadurch kann „Heizt“ stehen bleiben, obwohl Ist > Ziel.
4) Die Automationsentscheidung nutzt nicht garantiert frische Thermostatwerte vor jeder Runde.

Umsetzungsplan:
1) Frische Thermostatdaten vor jeder Automationsrunde sicherstellen  
   - In `supabase/functions/pv-automation/index.ts` zu Beginn von `/check` einen internen `sync-all`-Aufruf einbauen (Cloud-Modus), danach Räume neu laden.  
   - Wenn Sync fehlschlägt: in sicheren Fallback gehen (keine aggressiven Aufheiz-Aktionen, nur Reduktionen/Stops).

2) Übertemperatur-Sicherheitsregel (harter Stop) ergänzen  
   - In `pv-automation` pro Raum vor ML/Komfort-Entscheidung prüfen: `current_temp >= target_temp + deadband` (z. B. 0.4°C).  
   - Dann sofort `deactivate` erzwingen und Temperatur nicht erhöhen.  
   - Diese Aktion muss Cooldown umgehen.

3) Cooldown-Regel korrigieren  
   - Cooldown nur für Aufheiz-Aktionen anwenden (Temperatur rauf / aktivieren).  
   - Für Sicherheitsfälle (runterregeln, Budget-Stopp, Übertemperatur) Cooldown bypassen.

4) Skip-Logik erweitern  
   - `shouldSkip` um „heizt trotz Übertemperatur“ ergänzen: Wenn `is_heating=true` und Ist deutlich über Ziel, niemals skippen; Stop-Befehl immer senden.

5) Heizstatus-Erkennung präzisieren (`tuya-control`)  
   - In `parseThermostatStatus` Hysterese einführen: „heizt“ nur, wenn echte Wärmeanforderung besteht (Ist unter Ziel mit kleiner Toleranz).  
   - `work_state` nur als Zusatzsignal nahe am Ziel verwenden, nicht als alleiniger Trigger bei deutlicher Übertemperatur.

Technische Details (Dateien):
- `supabase/functions/pv-automation/index.ts`
  - Pre-sync Hook vor Room-Decision
  - Over-temp guard
  - Cooldown-Refactor (nur für Heat-up)
  - Skip-Refactor (`needsHeatingStop`)
- `supabase/functions/tuya-control/index.ts`
  - `parseThermostatStatus` mit Deadband/Hysterese für robustes `is_heating`

Validierung (End-to-End):
1) Nach Fix: bei `Ist >= Ziel + 0.4°C` wird in der nächsten Automationsrunde ein Stop/Reduktionsbefehl gesendet (ohne Cooldown-Wartezeit).
2) `pv-automation/check`-Antwort zeigt in solchen Fällen keine „cooldown“-Einträge mehr, sondern Sicherheits-Deaktivierung.
3) Räume mit Übertemperatur verschwinden zeitnah aus „Heizt“-Anzeige.
4) Verbrauch fällt in „keine PV“-Phasen schneller ab, statt länger hoch zu bleiben.