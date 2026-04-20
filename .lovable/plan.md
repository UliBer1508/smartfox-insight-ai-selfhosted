
## Befund: Warum die Batterie heute trotz 80%-Regel auf 5% fiel

Die Doku in `SYSTEM_DOCUMENTATION.md §6` und `mem://arch/pv-automation-budget-logic-v2` definiert klar:
- Komfort = NUR echter Export
- Eco über Batterie nur wenn `SOC ≥ heating_min_battery_soc` (80%)
- Tuya-Quota schonen

Im Code (`pv-automation/index.ts` Zeile 1338) steht das Gate so:

```ts
const socGateBlocked = batterySoc < heatingMinSoc && batteryPower < 0;
```

### Fehler 1 — Gate-Lücke bei `batteryPower = 0`
Im Log um 19:54: `SOC 5% < Reserve 80%, aber Batterie lädt (0W) → Heizung erlaubt`. `batteryPower = 0` ist weder Laden noch Entladen (idle, weil leer). Die Bedingung `batteryPower < 0` ist false → Gate greift nicht, obwohl SOC=5%. Bei jedem Mess-Jitter (kurz +1W "Laden") fällt der Schutz weg.

### Fehler 2 — Eco-Budget kennt keine harte SOC-Obergrenze für Batterie-Nutzung
Die Definition lautet "Batterie darf nur über 80% angezapft werden". Im Code wird Batterie aber **immer** dann mitverwendet, wenn `availableBudget = gridExport + currentlyHeatingPower + tolerance + ...` ist und gleichzeitig `batteryPower < 0` (entlädt) — aber NUR über kleine Korrekturen (Ladereserve unter 80%) reduziert wird. Es gibt kein Statement: „wenn `batterySoc < 80` UND `power_io > 0` (Netzbezug oder Batterie-Entladung trägt Heizung) → harter Stop". Während des 13–17 Uhr Crashs lief Heizung über stundenlange Komfort-Targets (21°C) weiter, weil:
- Komfort-Targets schon vormittags gesetzt wurden
- Thermostate autonom takten — App stoppt nichts aktiv
- Beim Übergang SOC 100→88→48% war Phase-2-Komfort längst aktiv und blieb stehen

### Fehler 3 — Gate sendet keine aktiven Stop-Befehle
Selbst wenn Gate richtig greift, setzt es nur `availableBudget=0`. Die Thermostate behalten ihren Komfort-Sollwert und heizen autonom weiter. Es gibt keinen Code-Pfad „SOC-GATE aktiv → Komfort-Räume aktiv auf eco/night zurücksetzen". Logs zeigen heute nur 1 echten Stop-Versuch (Haustür), und der scheiterte an Quota.

### Fehler 4 — Quota-Verbrauch durch ML-Exploration trotz vollem Cache
Log zeigt 12× `Policy unzureichend → LLM-Exploration` pro Heartbeat. Bei jedem 2-Min-Run werden Räume vom LLM neu bewertet — Tuya-Quota wird durch konsequente Re-Sync-Versuche (Pre-sync, Critical-Eco-Transition, Phase-Korrekturen) ausgeschöpft (heute 222/200). Dadurch ist im Notfall **kein Tuya-Stop mehr möglich**.

## Lösung — strikte Umsetzung der dokumentierten Regel

### A) Gate-Bedingung korrekt formulieren (1 Codezeile)
`pv-automation/index.ts` Zeile 1338:
```ts
// VORHER:
const socGateBlocked = batterySoc < heatingMinSoc && batteryPower < 0;
// NACHHER (greift auch bei idle und bei Netzbezug):
const socGateBlocked =
  batterySoc < heatingMinSoc &&
  (batteryPower <= 50 || (reading.power_io ?? 0) > 50);
```
Bedeutung: Sobald SOC < 80% UND Batterie nicht aktiv lädt (>50W Toleranz) ODER Netzbezug stattfindet → Gate aktiv. Schließt die heutige Lücke (`batteryPower=0` bei leerer Batterie).

### B) Komfort-Budget unabhängig vom Gate hart an SOC koppeln
Direkt nach Zeile 1351 ergänzen:
```ts
// Komfort darf NIEMALS bei SOC < heatingMinSoc laufen, auch nicht wenn Batterie gerade lädt.
if (batterySoc < heatingMinSoc) {
  if (comfortBudget > 0) console.log(`[SOC-GATE] Komfort hart gesperrt: SOC ${batterySoc}% < ${heatingMinSoc}% → comfortBudget ${comfortBudget}W → 0W`);
  comfortBudget = 0;
}
```

### C) Aktive Notfall-Stops bei Gate-Aktivierung
Wenn `socGateBlocked === true` UND `socGateMode === 'strict'`:
- Iteriere alle Räume mit `target_temp > eco_temp` ODER `is_heating === true`
- Setze `target_temp = night_temp` (frost_only) via Tuya, Quota-Override-Flag `priority='emergency'`
- Falls Cloud-Quota erschöpft: schreibe in `thermostat_commands` mit `command='emergency_stop'` für Local-Service-Pickup
- Log-Marker `[SOC-GATE-STOP]` pro Raum

Damit halten die Thermostate beim nächsten Hysterese-Check (Zeile ~1334) automatisch auf night_temp und zapfen die Batterie nicht weiter an.

### D) Tuya-Quota schonen — Dokumentierte Schutzmechanismen verschärfen
Logs zeigen: `222/200 heute` heißt jeder Heartbeat (alle 2 Min) macht im Schnitt 0.3 Calls — bei Crashs steigt das durch Cleanup-Versuche stark. Maßnahmen:

1. **Pre-Sync-Throttle prüfen:** Aktuell „Throttle: nächster Sync in 76 Min" → ok, läuft.
2. **Critical-Eco-Transition** (19:54 Log: „Quota-Override für Eco") springt fälschlich um 19:54 an, obwohl Eco-Übergang am Morgen (09:00) gemeint ist. Bedingung muss präzisiert werden auf `currentWienHour === 9 && wienMinute < 30 && roomsStillOnNight > 0` — nicht „19:xx".
3. **ML-Exploration nicht pro Heartbeat:** `Policy unzureichend → LLM-Exploration` für 12 Räume × 30 Heartbeats/Stunde × Gemini-Calls → führt zum 429 Rate-Limit (im Log mehrfach). Throttle pro Raum auf max. 1× pro 30 Min einbauen.
4. **Notfall-Stops bei Gate haben Quota-Override**, alle anderen Stops respektieren `tempAlreadyCorrect`-Gate.

### E) Memory- und Doku-Update
- `mem://arch/pv-automation-budget-logic-v2`: Gate-Bedingung erweitert (idle + grid_import), Komfort-Hard-Lock unabhängig vom Gate, aktive Notfall-Stops mit Quota-Override
- `.lovable/SYSTEM_DOCUMENTATION.md` §6 und §10: gleiche Präzisierung
- `.lovable/CHANGELOG.md`: neuer Eintrag „[3.1.0] Battery-Drain-Schutz gehärtet"

## Was unverändert bleibt
- 80% bleibt der definierte Schwellwert (`heating_min_battery_soc`)
- Mikro-Budget, Tolerante Deaktivierung, Phase-Strategie, Forecast-Bonus, Cloud/Local-Modus
- Smartfox-Boiler bleibt außerhalb der App-Steuerung
- Kein neues Setting nötig

## Erwartetes Verhalten beim heutigen Szenario
- 13:00 SOC=88%, `power_io=+2625W` (Netzbezug), Batterie entlädt 4kW → **Gate aktiv** (SOC < 80? nein noch nicht — aber Komfort-Hard-Lock greift trotzdem nicht da SOC=88>80; **das ist OK**, Komfort ist erlaubt)
- 13:30 SOC=70%, Entladung läuft → **Gate strict aktiv** (SOC<80, batteryPower<50 oder grid_import>0) → `[SOC-GATE-STOP]` für alle Komfort-Räume auf night_temp, Quota-Override
- 14:00 SOC=48%: Heizung trägt **0W** mehr bei
- Resultat: Crash auf ~30% statt auf 5% (Differenz = Boiler+Haushalt, App-extern)

## Technische Details
- 1 DB-Migration nicht nötig (alle Settings existieren)
- Edge Function: nur `supabase/functions/pv-automation/index.ts` ändern (~80 LOC: Gate-Bedingung + Komfort-Hard-Lock + Stop-Schleife + Critical-Transition-Fix + ML-Throttle)
- 1 neuer DB-Insert-Pfad in `thermostat_commands` mit `command='emergency_stop', value=night_temp`
- Local-Service braucht keine Änderung (interpretiert `set_temperature` bereits)
- Frontend: keine Änderung
