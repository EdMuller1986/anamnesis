-- 0008: columns expected by frontend types / UI (nullable, safe ADD)

-- Diagnoses
ALTER TABLE diagnoses ADD COLUMN diagnosed_date TEXT;
ALTER TABLE diagnoses ADD COLUMN source TEXT;
ALTER TABLE diagnoses ADD COLUMN notes TEXT;

-- Medications
ALTER TABLE medications ADD COLUMN prescribed_by TEXT;
ALTER TABLE medications ADD COLUMN start_date TEXT;
ALTER TABLE medications ADD COLUMN end_date TEXT;
ALTER TABLE medications ADD COLUMN notes TEXT;

-- Specialists
ALTER TABLE specialists ADD COLUMN phone TEXT;
ALTER TABLE specialists ADD COLUMN email TEXT;

-- Documents
ALTER TABLE documents ADD COLUMN original_name TEXT;
ALTER TABLE documents ADD COLUMN file_size INTEGER;
ALTER TABLE documents ADD COLUMN description TEXT;

-- Timeline
ALTER TABLE timeline ADD COLUMN severity TEXT;
ALTER TABLE timeline ADD COLUMN badge_text TEXT;
ALTER TABLE timeline ADD COLUMN badge_color TEXT;

-- Plan
ALTER TABLE plan ADD COLUMN description TEXT;
ALTER TABLE plan ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE plan ADD COLUMN notes TEXT;

-- Medical errors
ALTER TABLE medical_errors ADD COLUMN description TEXT;
ALTER TABLE medical_errors ADD COLUMN error_date TEXT;
ALTER TABLE medical_errors ADD COLUMN action_text TEXT;
ALTER TABLE medical_errors ADD COLUMN specialist_id INTEGER;
ALTER TABLE medical_errors ADD COLUMN notes TEXT;

-- Reminders
ALTER TABLE reminders ADD COLUMN message TEXT;
ALTER TABLE reminders ADD COLUMN recurring TEXT;
ALTER TABLE reminders ADD COLUMN repeat_cron TEXT;
ALTER TABLE reminders ADD COLUMN sent_at TEXT;
ALTER TABLE reminders ADD COLUMN notes TEXT;
ALTER TABLE reminders ADD COLUMN updated_at TEXT;

-- Patient extras (upstream parity, optional)
ALTER TABLE patient ADD COLUMN blood_type TEXT;
ALTER TABLE patient ADD COLUMN birth_height_cm REAL;
ALTER TABLE patient ADD COLUMN apgar TEXT;
ALTER TABLE patient ADD COLUMN birth_notes TEXT;
