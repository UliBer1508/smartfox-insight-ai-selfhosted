---
name: Parameter-Usage-Audit C
description: Welche UI-Settings real wirken (PV-Hysterese, consumer_priority, Pre-Heat, Grundgebühr) nach Plan C
type: feature
---

Nach Plan C (Mischform) wirken folgende UI-Parameter aktiv:

- **`consumer_priority`**: In `pv-automation` werden anhand der Reihenfolge `hotwater` und `car` als Reserve vom Eco-Budget abgezogen, wenn sie vor `heating` stehen. Wenn `heating` vor `battery` steht, entfällt die Batterie-Ladereserve.
- **`car_min_charge_power_w`**: Reserve für Auto-Ladung wenn `car_charging_enabled = true` UND car vor heating priorisiert.
- **`hotwater_power_w` + `hotwater_schedule_*`**: Reserve aktiv im Zeitfenster wenn hotwater vor heating priorisiert.
- **`pv_surplus_threshold_on/off`**: Echte Hysterese in Phase 1 — neue Eco-Aktivierungen erst ab `gridExport >= threshold_on`.
- **`floor_heating_response_hours`**: Erlaubt Eco-Vorlauf bis max. 3h vor 09:00 (Untergrenze 06:00 Wien).
- **`electricity_base_fee_year_eur`**: Anteilig (1/365) zur täglichen `gridCost` in `useEnergyCosts` addiert; Anzeige im `EnergyCostWidget`.

Entfernte UI-Felder (DB-Spalten bleiben): `pv_boost_max_temp` (Room), `night_cycling_enabled`, `avg_night_cycles_per_room`, `estrich_storage_enabled`. Begründung: keine Code-Konsumenten oder durch andere Mechanismen abgedeckt.
