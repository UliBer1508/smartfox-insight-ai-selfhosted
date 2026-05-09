ALTER TABLE public.thermostat_commands
ADD COLUMN IF NOT EXISTS value_text text;

COMMENT ON COLUMN public.thermostat_commands.value_text IS
  'String-Wert für nicht-numerische Befehle wie set_mode (manual/auto). Bei numerischen Befehlen (set_temperature) wird value verwendet.';