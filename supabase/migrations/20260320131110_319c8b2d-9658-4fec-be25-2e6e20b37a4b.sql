-- 1. Drop old check constraint (allows only 1-10)
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_priority_check;

-- 2. Fix duplicate priorities: assign unique values
UPDATE public.rooms SET priority = 10 WHERE id = 'b94f15d6-9a87-44b6-8cc1-878e628cfd18';
UPDATE public.rooms SET priority = 11 WHERE id = '333da323-5b4d-4032-ba54-1dc8e63f135c';
UPDATE public.rooms SET priority = 12 WHERE id = 'c2bbf1be-02b3-4a48-90d7-4d6cb5304cc8';

-- 3. Add new check constraint (1-12)
ALTER TABLE public.rooms ADD CONSTRAINT rooms_priority_check CHECK (priority >= 1 AND priority <= 12);

-- 4. Add unique constraint
ALTER TABLE public.rooms ADD CONSTRAINT rooms_priority_unique UNIQUE (priority);