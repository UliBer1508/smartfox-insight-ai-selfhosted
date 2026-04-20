

## Befund

Heizung läuft bei `gridExport = 0W`, weil zwei Mechanismen das Eco-Budget künstlich aufblasen, **bevor** echter Überschuss vorliegt:

1. **Prognose-Mindest-Budget (Zeile 1187–1195):** Setzt `baseBudget = StundenForecast – Grundlast = 4446W`, wenn die Tagesprognose den Eco-Bedarf deckt — unabhängig vom aktuellen Export. Das ist der Hauptverursacher: Heizung darf laufen "weil heute genug PV kommt", obwohl gerade Netz bezogen wird.
2. **Prognose-Bonus (Zeile 1229–1243):** Addiert nochmal +1500W oben drauf (Ratio 68× im aktuellen Log).
3. **Batterie-Ladereserve-Gate (Zeile 1198):** Greift erst bei `batterySoc < heatingMinSoc (80)` UND `batteryPower > 0`. Bei SOC 59% + Ladung sollte die Reserve voll abgezogen werden — wird sie auch (400W), reicht aber nicht gegen +4446W Prognose-Budget.

Aktuelles Log bestätigt: `gridExport 0W + heizend 0W + Toleranz 200W = 5603W` — die 5403W kommen **rein aus Prognose**, nicht aus realem Überschuss.

## Lösung: "Echter Überschuss zuerst"-Regel

Eco-Budget darf den **realen aktuellen Überschuss** nur überschreiten, wenn die Batterie **über `heating_min_battery_soc` liegt UND nicht aus dem Netz bezogen wird**.

### Konkrete Änderungen in `supabase/functions/pv-automation/index.ts`

**1. Hard-Gate für Prognose-Mindest-Budget (Z. 1189):** Zusätzliche Bedingung:
```
&& batterySoc >= heatingMinSoc        // SOC über Schutz
&& reading.power_io <= 50             // kein Netzbezug (Toleranz ±50W)
```
→ Ohne echten Überschuss greift die Stunden-Prognose nicht mehr.

**2. Hard-Gate für Prognose-Bonus (Z. 1230):** Gleiche zwei Zusatzbedingungen.
→ +1500W Bonus nur wenn Batterie wirklich über Schutzschwelle UND kein Grid-Import.

**3. Batterie-Puffer (Z. 1249):** Bereits korrekt an `socAboveReserve > 20` gebunden — bleibt wie er ist, wirkt erst ab SOC 80%+ (Reserve 60% + 20).

**4. Logging-Marker `[OVERSHOOT-GATE]`** wenn Prognose-Budget gesperrt wird, mit echtem `power_io` und SOC.

### Erwartetes Verhalten

- **Jetzt (gridExport 0W, SOC 59%, Batterie lädt 400W):** baseBudget = `0 + 0 + 200 = 200W`, kein Prognose-Bonus, kein Mindest-Budget → **keine Heiz-Aktivierung**. Laufende Räume werden im nächsten Tick gestoppt (Budget < Raumleistung).
- **Später bei SOC 85%, gridExport 1500W:** Prognose-Budget greift wieder, alles wie heute.
- **Sonniger Vormittag, SOC 80%, gridExport 800W:** Mindest-Budget aus Stundenforecast wirkt, Heizung läuft optimal.

### Was unverändert bleibt

- 09:00-Startzeit-Logik (bereits korrekt: `currentWienHour >= 9`)
- Hard SOC-Gate (strict/soft) aus letztem Plan
- Komfort-Budget (war schon strikt)
- Tolerante Deaktivierung, Mikro-Budget, Phasen-Strategie, Tuya-Quota
- UI/Settings — keine neue Option nötig (nutzt vorhandenes `heating_min_battery_soc`)

### Aktualisierung Memory

`mem://arch/pv-automation-budget-logic-v2`: Prognose-Mindest-Budget und Prognose-Bonus benötigen jetzt zusätzlich `SOC ≥ heatingMinSoc` UND `power_io ≤ +50W`.

