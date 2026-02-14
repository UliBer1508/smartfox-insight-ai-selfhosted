CREATE INDEX IF NOT EXISTS idx_learning_events_room_evaluated 
ON learning_events (room_id, is_evaluated) 
WHERE is_evaluated = true AND reward IS NOT NULL;