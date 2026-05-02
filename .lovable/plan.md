## Diagnose

Das Problem lösen wir nicht mit „mehr Quote“, sondern mit saubereren Zustandsregeln.

Aktueller Befund:

- Die externe Tagesquote ist aktuell nicht das Hauptproblem. Heute um 08:02 stand der Zähler erst bei `11/200`.
- Trotzdem wurden schon direkt nach Tagesstart unnötig viele Calls gemacht: 08:00 = 3 Calls, 08:02 = 6 Calls.
- Ursache ist vor allem interne Logik:
  - Der Übertemperatur-Stop sendet Stop-Calls, obwohl der Sollwert teilweise bereits korrekt auf Eco steht.
  - `is_heating=true`/alte Heizstatus-Werte lösen zusätzliche Sicherheits-Calls aus, obwohl oft nur ein DB-Status korrigiert werden müsste.
  - Der Nacht-Push setzt `night_frost_last_pushed` auch bei Fehlern. Dadurch geht die Anlage in Quiet Mode, obwohl nur 2/12 Zimmer wirklich auf Nacht/Frost gesetzt wurden.
  - Die Stop-Reserve ist mit `3` Calls zu klein, wenn abends mehrere Räume zuverlässig zurückgestellt werden müssen.

Ziel: Die neue One-Shot-Strategie strikt machen: morgens einmal Eco, tagsüber nur notwendige Komfort-Upgrades und Sättigungs-Rückstellungen, abends einmal Nacht/Frost. Keine wiederholten „Stop“- oder „Sync“-Calls, wenn der Sollwert schon korrekt ist.

## Umsetzungsplan

### 1. Nacht-Push fehlertolerant machen

Die Nacht-Umschaltung darf erst als erledigt gelten, wenn alle notwendigen Räume erfolgreich gesetzt wurden.

Änderung:

- `night_frost_last_pushed` wird nur als abgeschlossen gespeichert, wenn `failures === 0`.
- Bei Fehlern wird kein Quiet Mode für die ganze Nacht aktiviert.
- Stattdessen werden nur die fehlgeschlagenen Räume später erneut versucht.
- Retry-Intervall: 15 Minuten, damit wir keine API-Spam-Schleife erzeugen.
- Beim Retry werden nur Räume angepasst, deren `target_temp` noch über Nacht/Frost liegt.

Ergebnis:

- Wenn 2/12 erfolgreich waren, bleiben diese 2 ruhig.
- Die übrigen 10 werden später erneut versucht.
- Es gibt keinen falschen „Nacht erledigt“-Status mehr.

### 2. Stop-Reserve realistisch anpassen

Aktuell erlaubt die Stop-Reserve nur 3 Sicherheits-Calls. Für eine sichere Nachtumschaltung bei 12 Thermostaten ist das zu wenig.

Änderung:

- Stop-Reserve für echte Rückstell-/Sicherheitsaktionen auf mindestens 12 bis 15 Calls erhöhen.
- Diese Reserve gilt nur für Senkungen: Komfort/Eco zurück auf Eco, Nacht oder Frost.
- Aufheiz-Calls dürfen diese Reserve nicht verwenden.

Ergebnis:

- Selbst wenn der normale Tageszähler intern als knapp gilt, können abends alle Räume sicher abgesenkt werden.
- Die Reserve kann nicht für Komfort-Heizen verbraucht werden.

### 3. Übertemperatur-Stop entprellen

Der aktuelle Übertemperatur-Stop verursacht unnötige Calls, wenn das Gerät bereits auf dem richtigen Sollwert steht.

Änderung:

- Wenn `current_temp >= target_temp + 0.4`, aber `target_temp` bereits Eco oder niedriger ist, wird zuerst nur der DB-Heizstatus korrigiert:
  - `is_heating=false`
  - `pv_auto_active=false`, falls passend
  - `heating_paused_reason='over_temp_db_only'`
- Ein echter Tuya-Call wird nur gesendet, wenn der Sollwert noch zu hoch ist und wirklich reduziert werden muss.

Beispiel:

```text
Ist: 21.6°C
Soll: 21°C Eco
DB sagt: is_heating=true

Heute: Tuya-Call 21°C erneut
Neu: kein Tuya-Call, nur DB-Status korrigieren
```

Ergebnis:

- Die 08:02-Stop-Call-Welle wird stark reduziert.
- Die Thermostate werden nicht unnötig mit identischem Sollwert beschrieben.

### 4. One-Shot-Regel pro Raum erzwingen

Die Automatik soll pro Raum und Tag nur die wirklich notwendigen Zustandswechsel senden:

1. Morgen: Nacht/Frost -> Eco
2. Wenn genug Überschuss: Eco -> Komfort
3. Wenn Komfort erreicht: Komfort -> Eco, `comfort_saturated_at` setzen
4. Abend: Eco/Komfort -> Nacht/Frost

Änderung:

- Vor jedem Tuya-Call prüfen:
  - Ist der gewünschte Zielwert bereits in der DB gesetzt?
  - Ist die Aktion nur eine Statuskorrektur?
  - Ist es eine echte Temperaturänderung?
- Nur echte Temperaturänderungen senden.
- `last_thermostat_sync` nicht als Grund für regelmäßige Force-Syncs während normalem Betrieb verwenden, außer in echten Sicherheitsfenstern.

Ergebnis:

- Der 1-Stunden-Zeitschaltzyklus erzeugt keine stündlichen Calls.
- Der 2-Minuten-Heartbeat bleibt reaktiv, aber call-sparsam.

### 5. Morgen-Eco und Komfort-Sättigung sauber trennen

Heute sieht man, dass um 08:00/08:02 Eco, Komfort-Sättigung und Übertemperatur-Stop teilweise gleichzeitig wirken.

Änderung:

- Direkt nach Tagesstart zuerst Eco-Transition abarbeiten.
- Komfort-Sättigung erst nach der Eco-Phase bewerten.
- Wenn ein Raum bereits auf Eco steht und warm genug ist, kein Tuya-Call.
- `comfort_saturated_at` wird nur gesetzt, wenn ein Raum wirklich Komfort erreicht hatte und anschließend auf Eco zurückgestellt werden soll.

Ergebnis:

- Kein unnötiges „Eco nochmal setzen“.
- Kein Komfort-Rückstell-Call, wenn der Raum ohnehin schon auf Eco steht.

### 6. Transparente Call-Auswertung ins Logging aufnehmen

Damit wir danach eindeutig sehen, ob die Logik funktioniert, ergänzen wir die Logs um Gründe für gesparte Calls.

Beispiele:

```text
[CALL-SKIP] Zimmer Uli: target already eco, DB-only overtemp correction
[CALL-SEND] Wohnzimmer: comfort -> eco, comfort_saturated
[CALL-SEND] Bad Uli: night push 21 -> 5
[CALL-RETRY] Night retry: 4 failed rooms remaining
```

Zusätzlich soll die Abschlusszeile klarer sein:

```text
Tuya API calls: 3 sent, 9 skipped, reason: already-correct/db-only
```

## Erwarteter Call-Verbrauch nach Fix

Bei 12 Räumen:

```text
08:00 Eco-Push:        maximal 12 Calls, oft weniger
Komfort-Upgrades:      maximal 12 Calls
Komfort -> Eco:        maximal 12 Calls, nur wenn Komfort wirklich erreicht wurde
20:00 Nacht/Frost:     maximal 12 Calls
```

Realistisch an einem normalen PV-Tag:

```text
Eco morgens:           0-12
Komfort tagsüber:      3-12
Sättigung zurück Eco:  3-12
Nacht/Frost:           12
Gesamt:                ca. 25-40 Calls
```

Wichtig: Der Heartbeat oder die 1-Stunden-Zeitschaltung dürfen danach keine zusätzlichen Wiederholungs-Calls mehr erzeugen, solange der Sollwert schon korrekt ist.

## Dateien/Backend-Bereiche

Ich würde hauptsächlich die bestehende Automationsfunktion anpassen:

- `supabase/functions/pv-automation/index.ts`
  - Nacht-Gate success-gated machen
  - Retry-Logik für fehlgeschlagene Nacht-Räume
  - Stop-Reserve erhöhen und nur für Temperatur-Senkungen nutzen
  - Übertemperatur-Stop DB-only machen, wenn kein echter Setpoint-Wechsel nötig ist
  - Skip-/Logging-Regeln verschärfen

Optional, falls nötig:

- `system_settings`
  - `night_frost_last_pushed` Struktur erweitern um Retry-Status
  - vorhandenen fehlerhaften Gate-Eintrag für die letzte Nacht zurücksetzen, damit die neue Logik sauber greifen kann

## Validierung nach Umsetzung

Nach der Änderung prüfe ich:

1. Manuell `/pv-automation/check` ausführen.
2. Logs prüfen:
   - keine unnötigen Stop-Calls bei bereits korrektem Eco-Sollwert
   - klare Skip-Gründe
3. Datenbank prüfen:
   - Räume haben korrekte `target_temp`
   - `comfort_saturated_at` wird nur sinnvoll gesetzt
   - `night_frost_last_pushed` wird nur bei vollständigem Erfolg abgeschlossen
4. Call-Zähler prüfen:
   - keine schnelle Call-Welle wie heute 08:00/08:02

Wenn du den Plan freigibst, setze ich das so um.