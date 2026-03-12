

# Südraum / Solar-Gain Logik: Analyse und Vereinfachung

## Aktuelle Situation

Die `has_solar_gain`-Logik beeinflusst die Heizsteuerung an **4 Stellen**:

1. **Echtzeit-Solargewinn-Erkennung** (Zeile 1032-1042): Prüft `solar_heating_events` der letzten 60 Min. Wenn ein Raum sich durch Sonne erwärmt (+0.3°C/h), wird `action = 'keep'` gesetzt und der Thermostat bleibt auf eco_temp. **Greift für ALLE Räume**, nicht nur `has_solar_gain`.

2. **Morgen-Sperre** (Zeile 1044-1065): Nur für `has_solar_gain`-Räume — verzögert die Aufheizung morgens um bis zu 2 Stunden, damit die Sonne den Raum passiv aufwärmt statt Netzstrom zu verwenden.

3. **PV-Warte-Logik** (Zeile 1091): Wenn Überschuss vorhanden aber PV < 1000W, werden NUR `has_solar_gain`-Räume zurückgehalten (`action = 'keep'`). Andere Räume werden sofort aktiviert.

4. **Nord-Süd-Überschuss-Umleitung** (Zeile 1125-1147): Wenn Süd-Räume durch Sonne erwärmt werden, wird Überschuss gezielt zu Nord-Räumen umgeleitet.

## Bewertung

Der User hat recht: **Passiver Solargewinn durch Fenster ist kein Grund, die Heizung zu verzögern.** Wenn die Sonne einen Raum erwärmt, erreicht der Raum schneller die Zieltemperatur und der Thermostat schaltet sich automatisch ab. Das spart Strom — aber es braucht keine spezielle Logik dafür. Der Thermostat regelt das selbst.

**Was entfernt werden kann:**
- **Morgen-Sperre** (Punkt 2): Unnötig. Wenn morgens PV da ist, heizt PV-Modus ohnehin. Wenn Sonne den Raum passiv erwärmt, schaltet der Thermostat von allein ab.
- **PV-Warte-Logik** (Punkt 3): Die Sonderbehandlung für `has_solar_gain` bei PV < 1000W ist unnötig. Entweder es gibt genug PV-Überschuss oder nicht — das gilt für alle Räume gleich.
- **Echtzeit-Solargewinn-Override** (Punkt 1): Setzt den Thermostat auf eco_temp wenn Solargewinn erkannt wird. Aber der Thermostat regelt das selbst — wenn der Raum warm genug ist, heizt er nicht.

**Was beibehalten werden sollte:**
- **Nord-Süd-Überschuss-Umleitung** (Punkt 4): Kann vereinfacht werden. Die Logik "nutze Überschuss für kalte Räume" ist sinnvoll, braucht aber kein `has_solar_gain`-Flag. `gridExport > 1000` reicht.

## Vorgeschlagene Änderungen

### 1. Echtzeit-Solargewinn-Block entfernen (Zeile 1030-1065)
Den gesamten Block (Solargewinn-Erkennung + Morgen-Sperre) entfernen. Die normale Tag-Logik (PV-Modus / Grid-Fallback / ML) übernimmt.

### 2. PV-Warte-Sonderbehandlung entfernen (Zeile 1091-1098)
Den `has_solar_gain`-Check bei "Überschuss vorhanden aber PV < 1000W" entfernen. Entweder auf die PV-Leistung warten (für alle Räume) oder gar nicht warten.

### 3. Nord-Überschuss-Umleitung vereinfachen (Zeile 1121-1147)
Die Bedingung `southRoomsHeatedBySun` entfernen. Stattdessen: Wenn `gridExport > 1000W` und ein Raum unter eco_temp ist, Überschuss nutzen — unabhängig von der Ausrichtung.

### 4. `solar_heating_events`-Abfrage entfernen (Zeile 622-639)
Die DB-Abfrage für `solar_heating_events` wird nicht mehr benötigt, da der Echtzeit-Check entfällt.

### 5. `isMorningWaitPeriod`-Funktion vereinfachen (Zeile 53-92)
Die Funktion wird nicht mehr per `has_solar_gain` aufgerufen. Sie kann entweder komplett entfernt oder für einen allgemeinen Morgen-PV-Wait umgebaut werden (alle Räume gleich behandeln).

### 6. Bestehende Edge Functions
- `analyze-solar-gain`: Kann bestehen bleiben — die berechneten Werte (Wärmeverlustrate, Solargewinn-Faktor) sind nützlich für die KI/ML-Analyse, auch wenn sie die Heizentscheidung nicht mehr direkt beeinflussen.
- `monitor-solar-heating`: Kann bestehen bleiben als Monitoring/Datensammlung.

### Nicht betroffen
- `has_solar_gain` Spalte in der DB und im UI kann bestehen bleiben (informativ für Dashboard/KI)
- Raumausrichtung (`orientation`) bleibt erhalten
- Budget-Logik, Nachtmodus, PV-Boost — unverändert

