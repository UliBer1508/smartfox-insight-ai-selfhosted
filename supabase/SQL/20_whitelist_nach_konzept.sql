-- 20_whitelist_nach_konzept.sql  (04.11.2026)
-- Konzept doc/KONZEPT-KI-VORSCHLAEGE-2026-11-02.md §3 + §7 (freigegeben 02.11.2026):
-- Die KI darf nur noch die dort genannten Werte vorschlagen. Alles andere wird für Vorschläge abgeschaltet
-- (enabled = false). Alte Einträge in ai_parameter_decisions bleiben als Protokoll erhalten.
-- Folge: Vorschläge erscheinen in KI › Zu entscheiden (Stufe „suggest“), nicht mehr unsichtbar als „shadow“.
-- Wiederholbar. Im Supabase SQL-Editor ausführen. Kein Deploy nötig.

-- 1) Nicht vorschlagsfähig (Ulis Wunschwerte, feste Regeln oder nicht im Konzept)
update public.ai_parameter_whitelist
set enabled = false, updated_at = now(),
    notes = coalesce(notes, '') || ' [04.11.2026: abgeschaltet – nicht vorschlagsfähig laut Konzept KI-Vorschläge §3]'
where parameter_key in (
  'comfort_temp', 'eco_temp',                         -- Ulis Wunschwerte, KI darf nur kommentieren
  'night_heating_mode', 'night_start_time',           -- Nachtregel ist fest
  'pv_surplus_threshold_on', 'pv_surplus_threshold_off', -- Ein-/Aus-Schwelle gesperrt
  'comfort_override_forecast_min_kwh', 'comfort_override_grid_export_min',
  'comfort_override_soc_min', 'comfort_saturation_override_enabled',
  'pattern_recall_strength',
  'parallel_heating_capacity'                         -- kein Grenzwert, sondern Heizplan der pv-automation
)
and enabled = true;

-- 2) Bleibt, jetzt als Vorschlag
update public.ai_parameter_whitelist
set autonomy_level = 'suggest', min_value = 19, max_value = 26, updated_at = now()
where parameter_key = 'pv_boost_max_temp';            -- Estrich laden bis (Komfort … Komfort + 2)

-- heating_min_battery_soc: läuft weiter nur über die KI-Batterie-Empfehlung (eigene Karte), Grenzen laut Konzept
update public.ai_parameter_whitelist
set min_value = 40, max_value = 90, updated_at = now()
where parameter_key = 'heating_min_battery_soc';

-- 3) Neu vorschlagsfähig
insert into public.ai_parameter_whitelist
  (parameter_key, scope, storage_table, storage_column, data_type, min_value, max_value, autonomy_level, enabled, description)
select 'max_grid_heating_power_w', 'global', 'heating_settings', 'max_grid_heating_power_w', 'integer', 1000, 6000, 'suggest', true,
       'Heizleistung ohne PV: wie viel Watt an Tagen ohne genug PV gleichzeitig aus Batterie/Netz geheizt werden'
where not exists (select 1 from public.ai_parameter_whitelist where parameter_key = 'max_grid_heating_power_w');

insert into public.ai_parameter_whitelist
  (parameter_key, scope, storage_table, storage_column, data_type, min_value, max_value, autonomy_level, enabled, description)
select 'wait_min_temp', 'room', 'rooms', 'wait_min_temp', 'number', 16, 24, 'suggest', true,
       'Untergrenze je Raum (bis Sonne). Laut Konzept nur Eco − 2 … Eco des Raums vorschlagen'
where not exists (select 1 from public.ai_parameter_whitelist where parameter_key = 'wait_min_temp');

-- Kontrolle: aktiv dürfen nur noch max_grid_heating_power_w, wait_min_temp, pv_boost_max_temp, heating_min_battery_soc sein
select parameter_key, scope, autonomy_level, enabled, min_value, max_value
from public.ai_parameter_whitelist
order by enabled desc, parameter_key;
