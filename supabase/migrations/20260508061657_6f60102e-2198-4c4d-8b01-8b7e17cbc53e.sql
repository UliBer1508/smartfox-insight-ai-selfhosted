CREATE POLICY "Anon collector can read rooms"
ON public.rooms
FOR SELECT
TO anon
USING (true);