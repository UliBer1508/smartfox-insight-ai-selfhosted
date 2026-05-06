## Ziel
Toten Code in `local-collector/collector.py` entfernen: Die `pv_energy`-Berechnung wird nirgends gespeichert (keine Spalte in `energy_readings`) und nirgends im Frontend gelesen.

## Änderung in `local-collector/collector.py`

In `fetch_smartfox()` (Zeilen ~54–70):
- Entfernen: die zwei Zeilen, die `PvEnergy` aus dem Smartfox-Response lesen und summieren.
- Entfernen: das `pv_energy`-Feld aus dem Return-Dict.

Alle anderen Felder (`power_io`, `energy_in`, `energy_out`, `pv_power`, `consumption`, `power_smartfox`, `relay_status`) bleiben unverändert.

## Nicht geändert
- `save_reading()` — nutzt `pv_energy` ohnehin nicht.
- Sonstige Logik, Logging, Backoff-Verhalten.
