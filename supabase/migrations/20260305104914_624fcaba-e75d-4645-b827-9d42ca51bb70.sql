
-- PV-Boost: Raumspezifische Max-Temperatur und globaler Boost-Delta
ALTER TABLE rooms ADD COLUMN pv_boost_max_temp numeric DEFAULT NULL;
ALTER TABLE heating_settings ADD COLUMN pv_boost_temp_delta numeric DEFAULT 2;
