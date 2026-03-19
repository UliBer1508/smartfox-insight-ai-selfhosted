ALTER TABLE rooms DROP CONSTRAINT rooms_priority_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_priority_check CHECK (priority >= 1 AND priority <= 10);