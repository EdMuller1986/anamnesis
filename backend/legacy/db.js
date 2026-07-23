const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const dbPath = config.DATABASE_URL || path.join(__dirname, '..', 'data', 'anamnesis.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Existing tables migrations ──────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Add missing columns to existing tables
try { db.exec('ALTER TABLE comments ADD COLUMN author TEXT DEFAULT \'user\''); } catch(e) {}
try { db.exec('ALTER TABLE medical_errors ADD COLUMN detail TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE plan ADD COLUMN detail TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medical_errors ADD COLUMN advice TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE plan ADD COLUMN advice TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN transcription TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medical_errors ADD COLUMN ai_assessment TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE plan ADD COLUMN ai_assessment TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medications ADD COLUMN detail TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medications ADD COLUMN ai_assessment TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN ai_assessment TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE diagnoses ADD COLUMN detail TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE diagnoses ADD COLUMN ai_assessment TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN timeline_id INTEGER REFERENCES timeline(id)'); } catch(e) {}
// Timeline: specialist info and transcription
try { db.exec('ALTER TABLE timeline ADD COLUMN specialist_name TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE timeline ADD COLUMN specialist_type TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE timeline ADD COLUMN transcription TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE timeline ADD COLUMN ai_assessment TEXT'); } catch(e) {}
// Vaccinations: photos (JSON array of file paths)
try { db.exec('ALTER TABLE vaccinations ADD COLUMN photos TEXT DEFAULT \'[]\''); } catch(e) {}

// ── AI analysis requests ────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    patient_id INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_ai_requests_status ON ai_requests(status);
  CREATE INDEX IF NOT EXISTS idx_ai_requests_patient ON ai_requests(patient_id);
`);

// ── Schema v2: Relationship columns & tables ────────────────

// FK columns: link entities to specialists table
try { db.exec('ALTER TABLE timeline ADD COLUMN specialist_id INTEGER REFERENCES specialists(id)'); } catch(e) {}
try { db.exec('ALTER TABLE medications ADD COLUMN specialist_id INTEGER REFERENCES specialists(id)'); } catch(e) {}
try { db.exec('ALTER TABLE lab_results ADD COLUMN specialist_id INTEGER REFERENCES specialists(id)'); } catch(e) {}

// Outcome/resolution fields
try { db.exec('ALTER TABLE medications ADD COLUMN stop_reason TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE plan ADD COLUMN outcome TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE plan ADD COLUMN completed_at TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medical_errors ADD COLUMN resolution TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE medical_errors ADD COLUMN resolved_at TEXT'); } catch(e) {}

// Junction tables for many-to-many relationships
db.exec(`
  CREATE TABLE IF NOT EXISTS prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id INTEGER REFERENCES medications(id) ON DELETE CASCADE,
    diagnosis_id INTEGER REFERENCES diagnoses(id) ON DELETE SET NULL,
    specialist_id INTEGER REFERENCES specialists(id) ON DELETE SET NULL,
    timeline_id INTEGER REFERENCES timeline(id) ON DELETE SET NULL,
    rationale TEXT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_prescriptions_medication ON prescriptions(medication_id);
  CREATE INDEX IF NOT EXISTS idx_prescriptions_diagnosis ON prescriptions(diagnosis_id);
  CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);

  CREATE TABLE IF NOT EXISTS visit_diagnoses (
    visit_id INTEGER REFERENCES timeline(id) ON DELETE CASCADE,
    diagnosis_id INTEGER REFERENCES diagnoses(id) ON DELETE CASCADE,
    relation TEXT DEFAULT 'discussed',
    patient_id INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (visit_id, diagnosis_id)
  );
  CREATE INDEX IF NOT EXISTS idx_visit_diagnoses_patient ON visit_diagnoses(patient_id);
`);

// ── Version tracking ────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS app_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    changes TEXT NOT NULL DEFAULT '[]',
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const existingVersion = db.prepare("SELECT value FROM app_settings WHERE key = 'current_version'").get();
if (!existingVersion) {
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('current_version', '1.0.0')").run();
  db.prepare("INSERT INTO app_versions (version, changes, reason) VALUES (?, ?, ?)").run(
    '1.0.0',
    JSON.stringify(['Начальная версия системы']),
    'Инициализация'
  );
}

// ── New tables ──────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS vaccinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vaccine_name TEXT,
    dose_number INTEGER DEFAULT 1,
    scheduled_date TEXT,
    actual_date TEXT,
    status TEXT DEFAULT 'scheduled',
    administered_by TEXT,
    batch_number TEXT,
    reaction TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS growth_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    measured_at TEXT NOT NULL,
    height_cm REAL,
    weight_kg REAL,
    head_circumference_cm REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lab_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_date TEXT NOT NULL,
    test_name TEXT NOT NULL,
    parameter TEXT NOT NULL,
    value REAL,
    unit TEXT,
    ref_min REAL,
    ref_max REAL,
    status TEXT DEFAULT 'normal',
    timeline_id INTEGER REFERENCES timeline(id),
    specialist_id INTEGER REFERENCES specialists(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Multi-patient support ──────────────────────────────────
// Add patient_id to all entity tables (default 1 = primary patient)
const patientTables = [
  'diagnoses', 'medications', 'specialists', 'medical_errors', 'plan',
  'timeline', 'documents', 'reminders', 'comments', 'vaccinations',
  'growth_log', 'lab_results',
];
for (const table of patientTables) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1`); } catch(e) {}
}

// Create indexes for patient_id
for (const table of patientTables) {
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_patient ON ${table}(patient_id)`); } catch(e) {}
}

// ── Indexes ─────────────────────────────────────────────────

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_diagnoses_status ON diagnoses(status);
  CREATE INDEX IF NOT EXISTS idx_medications_status ON medications(status);
  CREATE INDEX IF NOT EXISTS idx_plan_status_priority ON plan(status, priority);
  CREATE INDEX IF NOT EXISTS idx_medical_errors_status ON medical_errors(status);
  CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status, remind_at);
  CREATE INDEX IF NOT EXISTS idx_documents_timeline ON documents(timeline_id);
  CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline(event_date);
  CREATE INDEX IF NOT EXISTS idx_lab_results_date ON lab_results(test_date);
  CREATE INDEX IF NOT EXISTS idx_growth_log_date ON growth_log(measured_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_timeline_specialist ON timeline(specialist_id);
  CREATE INDEX IF NOT EXISTS idx_medications_specialist ON medications(specialist_id);
  CREATE INDEX IF NOT EXISTS idx_lab_results_specialist ON lab_results(specialist_id);
`);

// ═════════════════════════════════════════════════════════════
// ── Schema v3: hardening, provenance, FTS5, audit triggers ──
// ═════════════════════════════════════════════════════════════
// Все миграции идемпотентны — try/catch на ALTER, IF NOT EXISTS на CREATE.
// Запускаются при каждом старте сервиса, безопасны для любой версии БД.

// ── v3.1 documents: source metadata + dedup fields ──────────
// source_doctor/source_org — кто выдал документ (может отличаться от
// timeline.specialist_id, например скан из старой клиники)
// document_date — дата на документе, не дата загрузки
// file_hash — SHA-256 для авто-детекции дублей
// page_count — число страниц (PDF)
// parent_document_id — связь страниц одного документа или оригинал→дубль
// quality — good / low / duplicate / needs_source / conflict
try { db.exec('ALTER TABLE documents ADD COLUMN source_doctor TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN source_org TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN document_date TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN file_hash TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN page_count INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN parent_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL'); } catch(e) {}
try { db.exec("ALTER TABLE documents ADD COLUMN quality TEXT DEFAULT 'good'"); } catch(e) {}

// ── v3.2 AI provenance на всех сущностях с ai_assessment ────
// ai_sources — JSON массив [{entity_type, entity_id, quote}]
// ai_assessed_at — когда написана оценка
// ai_context_version — версия пациента на момент написания оценки
for (const table of ['timeline', 'documents', 'diagnoses', 'medications', 'plan', 'medical_errors']) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ai_sources TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ai_assessed_at TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ai_context_version TEXT`); } catch(e) {}
}

// ── v3.3 medications: INN (международное непатентованное название) ──
// Для отлова generic vs brand names — одна молекула, разные торговые имена
// (например INN "ibuprofen" → brand "Nurofen", "Advil", etc.)
try { db.exec('ALTER TABLE medications ADD COLUMN inn TEXT'); } catch(e) {}

// ── v3.4 prescriptions: per-course поля ─────────────────────
// Курс конкретного назначения: дозировка, частота, даты, статус, причина отмены.
// Делает prescriptions полноценным описанием КУРСА, а medications — справочником молекул.
// Старое medications.dosage/frequency/status остаётся для обратной совместимости,
// но новые записи должны писать курсовые данные в prescriptions.
try { db.exec('ALTER TABLE prescriptions ADD COLUMN dosage TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE prescriptions ADD COLUMN frequency TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE prescriptions ADD COLUMN start_date TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE prescriptions ADD COLUMN end_date TEXT'); } catch(e) {}
try { db.exec("ALTER TABLE prescriptions ADD COLUMN course_status TEXT DEFAULT 'active'"); } catch(e) {}
try { db.exec('ALTER TABLE prescriptions ADD COLUMN stop_reason TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE prescriptions ADD COLUMN duration_text TEXT'); } catch(e) {}

// ── v3.5 индексы на новые поля ──────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_document_id);
  CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);
  CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(document_date);
  CREATE INDEX IF NOT EXISTS idx_medications_inn ON medications(inn);
  CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(course_status);
  CREATE INDEX IF NOT EXISTS idx_prescriptions_dates ON prescriptions(start_date, end_date);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
`);

// ── v3.15 audit_log: patient_id колонка ────────────────────
// История изменений per-patient. Триггеры переписываются ниже
// с включением new.patient_id / old.patient_id.
try { db.exec('ALTER TABLE audit_log ADD COLUMN patient_id INTEGER'); } catch(e) {}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_audit_log_patient ON audit_log(patient_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_patient_created ON audit_log(patient_id, created_at);
`);

// ── v3.6 FTS5 — полнотекстовый поиск ────────────────────────
// unicode61 с remove_diacritics=0 корректно работает с кириллицей (ё/й не ломаются).
// content=... связывает виртуальную таблицу с основной — синхронизация идёт через триггеры ниже.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS timeline_fts USING fts5(
    title, description, transcription, notes,
    tokenize = 'unicode61 remove_diacritics 0',
    content = 'timeline',
    content_rowid = 'id'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, transcription, notes, source_doctor, source_org,
    tokenize = 'unicode61 remove_diacritics 0',
    content = 'documents',
    content_rowid = 'id'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(
    text,
    tokenize = 'unicode61 remove_diacritics 0',
    content = 'comments',
    content_rowid = 'id'
  );
`);

// FTS sync triggers: при любом INSERT/UPDATE/DELETE на основной таблице —
// обновляем FTS-индекс. Паттерн из SQLite docs для external content FTS5.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS timeline_ai AFTER INSERT ON timeline BEGIN
    INSERT INTO timeline_fts(rowid, title, description, transcription, notes)
    VALUES (new.id, new.title, new.description, new.transcription, new.notes);
  END;
  CREATE TRIGGER IF NOT EXISTS timeline_ad AFTER DELETE ON timeline BEGIN
    INSERT INTO timeline_fts(timeline_fts, rowid, title, description, transcription, notes)
    VALUES ('delete', old.id, old.title, old.description, old.transcription, old.notes);
  END;
  CREATE TRIGGER IF NOT EXISTS timeline_au AFTER UPDATE ON timeline BEGIN
    INSERT INTO timeline_fts(timeline_fts, rowid, title, description, transcription, notes)
    VALUES ('delete', old.id, old.title, old.description, old.transcription, old.notes);
    INSERT INTO timeline_fts(rowid, title, description, transcription, notes)
    VALUES (new.id, new.title, new.description, new.transcription, new.notes);
  END;

  CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, title, transcription, notes, source_doctor, source_org)
    VALUES (new.id, new.title, new.transcription, new.notes, new.source_doctor, new.source_org);
  END;
  CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, transcription, notes, source_doctor, source_org)
    VALUES ('delete', old.id, old.title, old.transcription, old.notes, old.source_doctor, old.source_org);
  END;
  CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, transcription, notes, source_doctor, source_org)
    VALUES ('delete', old.id, old.title, old.transcription, old.notes, old.source_doctor, old.source_org);
    INSERT INTO documents_fts(rowid, title, transcription, notes, source_doctor, source_org)
    VALUES (new.id, new.title, new.transcription, new.notes, new.source_doctor, new.source_org);
  END;

  CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
    INSERT INTO comments_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
    INSERT INTO comments_fts(comments_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE ON comments BEGIN
    INSERT INTO comments_fts(comments_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO comments_fts(rowid, text) VALUES (new.id, new.text);
  END;
`);

// Первичное заполнение FTS — rebuild синхронизирует виртуальную таблицу
// с основной. Вызываем только если FTS пустая (чтобы не тратить цикл на каждый старт).
const ftsCount = db.prepare('SELECT COUNT(*) AS c FROM timeline_fts').get().c;
if (ftsCount === 0) {
  try {
    db.exec("INSERT INTO timeline_fts(timeline_fts) VALUES ('rebuild')");
    db.exec("INSERT INTO documents_fts(documents_fts) VALUES ('rebuild')");
    db.exec("INSERT INTO comments_fts(comments_fts) VALUES ('rebuild')");
  } catch (e) {
    console.warn('FTS rebuild failed (non-fatal):', e.message);
  }
}

// ── v3.7 audit триггеры — логируют все изменения ключевых таблиц ──
// audit_log = автоматическая per-patient история изменений.
// Все триггеры пишут patient_id чтобы фильтровать changelog.
// Рекурсии нет — audit_log не триггерит ничего.
//
// Важные поля в old/new: то что реально видит пользователь в истории.
// Длинные поля (ai_assessment, description, transcription) обрезаются.
db.exec(`
  -- TIMELINE (визиты) ─────────────────────────────────────
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

  -- DOCUMENTS ─────────────────────────────────────────────
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

  -- DIAGNOSES ─────────────────────────────────────────────
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

  -- MEDICATIONS ───────────────────────────────────────────
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

  -- PRESCRIPTIONS ─────────────────────────────────────────
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

  -- PLAN ──────────────────────────────────────────────────
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

  -- MEDICAL ERRORS ────────────────────────────────────────
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

  -- LAB RESULTS ───────────────────────────────────────────
  DROP TRIGGER IF EXISTS audit_labs_ai;
  CREATE TRIGGER audit_labs_ai AFTER INSERT ON lab_results BEGIN
    INSERT INTO audit_log(entity_type, entity_id, action, new_value, patient_id)
    VALUES ('lab_result', new.id, 'insert',
      json_object('test_name', new.test_name, 'parameter', new.parameter, 'value', new.value, 'unit', new.unit, 'status', new.status, 'test_date', new.test_date), new.patient_id);
  END;
  DROP TRIGGER IF EXISTS audit_labs_au;
  CREATE TRIGGER audit_labs_au AFTER UPDATE ON lab_results BEGIN
    INSERT INTO audit_log(entity_type, entity_id, action, old_value, new_value, patient_id)
    VALUES ('lab_result', new.id, 'update',
      json_object('test_name', old.test_name, 'parameter', old.parameter, 'value', old.value, 'status', old.status),
      json_object('test_name', new.test_name, 'parameter', new.parameter, 'value', new.value, 'status', new.status),
      new.patient_id);
  END;
  DROP TRIGGER IF EXISTS audit_labs_ad;
  CREATE TRIGGER audit_labs_ad AFTER DELETE ON lab_results BEGIN
    INSERT INTO audit_log(entity_type, entity_id, action, old_value, patient_id)
    VALUES ('lab_result', old.id, 'delete', json_object('test_name', old.test_name, 'parameter', old.parameter), old.patient_id);
  END;

  -- SPECIALISTS ───────────────────────────────────────────
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

  -- COMMENTS ──────────────────────────────────────────────
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

  -- VACCINATIONS ──────────────────────────────────────────
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

  -- GROWTH LOG ────────────────────────────────────────────
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

  -- REMINDERS ─────────────────────────────────────────────
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
`);

// ── v3.8 служебные ключи для AI-координатора ────────────────
// last_ai_review_at_{pid} — отметка "до какой даты Claude всё просмотрел".
// Обновляется в конце каждой сессии через /api/admin/tools/mark-reviewed.
for (const pid of [1, 2, 3, 4]) {
  try {
    db.prepare(
      "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)"
    ).run(`last_ai_review_at_${pid}`, '1970-01-01 00:00:00');
  } catch (e) {}
}

// ── v3.13 comments.author backfill для ai_chat ──────────────────
// История: раньше comments не имели поля author — AI-ответы от вопросов
// отличались только контекстуально (чередование user/ai в хронологии).
// Добавили колонку author (default 'user'). Для существующих ai_chat
// сообщений выполняем однократный backfill: в хронологическом порядке
// чётные (0,2,4...) = вопросы пользователя, нечётные (1,3,5...) = ответы AI.
// Флаг в app_settings предохраняет от повторного выполнения.
try {
  const already = db.prepare("SELECT value FROM app_settings WHERE key = 'ai_chat_author_backfilled'").get();
  if (!already) {
    db.exec(`
      UPDATE comments
      SET author = 'ai'
      WHERE entity_type = 'ai_chat'
        AND id IN (
          SELECT id FROM (
            SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)) AS rn
            FROM comments WHERE entity_type = 'ai_chat'
          )
          WHERE (rn - 1) % 2 = 1
        );
    `);
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run('ai_chat_author_backfilled', '1');
  }
} catch (e) {
  console.error('[db] ai_chat author backfill failed:', e.message);
}

// ── v3.9 sessions таблица — переезд с in-memory Map в БД ─────
// Это даёт:
// 1. Переживание рестартов сервиса (больше не выкидывает всех)
// 2. Ревокация — можно дропнуть конкретную сессию или все
// 3. Sliding expiry — продлеваем при активности
// 4. Аудит — видно когда и откуда заходили
// 5. Rate limit per-session
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    patient_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);

  CREATE TABLE IF NOT EXISTS auth_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,                      -- 'login_success', 'login_fail', 'logout', 'session_expired'
    ip TEXT,
    user_agent TEXT,
    detail TEXT,                              -- JSON с доп. инфой
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_auth_log_event ON auth_log(event);
  CREATE INDEX IF NOT EXISTS idx_auth_log_created ON auth_log(created_at);
`);

// Периодическая чистка истёкших сессий (при старте сервиса)
try {
  const expired = db.prepare(
    "DELETE FROM sessions WHERE expires_at < datetime('now')"
  ).run();
  if (expired.changes > 0) {
    console.log(`[auth] Cleaned ${expired.changes} expired sessions on startup`);
  }
} catch (e) {}

// ── v3.14 WebAuthn credentials (Face ID / Touch ID / Windows Hello) ──
// Platform authenticator passkeys — биометрия устройства.
// Привязываются к device_id (один device может иметь 1 credential).
// При аутентификации credential_id + signature проверяются через
// @simplewebauthn/server. Public key хранится как base64url.
db.exec(`
  CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    device_id TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,   -- base64url — стабильный идентификатор credential
    public_key TEXT NOT NULL,              -- base64url COSE public key
    counter INTEGER NOT NULL DEFAULT 0,    -- signCounter для replay protection
    transports TEXT,                       -- JSON массив: internal/usb/nfc/ble/hybrid
    backed_up INTEGER DEFAULT 0,           -- 1 если credential синхронизируется (iCloud Keychain)
    device_type TEXT,                      -- singleDevice / multiDevice
    nickname TEXT,                         -- label для UI "Face ID iPhone 14"
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patient(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_webauthn_patient ON webauthn_credentials(patient_id);
  CREATE INDEX IF NOT EXISTS idx_webauthn_device ON webauthn_credentials(device_id);
  CREATE INDEX IF NOT EXISTS idx_webauthn_credid ON webauthn_credentials(credential_id);
`);

// ── v3.16 sessions.device_id ─────────────────────────────
// Добавляем связь session → device. Нужно чтобы при revokeDevice()
// можно было ревокировать ВСЕ сессии этого устройства одним запросом.
// Без этого ревокация устройства не выкидывает существующую сессию —
// юзер продолжает пользоваться приложением до истечения 14-дневного
// срока. Это был critical security bug.
try { db.exec('ALTER TABLE sessions ADD COLUMN device_id TEXT'); } catch(e) {}
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id)');

// ── v3.11 known_devices + security questions ─────────────────
// Device trust: при логине с нового устройства (неизвестный device_id)
// требуется ответ на секретный вопрос. На доверенном — не требуется.
// device_id генерируется на клиенте (crypto.randomUUID), хранится в
// localStorage, передаётся в X-Device-Id header.
db.exec(`
  CREATE TABLE IF NOT EXISTS known_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL DEFAULT 1,
    label TEXT,                              -- "iPhone", "Work laptop", user-provided
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_ip TEXT,
    user_agent TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(device_id, patient_id)
  );
  CREATE INDEX IF NOT EXISTS idx_devices_patient ON known_devices(patient_id);
  CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON known_devices(last_seen_at);
`);

// ── v3.12 app_settings: security_question + answer_hash per patient ─
// security_question_{pid} — текст вопроса (для показа пользователю)
// security_answer_hash_{pid} — scrypt хеш нормализованного ответа
// security_setup_at_{pid} — когда настроено (чтобы показать "настрой ещё раз")
// Не создаём автоматически — появляются когда юзер настраивает через API.

// ── v3.13 auth_lockouts — экспоненциальный backoff ──────────
// Ключ: IP + device_id (или просто IP если device_id нет).
// attempts — счётчик последовательных неудач (PIN или answer).
// locked_until — до какого момента следующая попытка запрещена.
// Формула: lockout_minutes = 2^(attempts - 3), cap 24ч.
// attempts 1-2 — без локаута, 3+ — экспоненциальный backoff.
// Сбрасывается при успешном входе.
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_lockouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lockout_key TEXT NOT NULL UNIQUE,     -- 'ip:device_id' или 'ip:-'
    ip TEXT,
    device_id TEXT,
    patient_id INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_fail_at TEXT,
    locked_until TEXT,                     -- null если не залочен
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lockouts_key ON auth_lockouts(lockout_key);
  CREATE INDEX IF NOT EXISTS idx_lockouts_until ON auth_lockouts(locked_until);
`);

// Периодическая чистка старых записей lockout (старше 30 дней без активности)
try {
  db.prepare(
    "DELETE FROM auth_lockouts WHERE updated_at < datetime('now','-30 days')"
  ).run();
} catch (e) {}

// ── v3.10 app_settings: hashed PIN (Argon2id) ───────────────
// PIN хранится как хеш — если БД утечёт, PIN не восстановить.
// Ключ: 'pin_hash_{pid}'. Если отсутствует — берём из APP_PIN .env (legacy).

// ── PostgreSQL compatibility wrapper ────────────────────────

const pool = {
  query: (sql, params = []) => {
    let sqliteSQL = sql.replace(/\$(\d+)/g, '?');
    sqliteSQL = sqliteSQL.replace(/::int/g, '');
    sqliteSQL = sqliteSQL.replace(/TIMESTAMPTZ/gi, 'TEXT');
    sqliteSQL = sqliteSQL.replace(/NOW\(\)/gi, "datetime('now')");
    sqliteSQL = sqliteSQL.replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');

    const trimmed = sqliteSQL.trim().toUpperCase();

    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
      const rows = db.prepare(sqliteSQL).all(...params);
      return { rows, rowCount: rows.length };
    }

    // INSERT/UPDATE/DELETE with RETURNING *
    if (sqliteSQL.toUpperCase().includes('RETURNING')) {
      const returning = sqliteSQL.match(/RETURNING\s+\*/i);
      if (returning) {
        const baseSql = sqliteSQL.replace(/\s+RETURNING\s+\*/i, '');
        const info = db.prepare(baseSql).run(...params);

        let tableName = '';
        const insertMatch = baseSql.match(/INSERT\s+INTO\s+(\w+)/i);
        const updateMatch = baseSql.match(/UPDATE\s+(\w+)/i);

        if (insertMatch) {
          tableName = insertMatch[1];
          const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(info.lastInsertRowid);
          return { rows: row ? [row] : [], rowCount: info.changes };
        } else if (updateMatch) {
          tableName = updateMatch[1];
          const id = params[params.length - 1];
          const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
          return { rows: row ? [row] : [], rowCount: info.changes };
        }

        return { rows: [], rowCount: info.changes };
      }
    }

    const info = db.prepare(sqliteSQL).run(...params);
    return { rows: [], rowCount: info.changes };
  },

  // Fixed transactions using rawDb
  connect: () => {
    return {
      query: (sql, params) => pool.query(sql, params),
      release: () => {},
      beginTransaction: () => db.exec('BEGIN'),
      commit: () => db.exec('COMMIT'),
      rollback: () => db.exec('ROLLBACK'),
    };
  },
};

module.exports = pool;
module.exports.rawDb = db;
