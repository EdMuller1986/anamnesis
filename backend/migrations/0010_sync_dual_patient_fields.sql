-- 0010: keep dual patient name/DOB columns in sync (one-shot backfill)
-- FE uses full_name / date_of_birth; legacy rows may only have name / birth_date.

UPDATE patient
SET full_name = name
WHERE (full_name IS NULL OR full_name = '')
  AND name IS NOT NULL
  AND name != '';

UPDATE patient
SET name = full_name
WHERE (name IS NULL OR name = '')
  AND full_name IS NOT NULL
  AND full_name != '';

UPDATE patient
SET date_of_birth = birth_date
WHERE (date_of_birth IS NULL OR date_of_birth = '')
  AND birth_date IS NOT NULL
  AND birth_date != '';

UPDATE patient
SET birth_date = date_of_birth
WHERE (birth_date IS NULL OR birth_date = '')
  AND date_of_birth IS NOT NULL
  AND date_of_birth != '';
