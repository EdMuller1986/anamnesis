-- 0002_fix_missing_columns.sql

-- Добавляем пропущенные колонки notes, которые требуются для FTS5 и триггеров
ALTER TABLE timeline ADD COLUMN notes TEXT;
ALTER TABLE documents ADD COLUMN notes TEXT;

-- Также на всякий случай добавим updated_at, если он где-то используется в логике "since-last-review"
-- Но в SQLite нельзя добавить COLUMN с DEFAULT datetime('now') через ALTER TABLE легко, 
-- поэтому просто добавим колонки.
ALTER TABLE timeline ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE documents ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE diagnoses ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE medications ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE specialists ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE lab_results ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE plan ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE medical_errors ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE growth_log ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE comments ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE reminders ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
