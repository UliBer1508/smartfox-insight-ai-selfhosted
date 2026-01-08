-- Strompreis-Konfiguration zur heating_settings Tabelle hinzufügen
ALTER TABLE heating_settings ADD COLUMN IF NOT EXISTS 
  electricity_price_kwh_cent DECIMAL(6,2) DEFAULT 20.28;

ALTER TABLE heating_settings ADD COLUMN IF NOT EXISTS 
  electricity_base_fee_year_eur DECIMAL(6,2) DEFAULT 36.00;

ALTER TABLE heating_settings ADD COLUMN IF NOT EXISTS 
  feed_in_price_kwh_cent DECIMAL(6,2) DEFAULT 8.00;