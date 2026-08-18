-- 0012: Keep dual patient name/DOB columns in sync ongoing (fill empty only — no recursion).
-- API writes both fields; these triggers catch partial inserts/updates and legacy tools.

-- INSERT: fill missing duals from the other column
DROP TRIGGER IF EXISTS patient_ai_sync_full_name;
CREATE TRIGGER patient_ai_sync_full_name AFTER INSERT ON patient
WHEN (new.full_name IS NULL OR new.full_name = '')
  AND new.name IS NOT NULL AND new.name != ''
BEGIN
  UPDATE patient SET full_name = new.name WHERE id = new.id;
END;

DROP TRIGGER IF EXISTS patient_ai_sync_name;
CREATE TRIGGER patient_ai_sync_name AFTER INSERT ON patient
WHEN (new.name IS NULL OR new.name = '')
  AND new.full_name IS NOT NULL AND new.full_name != ''
BEGIN
  UPDATE patient SET name = new.full_name WHERE id = new.id;
END;

DROP TRIGGER IF EXISTS patient_ai_sync_dob;
CREATE TRIGGER patient_ai_sync_dob AFTER INSERT ON patient
WHEN (new.date_of_birth IS NULL OR new.date_of_birth = '')
  AND new.birth_date IS NOT NULL AND new.birth_date != ''
BEGIN
  UPDATE patient SET date_of_birth = new.birth_date WHERE id = new.id;
END;

DROP TRIGGER IF EXISTS patient_ai_sync_birth_date;
CREATE TRIGGER patient_ai_sync_birth_date AFTER INSERT ON patient
WHEN (new.birth_date IS NULL OR new.birth_date = '')
  AND new.date_of_birth IS NOT NULL AND new.date_of_birth != ''
BEGIN
  UPDATE patient SET birth_date = new.date_of_birth WHERE id = new.id;
END;

-- UPDATE: only fill empty dual (avoids infinite recursion)
DROP TRIGGER IF EXISTS patient_au_sync_full_name;
CREATE TRIGGER patient_au_sync_full_name AFTER UPDATE OF name ON patient
WHEN (new.full_name IS NULL OR new.full_name = '')
  AND new.name IS NOT NULL AND new.name != ''
BEGIN
  UPDATE patient SET full_name = new.name WHERE id = new.id;
END;

DROP TRIGGER IF EXISTS patient_au_sync_name;
CREATE TRIGGER patient_au_sync_name AFTER UPDATE OF full_name ON patient
WHEN (new.name IS NULL OR new.name = '')
  AND new.full_name IS NOT NULL AND new.full_name != ''
BEGIN
  UPDATE patient SET name = new.full_name WHERE id = new.id;
END;

DROP TRIGGER IF EXISTS patient_au_sync_dob;
CREATE TRIGGER patient_au_sync_dob AFTER UPDATE OF birth_date ON patient
WHEN (new.date_of_birth IS NULL OR new.date_of_birth = '')
  AND new.birth_date IS NOT NULL AND new.birth_date != ''
BEGIN
  UPDATE patient SET date_of_birth = new.birth_date WHERE id = new.id;
END;

DROP TRIGGER IF EXISTS patient_au_sync_birth_date;
CREATE TRIGGER patient_au_sync_birth_date AFTER UPDATE OF date_of_birth ON patient
WHEN (new.birth_date IS NULL OR new.birth_date = '')
  AND new.date_of_birth IS NOT NULL AND new.date_of_birth != ''
BEGIN
  UPDATE patient SET birth_date = new.date_of_birth WHERE id = new.id;
END;
