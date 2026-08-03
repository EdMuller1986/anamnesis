-- 0007: app_versions.patient_id used by admin import saveVersion()
ALTER TABLE app_versions ADD COLUMN patient_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_app_versions_patient ON app_versions(patient_id);
