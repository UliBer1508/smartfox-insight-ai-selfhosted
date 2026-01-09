-- Tabelle fuer taegliche Energiekosten
CREATE TABLE public.energy_daily_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  energy_in_kwh numeric NOT NULL DEFAULT 0,
  energy_out_kwh numeric NOT NULL DEFAULT 0,
  pv_energy_kwh numeric NOT NULL DEFAULT 0,
  self_consumption_kwh numeric NOT NULL DEFAULT 0,
  grid_cost_eur numeric NOT NULL DEFAULT 0,
  feed_in_earnings_eur numeric NOT NULL DEFAULT 0,
  pv_savings_eur numeric NOT NULL DEFAULT 0,
  net_balance_eur numeric NOT NULL DEFAULT 0,
  electricity_price_cent numeric NOT NULL DEFAULT 20.28,
  feed_in_price_cent numeric NOT NULL DEFAULT 8.00,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.energy_daily_costs ENABLE ROW LEVEL SECURITY;

-- Oeffentlicher Zugriff (da keine User-spezifischen Daten)
CREATE POLICY "Allow all operations on energy_daily_costs" 
ON public.energy_daily_costs 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Trigger fuer updated_at
CREATE TRIGGER update_energy_daily_costs_updated_at
BEFORE UPDATE ON public.energy_daily_costs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();