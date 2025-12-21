-- Create update_updated_at_column function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create rooms table for storing room configurations
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  thermostat_type TEXT DEFAULT 'TGP508',
  orientation TEXT CHECK (orientation IN ('nord', 'süd', 'ost', 'west')),
  has_solar_gain BOOLEAN DEFAULT FALSE,
  floor_area_m2 NUMERIC,
  comfort_temp NUMERIC DEFAULT 21,
  eco_temp NUMERIC DEFAULT 19,
  night_temp NUMERIC DEFAULT 17,
  priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  heating_power_w NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create room_recommendations table for storing per-room recommendations
CREATE TABLE public.room_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  period_number INTEGER,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  recommended_temp NUMERIC NOT NULL,
  reason TEXT,
  priority TEXT CHECK (priority IN ('heat_now', 'preheat', 'hold', 'reduce', 'off')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_recommendations ENABLE ROW LEVEL SECURITY;

-- Create permissive policies (public access for this single-user app)
CREATE POLICY "Allow all operations on rooms" ON public.rooms
FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on room_recommendations" ON public.room_recommendations
FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for better query performance
CREATE INDEX idx_room_recommendations_room_id ON public.room_recommendations(room_id);
CREATE INDEX idx_room_recommendations_date ON public.room_recommendations(date);

-- Create trigger for updated_at on rooms
CREATE TRIGGER update_rooms_updated_at
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();