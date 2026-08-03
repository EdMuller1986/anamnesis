-- 0002_fix_missing_columns.sql
-- Safe ADD COLUMN only: SQLite/D1 rejects non-constant DEFAULT expressions on ADD COLUMN
-- for populated tables (e.g. DEFAULT (datetime('now'))).

-- notes required by FTS triggers created in 0001
ALTER TABLE timeline ADD COLUMN notes TEXT;
ALTER TABLE documents ADD COLUMN notes TEXT;

-- updated_at: nullable, no expression default (app sets on write)
ALTER TABLE timeline ADD COLUMN updated_at TEXT;
ALTER TABLE documents ADD COLUMN updated_at TEXT;
ALTER TABLE diagnoses ADD COLUMN updated_at TEXT;
ALTER TABLE medications ADD COLUMN updated_at TEXT;
ALTER TABLE specialists ADD COLUMN updated_at TEXT;
ALTER TABLE lab_results ADD COLUMN updated_at TEXT;
ALTER TABLE plan ADD COLUMN updated_at TEXT;
ALTER TABLE medical_errors ADD COLUMN updated_at TEXT;
ALTER TABLE growth_log ADD COLUMN updated_at TEXT;
ALTER TABLE comments ADD COLUMN updated_at TEXT;
ALTER TABLE reminders ADD COLUMN updated_at TEXT;
