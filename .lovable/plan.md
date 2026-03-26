

# Security Fix: Sensible Geräte-Daten in `rooms` vor anonymem Zugriff schützen

## Problem

Die anonyme SELECT-Policy auf `rooms` (`USING (true)`) gibt **alle Spalten** frei – inklusive `local_key` (Tuya-Verschlüsselungsschlüssel), `tuya_device_id`, `thermostat_ip` und `thermostat_local_ip`. Jeder mit dem öffentlichen Anon-Key kann diese Daten abfragen und damit Thermostate direkt übernehmen.

## Lösung: View für den Collector

Der lokale Collector braucht die sensiblen Felder nicht über die Datenbank – er hat die Device-IDs und Keys in seiner lokalen `config.json`. Er braucht nur: Status-Felder (`current_temp`, `target_temp`, `is_heating`, etc.) und Raum-Metadaten (`id`, `name`, `priority`, etc.).

### Schritt 1: Datenbank-Migration

1. **View `rooms_collector` erstellen** – enthält alle Spalten **außer** `local_key`, `thermostat_ip`, `thermostat_local_ip`, `thermostat_local_ip`
2. **Bestehende anonyme SELECT-Policy auf `rooms` entfernen** (`Anon collector can read rooms`)
3. **Neue anonyme SELECT-Policy auf der View** ist nicht nötig – Views erben keine RLS. Stattdessen: Die anonyme UPDATE-Policy auf `rooms` bleibt (Collector muss `current_temp`/`is_heating` schreiben), und für SELECT nutzt der Collector die View.

Allerdings: Supabase Views mit anon-Zugriff erfordern entweder `SECURITY DEFINER` oder eigene Grants. Der einfachere Ansatz:

**Besserer Ansatz: Policy mit Column-Filter gibt es in Postgres nicht.** Stattdessen:

1. **Anonyme SELECT-Policy entfernen** auf `rooms`
2. **Neue eingeschränkte View `rooms_public`** erstellen (ohne sensible Spalten), mit `GRANT SELECT ON rooms_public TO anon`
3. Die anonyme UPDATE-Policy auf `rooms` bleibt (nur für Collector-Schreibzugriff)

### Schritt 2: Collector-Code anpassen (optional)

Der Node-Collector (Zeile 30) nutzt bevorzugt `service_role_key` – wenn dieser konfiguriert ist, umgeht er RLS komplett und braucht keine anonyme Policy. Die View ist nur als Fallback relevant, falls der Collector mit `anon_key` läuft.

Da der Collector aktuell nur **schreibt** auf `rooms` (UPDATE) und **liest** von `thermostat_commands` (mit Join auf `rooms`), und die Tuya-Daten aus der lokalen Config kommen, ist der SELECT auf `rooms` nur für den Join in `thermostat_commands` relevant.

## Konkrete Änderungen

### Migration (1 Datei)

```sql
-- 1. View ohne sensible Spalten
CREATE VIEW rooms_public AS
SELECT id, name, has_solar_gain, floor_area_m2, comfort_temp, eco_temp, 
       night_temp, priority, heating_power_w, created_at, updated_at,
       current_temp, target_temp, is_heating, pv_auto_enabled, 
       last_thermostat_sync, pv_auto_active, pv_auto_last_change,
       estimated_kwh_per_degree, last_heating_duration_min, 
       avg_heating_cycles_per_day, automation_enabled, last_auto_change,
       calculated_power_w, power_calculation_confidence, power_samples,
       last_power_calculation, calculated_solar_gain_factor, 
       solar_gain_confidence, solar_gain_samples, calculated_heat_loss_rate,
       last_solar_analysis, manual_override_until, solar_limit_temp,
       solar_heating_temp, last_heating_start, last_heating_end,
       pv_boost_max_temp, heating_paused_reason, thermostat_type, orientation
FROM rooms;

-- 2. Anon darf die View lesen
GRANT SELECT ON rooms_public TO anon;

-- 3. Sensible SELECT-Policy entfernen
DROP POLICY IF EXISTS "Anon collector can read rooms" ON rooms;
```

Die bestehende anonyme UPDATE-Policy auf `rooms` bleibt bestehen (Collector muss Temperatur-Werte schreiben).

### Kein Code-Änderung nötig

- Der Frontend-Code läuft als `authenticated` und hat weiterhin vollen Zugriff auf `rooms` inkl. aller Spalten
- Der Collector nutzt bevorzugt `service_role_key` und umgeht RLS
- Falls der Collector mit `anon_key` läuft: Er **schreibt** nur auf `rooms` (UPDATE-Policy bleibt) und die Device-IDs kommen aus der lokalen Config

