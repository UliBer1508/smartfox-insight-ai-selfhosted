-- Erstelle UNIQUE CONSTRAINT für room_recommendations UPSERT
-- Erlaubt: nur eine Empfehlung pro Raum+Datum+Periode

-- Prüfe ob Constraint bereits existiert, falls nicht erstellen
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'room_recommendations_room_date_period_unique'
  ) THEN
    ALTER TABLE public.room_recommendations 
    ADD CONSTRAINT room_recommendations_room_date_period_unique 
    UNIQUE (room_id, date, period_number);
  END IF;
END $$;