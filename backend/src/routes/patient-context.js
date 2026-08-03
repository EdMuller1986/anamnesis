import { Hono } from 'hono';
import { normalizePatient, mapPlanItem, mapMedicationRow, mapErrorRow } from '../services/patient-normalize';

const patientContext = new Hono();

/**
 * GET /api/patient-context
 * Enriched medical snapshot for health graph + AI coordinators.
 */
patientContext.get('/', async (c) => {
  const pid = c.get('patientId');
  const db = c.env.DB;

  const queries = {
    patient: db.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).first(),
    diagnoses: db.prepare('SELECT * FROM diagnoses WHERE patient_id = ?').bind(pid).all(),
    specialists: db.prepare('SELECT * FROM specialists WHERE patient_id = ?').bind(pid).all(),
    medications: db.prepare(`
      SELECT m.*, s.full_name as specialist_name_resolved
      FROM medications m
      LEFT JOIN specialists s ON m.specialist_id = s.id
      WHERE m.patient_id = ?
    `).bind(pid).all(),
    timeline: db.prepare(
      'SELECT id, title, event_date, specialist_id, category, description FROM timeline WHERE patient_id = ? ORDER BY event_date DESC'
    ).bind(pid).all(),
    prescriptions: db.prepare('SELECT * FROM prescriptions WHERE patient_id = ?').bind(pid).all(),
    visit_diagnoses: db.prepare('SELECT * FROM visit_diagnoses WHERE patient_id = ?').bind(pid).all(),
    medical_errors: db.prepare('SELECT * FROM medical_errors WHERE patient_id = ?').bind(pid).all(),
    lab_results: db.prepare('SELECT * FROM lab_results WHERE patient_id = ?').bind(pid).all(),
    vaccinations: db.prepare('SELECT * FROM vaccinations WHERE patient_id = ?').bind(pid).all(),
    growth_log: db.prepare('SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC').bind(pid).all(),
    plan: db.prepare('SELECT * FROM plan WHERE patient_id = ? ORDER BY COALESCE(sort_order, 0), id').bind(pid).all(),
    documents: db.prepare(
      'SELECT id, title, category, timeline_id, mime_type, original_name, file_size, document_date, created_at FROM documents WHERE patient_id = ?'
    ).bind(pid).all(),
    comments: db.prepare(
      'SELECT id, entity_type, entity_id, author, text, created_at FROM comments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(pid).all(),
    ai_requests: db.prepare(
      "SELECT * FROM ai_requests WHERE patient_id = ? AND status IN ('pending', 'in_progress') ORDER BY created_at DESC"
    ).bind(pid).all(),
    reminders: db.prepare('SELECT * FROM reminders WHERE patient_id = ? ORDER BY remind_at ASC').bind(pid).all(),
  };

  try {
    const settled = await Promise.all(Object.values(queries).map((p) => p));
    const keys = Object.keys(queries);
    const raw = {};
    keys.forEach((key, i) => {
      raw[key] = settled[i];
    });

    const list = (x) => x?.results || [];

    return c.json({
      patient: normalizePatient(raw.patient),
      diagnoses: list(raw.diagnoses),
      specialists: list(raw.specialists),
      medications: list(raw.medications).map(mapMedicationRow),
      timeline: list(raw.timeline),
      prescriptions: list(raw.prescriptions),
      visit_diagnoses: list(raw.visit_diagnoses),
      medical_errors: list(raw.medical_errors).map(mapErrorRow),
      lab_results: list(raw.lab_results),
      vaccinations: list(raw.vaccinations),
      growth_log: list(raw.growth_log),
      plan: list(raw.plan).map(mapPlanItem),
      documents: list(raw.documents),
      comments: list(raw.comments),
      ai_requests: list(raw.ai_requests),
      reminders: list(raw.reminders),
    });
  } catch (err) {
    console.error('Patient Context Error:', err);
    return c.json({ error: 'Failed to fetch patient context', message: err.message }, 500);
  }
});

export default patientContext;
