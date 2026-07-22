-- 0005_add_patient_details.sql
ALTER TABLE patient ADD COLUMN birth_date TEXT;
ALTER TABLE patient ADD COLUMN gender TEXT;
