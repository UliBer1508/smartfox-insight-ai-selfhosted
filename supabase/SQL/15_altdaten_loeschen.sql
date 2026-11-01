-- 15_altdaten_loeschen.sql  (01.11.2026)
-- Lernschleife Stufe 1: heizungsbezogene Lerndaten vor dem 26.10.2026 löschen bzw. leeren
-- (Konzept: doc/KONZEPT-LERNSCHLEIFE-2026-11-01.md §3). Grund: Bis 24.10.2026 regelten die Thermostate nach
-- ihrem eigenen Wochenprogramm (Modus „auto“), „heizt“ war immer false, Heizzyklen fehlten bis 26.10.
-- Alles, was daraus gelernt oder berechnet wurde, verfälscht die Steuerung.
--
-- BLEIBT (stimmt): energy_readings, hourly_aggregates, PV-Prognosen + Treffsicherheit, weather_data,
--   Raumtemperaturen, daily_pattern_scores (PV-/Verbrauchsteil), Protokolle, Einstellungen.
-- GELÖSCHT / GELEERT: learning_events, room_ml_features, room_heating_logs vor dem 26.10.;
--   Heiz-Kennzahlen in daily_pattern_scores vor dem 26.10.; berechnete Raumwerte (Leistung, Wärmeverlust,
--   Solargewinn) – sie werden aus den sauberen Heizzyklen neu berechnet; bis dahin gilt heating_power_w.
--
-- SICHERUNG: Die Datenbank wird jede Nacht 03:45 ins OneDrive gesichert (doc/DATENSICHERUNG.md).
-- Vorher prüfen: OneDrive\Backups\Supabase-Heizung\LETZTE-SICHERUNG.txt ist von heute Nacht.
--
-- Ablauf: Schritt 1 allein ausführen und Zahlen ansehen. Dann Schritt 2 komplett ausführen.

-- =====================================================================================
-- Schritt 1: Vorschau – was wird gelöscht / geleert?
-- =====================================================================================
select 'learning_events' as tabelle, count(*) as zeilen from public.learning_events where timestamp < '2026-10-26'
union all select 'room_ml_features', count(*) from public.room_ml_features where date < '2026-10-26'
union all select 'room_heating_logs', count(*) from public.room_heating_logs where timestamp < '2026-10-26'
union all select 'daily_pattern_scores (Heizwerte leeren)', count(*) from public.daily_pattern_scores where date < '2026-10-26' and (heating_kwh is not null or kpi_pv_heating_coverage is not null)
union all select 'rooms (berechnete Werte leeren)', count(*) from public.rooms where calculated_power_w is not null or calculated_heat_loss_rate is not null or estimated_kwh_per_degree is not null;

-- Zum Vergleich: berechnete gegen eingetragene Leistung
select name, heating_power_w as eingetragen_w, calculated_power_w as berechnet_w, power_calculation_confidence as sicherheit
from public.rooms order by priority;

-- =====================================================================================
-- Schritt 2: Löschen (in einem Rutsch – entweder alles oder nichts)
-- =====================================================================================
begin;

delete from public.learning_events where timestamp < '2026-10-26';
delete from public.room_ml_features where date < '2026-10-26';
delete from public.room_heating_logs where timestamp < '2026-10-26';

update public.daily_pattern_scores
   set heating_kwh = null, kpi_pv_heating_coverage = null
 where date < '2026-10-26';

update public.rooms set
  calculated_power_w = null,
  power_calculation_confidence = null,
  power_samples = null,
  last_power_calculation = null,
  calculated_heat_loss_rate = null,
  estimated_kwh_per_degree = null,
  calculated_solar_gain_factor = null,
  solar_gain_confidence = null,
  solar_gain_samples = null,
  avg_heating_cycles_per_day = null;

delete from public.learned_policies;

select public.protokoll_add('einstellung', null, 'Altdaten vor dem 26.10.2026 gelöscht',
  'Lernschleife Stufe 1: learning_events, room_ml_features, room_heating_logs, Heiz-Kennzahlen im Mustergedächtnis, berechnete Raumwerte', null);

commit;

-- Kontrolle: muss überall 0 zeigen
select 'learning_events' as tabelle, count(*) as rest from public.learning_events where timestamp < '2026-10-26'
union all select 'room_ml_features', count(*) from public.room_ml_features where date < '2026-10-26'
union all select 'room_heating_logs', count(*) from public.room_heating_logs where timestamp < '2026-10-26'
union all select 'rooms mit berechneter Leistung', count(*) from public.rooms where calculated_power_w is not null;
