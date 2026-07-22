-- 0006_expand_patient_table.sql

-- Добавляем все недостающие поля согласно типам фронтенда
ALTER TABLE patient ADD COLUMN full_name TEXT;
ALTER TABLE patient ADD COLUMN date_of_birth TEXT;
ALTER TABLE patient ADD COLUMN city TEXT;
ALTER TABLE patient ADD COLUMN allergies TEXT;
ALTER TABLE patient ADD COLUMN current_height_cm REAL;
ALTER TABLE patient ADD COLUMN current_weight_kg REAL;
ALTER TABLE patient ADD COLUMN birth_weight_g INTEGER;
ALTER TABLE patient ADD COLUMN notes TEXT;
ALTER TABLE patient ADD COLUMN updated_at TEXT;

-- Мигрируем данные из старых колонок в новые и проставляем время
UPDATE patient 
SET full_name = name, 
    date_of_birth = birth_date,
    updated_at = datetime('now');
