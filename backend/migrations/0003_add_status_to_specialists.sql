-- 0003_add_status_to_specialists.sql
ALTER TABLE specialists ADD COLUMN status TEXT DEFAULT 'active';
