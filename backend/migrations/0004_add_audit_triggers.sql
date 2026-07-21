-- 0004_add_audit_triggers.sql

-- DOCUMENTS
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
    json_object('title', old.title, 'timeline_id', old.timeline_id, 'quality', old.quality),
    json_object('title', new.title, 'timeline_id', new.timeline_id, 'quality', new.quality),
    new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_documents_ad;
CREATE TRIGGER audit_documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
  VALUES ('document', old.id, 'delete', json_object('title', old.title, 'file_path', old.file_path, 'timeline_id', old.timeline_id), old.patient_id);
END;

-- DIAGNOSES
DROP TRIGGER IF EXISTS audit_diagnoses_ai;
CREATE TRIGGER audit_diagnoses_ai AFTER INSERT ON diagnoses BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('diagnosis', new.id, 'insert', json_object('name', new.name, 'icd_code', new.icd_code, 'status', new.status), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_diagnoses_au;
CREATE TRIGGER audit_diagnoses_au AFTER UPDATE ON diagnoses BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('diagnosis', new.id, 'update',
    json_object('name', old.name, 'status', old.status),
    json_object('name', new.name, 'status', new.status),
    new.patient_id);
END;

-- MEDICATIONS
DROP TRIGGER IF EXISTS audit_medications_ai;
CREATE TRIGGER audit_medications_ai AFTER INSERT ON medications BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('medication', new.id, 'insert', json_object('name', new.name, 'dosage', new.dosage, 'status', new.status), new.patient_id);
END;

-- SPECIALISTS
DROP TRIGGER IF EXISTS audit_specialists_ai;
CREATE TRIGGER audit_specialists_ai AFTER INSERT ON specialists BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('specialist', new.id, 'insert', json_object('full_name', new.full_name, 'specialization', new.specialization), new.patient_id);
END;

-- LAB RESULTS
DROP TRIGGER IF EXISTS audit_lab_results_ai;
CREATE TRIGGER audit_lab_results_ai AFTER INSERT ON lab_results BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('lab_result', new.id, 'insert', json_object('parameter', new.parameter, 'value', new.value, 'unit', new.unit, 'status', new.status), new.patient_id);
END;

-- PLAN
DROP TRIGGER IF EXISTS audit_plan_ai;
CREATE TRIGGER audit_plan_ai AFTER INSERT ON plan BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
  VALUES ('plan', new.id, 'insert', json_object('title', new.title, 'priority', new.priority, 'status', new.status), new.patient_id);
END;

DROP TRIGGER IF EXISTS audit_plan_au;
CREATE TRIGGER audit_plan_au AFTER UPDATE ON plan BEGIN
  INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
  VALUES ('plan', new.id, 'update',
    json_object('title', old.title, 'status', old.status),
    json_object('title', new.title, 'status', new.status),
    new.patient_id);
END;
