## „Warmwasser-Bereitung" + „Verbraucher-Priorität" aus UI entfernen

### Befund

Beide Blöcke in `HeatingSettingsForm.tsx` steuern faktisch **nichts**, was Smartfox nicht ohnehin autonom regelt:

**Warmwasser-Block (Zeilen 479–549):** `hotwater_enabled`, `hotwater_power_w`, `hotwater_schedule_start/_end`, `hotwater_min_surplus_w`. UI sagt selbst „dient nur der Tagesenergie-Prognose, beeinflusst Momentan-Heizbudget nicht".

**Verbraucher-Priorität (Zeilen 551–589):** `consumer_priority`, `car_min_charge_power_w`. Smartfox priorisiert physisch.

**Aktuelle Code-Verwendung in `pv-automation`:**
- Z. 1279–1283: `hotwaterKwh` (~11 kWh hartcodiert über 4 h) und `carKwh` (10 kWh wenn aktiv) werden vom **Tagesbudget** abgezogen → **verfälscht** das Heizbudget systematisch, obwohl der WW-/Auto-Verbrauch physikalisch bereits im `power_io` enthalten ist (Doppelzählung).
- Z. 1479–1502: `consumer_priority`/`hotwater_schedule`/`car_min_charge_power_w` ziehen zusätzlich „Reserve" vor der Heizung ab.
- Z. 2582: `hotwaterPower`-Lookup für Logging.

`analyze-patterns` (KI-Analyse) liest die Werte ebenfalls — bleibt unverändert für jetzt (separater Tagesplaner-Kontext).

### Lösung

**1. UI-Blöcke entfernen** in `src/components/heating/HeatingSettingsForm.tsx`:
- Block „Warmwasser-Bereitung (Smartfox-gesteuert)" (Zeilen 479–549)
- Block „Verbraucher-Priorität" (Zeilen 551–589)
- Ungenutzte Imports prüfen (`Droplets`, `Car`).

**2. Budget-Berechnung in `pv-automation/index.ts` säubern** (Doppelzählung beseitigen):
- Z. 1279–1283: `hotwaterKwh` und `carKwh` auf `0` setzen bzw. komplett aus Formel entfernen → `availableHeatingKwh = max(0, expectedPvKwh - batteryNeedKwh)`.
- Log-Zeile 1406 entsprechend kürzen.
- Z. 1479–1502 (Consumer-Priority-Reserve): entfernen — Smartfox-Verbrauch ist physisch in `gridExport`/`power_io` enthalten, keine zusätzliche Reserve nötig.

**3. DB-Felder & Types bleiben** (Backwards-Compat, kein Migrations-Risiko). `analyze-patterns` nutzt sie weiter mit Defaults, falls in DB gesetzt.

### Geänderte Dateien

- `src/components/heating/HeatingSettingsForm.tsx` — zwei Blöcke + ungenutzte Icons entfernen.
- `supabase/functions/pv-automation/index.ts` — Budget-Doppelzählung beseitigen (~30 Zeilen).

### Nicht geändert

- DB-Schema, Types, `analyze-patterns`, `LearningProgress`.
- `system_settings`, sonstige Heating-Konfiguration.

### Verifikation

- Settings-Seite: keine Warmwasser/Verbraucher-Priorität-Sektionen mehr.
- `pv-automation`-Logs: `availableHeatingKwh = expectedPvKwh − batteryNeedKwh` (kein WW-/Auto-Abzug).
- Heizbudget steigt entsprechend; tatsächlicher Smartfox-Verbrauch reduziert weiterhin `gridExport` physisch.
