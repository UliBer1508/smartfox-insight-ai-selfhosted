-- Erweitere heating_settings für direkte elektrische Fußbodenheizung
ALTER TABLE heating_settings ADD COLUMN IF NOT EXISTS heating_type TEXT DEFAULT 'direct_electric';
ALTER TABLE heating_settings ADD COLUMN IF NOT EXISTS total_heating_power_w INTEGER;
ALTER TABLE heating_settings ADD COLUMN IF NOT EXISTS night_cycling_enabled BOOLEAN DEFAULT true;
ALTER TABLE heating_settings ADD COLUMN IF NOT EXISTS avg_night_cycles_per_room INTEGER DEFAULT 4;

-- Kommentar für Klarheit
COMMENT ON COLUMN heating_settings.heating_type IS 'Heizungstyp: direct_electric, heat_pump, water';
COMMENT ON COLUMN heating_settings.total_heating_power_w IS 'Gesamte installierte Heizleistung in Watt';
COMMENT ON COLUMN heating_settings.night_cycling_enabled IS 'Ob Thermostate nachts takten (An/Aus-Zyklen)';
COMMENT ON COLUMN heating_settings.avg_night_cycles_per_room IS 'Durchschnittliche Heizzyklen pro Raum pro Nacht';