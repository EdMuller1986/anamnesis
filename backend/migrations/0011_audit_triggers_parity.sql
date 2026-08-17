-- 0011: Full audit trigger parity with upstream (legacy db.js v3.7)
-- 0001 only created timeline triggers; 0004 added a partial set (mostly INSERT).
-- This migration DROP+CREATE full INSERT/UPDATE/DELETE for all medical tables.

-- TIMELINE ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_timeline_ai;
CREATE TRIGGER audit_timeline_ai AFTER INSERT ON timeline BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('timeline', new.id, 'insert',
    json_object('title', new.title, 'event_date', new.event_date, 'specialist_name', new.specialist_name, 'category', new.category),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_timeline_au;
CREATE TRIGGER audit_timeline_au AFTER UPDATE ON timeline BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('timeline', new.id, 'update',
    json_object(
      'title', old.title,
      'description', substr(COALESCE(old.description,''),1,200),
      'ai_assessment', CASE WHEN old.ai_assessment IS NULL THEN NULL ELSE substr(old.ai_assessment,1,80) END,
      'transcription_len', CASE WHEN old.transcription IS NULL THEN 0 ELSE length(old.transcription) END,
      'specialist_id', old.specialist_id),
    json_object(
      'title', new.title,
      'description', substr(COALESCE(new.description,''),1,200),
      'ai_assessment', CASE WHEN new.ai_assessment IS NULL THEN NULL ELSE substr(new.ai_assessment,1,80) END,
      'transcription_len', CASE WHEN new.transcription IS NULL THEN 0 ELSE length(new.transcription) END,
      'specialist_id', new.specialist_id),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_timeline_ad;
CREATE TRIGGER audit_timeline_ad AFTER DELETE ON timeline BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('timeline', old.id, 'delete', json_object('title', old.title, 'event_date', old.event_date), old.patient_id);
END;

-- DOCUMENTS ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_documents_ai;
CREATE TRIGGER audit_documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('document', new.id, 'insert',
    json_object('title', new.title, 'timeline_id', new.timeline_id, 'mime_type', new.mime_type, 'category', new.category, 'source_doctor', new.source_doctor),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_documents_au;
CREATE TRIGGER audit_documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('document', new.id, 'update',
    json_object('title', old.title, 'timeline_id', old.timeline_id, 'quality', old.quality,
                'ai_assessment', CASE WHEN old.ai_assessment IS NULL THEN NULL ELSE substr(old.ai_assessment,1,60) END,
                'transcription_len', CASE WHEN old.transcription IS NULL THEN 0 ELSE length(old.transcription) END),
    json_object('title', new.title, 'timeline_id', new.timeline_id, 'quality', new.quality,
                'ai_assessment', CASE WHEN new.ai_assessment IS NULL THEN NULL ELSE substr(new.ai_assessment,1,60) END,
                'transcription_len', CASE WHEN new.transcription IS NULL THEN 0 ELSE length(new.transcription) END),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_documents_ad;
CREATE TRIGGER audit_documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('document', old.id, 'delete', json_object('title', old.title, 'file_path', old.file_path, 'timeline_id', old.timeline_id), old.patient_id);
END;

-- DIAGNOSES ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_diagnoses_ai;
CREATE TRIGGER audit_diagnoses_ai AFTER INSERT ON diagnoses BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('diagnosis', new.id, 'insert', json_object('name', new.name, 'icd_code', new.icd_code, 'status', new.status), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_diagnoses_au;
CREATE TRIGGER audit_diagnoses_au AFTER UPDATE ON diagnoses BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('diagnosis', new.id, 'update',
    json_object('name', old.name, 'status', old.status,
                'ai_assessment', CASE WHEN old.ai_assessment IS NULL THEN NULL ELSE substr(old.ai_assessment,1,60) END,
                'detail_len', CASE WHEN old.detail IS NULL THEN 0 ELSE length(old.detail) END),
    json_object('name', new.name, 'status', new.status,
                'ai_assessment', CASE WHEN new.ai_assessment IS NULL THEN NULL ELSE substr(new.ai_assessment,1,60) END,
                'detail_len', CASE WHEN new.detail IS NULL THEN 0 ELSE length(new.detail) END),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_diagnoses_ad;
CREATE TRIGGER audit_diagnoses_ad AFTER DELETE ON diagnoses BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('diagnosis', old.id, 'delete', json_object('name', old.name), old.patient_id);
END;

-- MEDICATIONS ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_medications_ai;
CREATE TRIGGER audit_medications_ai AFTER INSERT ON medications BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('medication', new.id, 'insert', json_object('name', new.name, 'inn', new.inn, 'status', new.status), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_medications_au;
CREATE TRIGGER audit_medications_au AFTER UPDATE ON medications BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('medication', new.id, 'update',
    json_object('name', old.name, 'status', old.status, 'stop_reason', old.stop_reason,
                'ai_assessment', CASE WHEN old.ai_assessment IS NULL THEN NULL ELSE substr(old.ai_assessment,1,60) END),
    json_object('name', new.name, 'status', new.status, 'stop_reason', new.stop_reason,
                'ai_assessment', CASE WHEN new.ai_assessment IS NULL THEN NULL ELSE substr(new.ai_assessment,1,60) END),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_medications_ad;
CREATE TRIGGER audit_medications_ad AFTER DELETE ON medications BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('medication', old.id, 'delete', json_object('name', old.name, 'status', old.status), old.patient_id);
END;

-- PRESCRIPTIONS ───────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_prescriptions_ai;
CREATE TRIGGER audit_prescriptions_ai AFTER INSERT ON prescriptions BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('prescription', new.id, 'insert',
    json_object('medication_id', new.medication_id, 'timeline_id', new.timeline_id, 'specialist_id', new.specialist_id, 'dosage', new.dosage, 'course_status', new.course_status),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_prescriptions_au;
CREATE TRIGGER audit_prescriptions_au AFTER UPDATE ON prescriptions BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('prescription', new.id, 'update',
    json_object('medication_id', old.medication_id, 'course_status', old.course_status, 'end_date', old.end_date, 'stop_reason', old.stop_reason),
    json_object('medication_id', new.medication_id, 'course_status', new.course_status, 'end_date', new.end_date, 'stop_reason', new.stop_reason),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_prescriptions_ad;
CREATE TRIGGER audit_prescriptions_ad AFTER DELETE ON prescriptions BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('prescription', old.id, 'delete',
    json_object('medication_id', old.medication_id, 'timeline_id', old.timeline_id, 'specialist_id', old.specialist_id), old.patient_id);
END;

-- PLAN ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_plan_ai;
CREATE TRIGGER audit_plan_ai AFTER INSERT ON plan BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('plan', new.id, 'insert', json_object('title', new.title, 'status', new.status, 'priority', new.priority, 'due_date', new.due_date), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_plan_au;
CREATE TRIGGER audit_plan_au AFTER UPDATE ON plan BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('plan', new.id, 'update',
    json_object('title', old.title, 'status', old.status, 'priority', old.priority,
                'outcome_len', CASE WHEN old.outcome IS NULL THEN 0 ELSE length(old.outcome) END),
    json_object('title', new.title, 'status', new.status, 'priority', new.priority,
                'outcome_len', CASE WHEN new.outcome IS NULL THEN 0 ELSE length(new.outcome) END),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_plan_ad;
CREATE TRIGGER audit_plan_ad AFTER DELETE ON plan BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('plan', old.id, 'delete', json_object('title', old.title), old.patient_id);
END;

-- MEDICAL ERRORS ──────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_errors_ai;
CREATE TRIGGER audit_errors_ai AFTER INSERT ON medical_errors BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('error', new.id, 'insert', json_object('title', new.title, 'severity', new.severity, 'status', new.status), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_errors_au;
CREATE TRIGGER audit_errors_au AFTER UPDATE ON medical_errors BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('error', new.id, 'update',
    json_object('title', old.title, 'status', old.status, 'severity', old.severity,
                'resolution_len', CASE WHEN old.resolution IS NULL THEN 0 ELSE length(old.resolution) END),
    json_object('title', new.title, 'status', new.status, 'severity', new.severity,
                'resolution_len', CASE WHEN new.resolution IS NULL THEN 0 ELSE length(new.resolution) END),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_errors_ad;
CREATE TRIGGER audit_errors_ad AFTER DELETE ON medical_errors BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('error', old.id, 'delete', json_object('title', old.title), old.patient_id);
END;

-- LAB RESULTS (legacy names: audit_labs_*) ────────────────
DROP TRIGGER IF EXISTS audit_lab_results_ai;
DROP TRIGGER IF EXISTS audit_labs_ai;
CREATE TRIGGER audit_labs_ai AFTER INSERT ON lab_results BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('lab_result', new.id, 'insert',
    json_object('test_name', new.test_name, 'parameter', new.parameter, 'value', new.value, 'unit', new.unit, 'status', new.status, 'test_date', new.test_date), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_lab_results_au;
DROP TRIGGER IF EXISTS audit_labs_au;
CREATE TRIGGER audit_labs_au AFTER UPDATE ON lab_results BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('lab_result', new.id, 'update',
    json_object('test_name', old.test_name, 'parameter', old.parameter, 'value', old.value, 'status', old.status),
    json_object('test_name', new.test_name, 'parameter', new.parameter, 'value', new.value, 'status', new.status),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_lab_results_ad;
DROP TRIGGER IF EXISTS audit_labs_ad;
CREATE TRIGGER audit_labs_ad AFTER DELETE ON lab_results BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('lab_result', old.id, 'delete', json_object('test_name', old.test_name, 'parameter', old.parameter), old.patient_id);
END;

-- SPECIALISTS ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_specialists_ai;
CREATE TRIGGER audit_specialists_ai AFTER INSERT ON specialists BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('specialist', new.id, 'insert', json_object('full_name', new.full_name, 'specialization', new.specialization, 'clinic', new.clinic), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_specialists_au;
CREATE TRIGGER audit_specialists_au AFTER UPDATE ON specialists BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('specialist', new.id, 'update',
    json_object('full_name', old.full_name, 'specialization', old.specialization, 'notes_len', CASE WHEN old.notes IS NULL THEN 0 ELSE length(old.notes) END),
    json_object('full_name', new.full_name, 'specialization', new.specialization, 'notes_len', CASE WHEN new.notes IS NULL THEN 0 ELSE length(new.notes) END),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_specialists_ad;
CREATE TRIGGER audit_specialists_ad AFTER DELETE ON specialists BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('specialist', old.id, 'delete', json_object('full_name', old.full_name), old.patient_id);
END;

-- COMMENTS ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_comments_ai;
CREATE TRIGGER audit_comments_ai AFTER INSERT ON comments BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('comment', new.id, 'insert',
    json_object('entity_type', new.entity_type, 'entity_id', new.entity_id, 'text', substr(new.text,1,120)),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_comments_au;
CREATE TRIGGER audit_comments_au AFTER UPDATE ON comments BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('comment', new.id, 'update',
    json_object('text', substr(old.text,1,120)),
    json_object('text', substr(new.text,1,120)),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_comments_ad;
CREATE TRIGGER audit_comments_ad AFTER DELETE ON comments BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('comment', old.id, 'delete',
    json_object('entity_type', old.entity_type, 'entity_id', old.entity_id, 'text', substr(old.text,1,120)),
    old.patient_id);
END;

-- VACCINATIONS ────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_vaccinations_ai;
CREATE TRIGGER audit_vaccinations_ai AFTER INSERT ON vaccinations BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('vaccination', new.id, 'insert',
    json_object('name', new.name, 'vaccine_name', new.vaccine_name, 'status', new.status, 'actual_date', new.actual_date, 'scheduled_date', new.scheduled_date),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_vaccinations_au;
CREATE TRIGGER audit_vaccinations_au AFTER UPDATE ON vaccinations BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('vaccination', new.id, 'update',
    json_object('name', old.name, 'status', old.status, 'actual_date', old.actual_date),
    json_object('name', new.name, 'status', new.status, 'actual_date', new.actual_date),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_vaccinations_ad;
CREATE TRIGGER audit_vaccinations_ad AFTER DELETE ON vaccinations BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('vaccination', old.id, 'delete', json_object('name', old.name), old.patient_id);
END;

-- GROWTH LOG ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_growth_ai;
CREATE TRIGGER audit_growth_ai AFTER INSERT ON growth_log BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('growth', new.id, 'insert',
    json_object('measured_at', new.measured_at, 'height_cm', new.height_cm, 'weight_kg', new.weight_kg, 'head_circumference_cm', new.head_circumference_cm),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_growth_au;
CREATE TRIGGER audit_growth_au AFTER UPDATE ON growth_log BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('growth', new.id, 'update',
    json_object('measured_at', old.measured_at, 'height_cm', old.height_cm, 'weight_kg', old.weight_kg),
    json_object('measured_at', new.measured_at, 'height_cm', new.height_cm, 'weight_kg', new.weight_kg),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_growth_ad;
CREATE TRIGGER audit_growth_ad AFTER DELETE ON growth_log BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('growth', old.id, 'delete', json_object('measured_at', old.measured_at), old.patient_id);
END;

-- REMINDERS ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_reminders_ai;
CREATE TRIGGER audit_reminders_ai AFTER INSERT ON reminders BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('reminder', new.id, 'insert', json_object('title', new.title, 'remind_at', new.remind_at, 'status', new.status), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_reminders_au;
CREATE TRIGGER audit_reminders_au AFTER UPDATE ON reminders BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('reminder', new.id, 'update',
    json_object('title', old.title, 'status', old.status, 'remind_at', old.remind_at),
    json_object('title', new.title, 'status', new.status, 'remind_at', new.remind_at),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_reminders_ad;
CREATE TRIGGER audit_reminders_ad AFTER DELETE ON reminders BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('reminder', old.id, 'delete', json_object('title', old.title), old.patient_id);
END;
