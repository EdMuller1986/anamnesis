import { Hono } from 'hono';
import {
  normalizePatient,
  mapPlanItem,
  mapMedicationRow,
  mapErrorRow,
} from '../services/patient-normalize';

const dashboard = new Hono();

async function safe(label, promise, fallback) {
  try {
    return await promise;
  } catch (e) {
    console.warn(`[dashboard] ${label}:`, e.message);
    return fallback;
  }
}

/**
 * GET /api/dashboard — агрегированная статистика для главного экрана.
 */
dashboard.get('/', async (c) => {
  const pid = c.get('patientId');
  const db = c.env.DB;

  const emptyAll = { results: [] };
  const emptyFirst = null;
  const zero = { count: 0 };

  const [
    patient,
    diagnoses,
    medications,
    specialists,
    reminders,
    plan,
    errors,
    docsCount,
    planTotal,
    planDone,
    errorsOpen,
    upcomingVaccinations,
    latestGrowth,
    labAnomalies,
  ] = await Promise.all([
    safe('patient', db.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).first(), emptyFirst),
    safe('diagnoses', db.prepare("SELECT * FROM diagnoses WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC").bind(pid).all(), emptyAll),
    safe('medications', db.prepare(`
      SELECT m.*, s.full_name as specialist_name_resolved
      FROM medications m
      LEFT JOIN specialists s ON m.specialist_id = s.id
      WHERE m.patient_id = ? AND m.status = 'active'
      ORDER BY m.created_at DESC
    `).bind(pid).all(), emptyAll),
    safe('specialists', db.prepare(`
      SELECT * FROM specialists
      WHERE patient_id = ? AND (status = 'active' OR status IS NULL OR status = '')
      ORDER BY created_at DESC
    `).bind(pid).all(), emptyAll),
    safe('reminders', db.prepare("SELECT * FROM reminders WHERE patient_id = ? AND status = 'pending' ORDER BY remind_at ASC LIMIT 10").bind(pid).all(), emptyAll),
    safe('plan', db.prepare("SELECT * FROM plan WHERE patient_id = ? AND status IN ('pending', 'in_progress') AND priority IN ('urgent', 'high') ORDER BY created_at DESC LIMIT 10").bind(pid).all(), emptyAll),
    safe('errors', db.prepare("SELECT * FROM medical_errors WHERE patient_id = ? AND status = 'open' ORDER BY created_at DESC").bind(pid).all(), emptyAll),
    safe('docsCount', db.prepare("SELECT COUNT(*) AS count FROM documents WHERE patient_id = ?").bind(pid).first(), zero),
    safe('planTotal', db.prepare("SELECT COUNT(*) AS count FROM plan WHERE patient_id = ? AND status != 'done'").bind(pid).first(), zero),
    safe('planDone', db.prepare("SELECT COUNT(*) AS count FROM plan WHERE patient_id = ? AND status = 'done'").bind(pid).first(), zero),
    safe('errorsOpen', db.prepare("SELECT COUNT(*) AS count FROM medical_errors WHERE patient_id = ? AND status = 'open'").bind(pid).first(), zero),
    safe('vaccinations', db.prepare("SELECT * FROM vaccinations WHERE patient_id = ? AND status = 'scheduled' ORDER BY scheduled_date ASC LIMIT 5").bind(pid).all(), emptyAll),
    safe('growth', db.prepare("SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 1").bind(pid).first(), emptyFirst),
    safe('labs', db.prepare("SELECT * FROM lab_results WHERE patient_id = ? AND status IN ('high', 'low', 'critical') ORDER BY test_date DESC LIMIT 5").bind(pid).all(), emptyAll),
  ]);

  const diags = diagnoses?.results || [];
  const meds = (medications?.results || []).map(mapMedicationRow);
  const specs = specialists?.results || [];
  const rems = reminders?.results || [];
  const planItems = (plan?.results || []).map(mapPlanItem);
  const errs = (errors?.results || []).map(mapErrorRow);

  return c.json({
    patient: normalizePatient(patient),
    active_diagnoses: diags,
    active_medications: meds,
    active_specialists: specs,
    upcoming_reminders: rems,
    urgent_plan_items: planItems,
    open_errors: errs,
    upcoming_vaccinations: upcomingVaccinations?.results || [],
    latest_growth: latestGrowth || null,
    lab_anomalies: labAnomalies?.results || [],
    stats: {
      documents: docsCount?.count || 0,
      plan_total: planTotal?.count || 0,
      plan_done: planDone?.count || 0,
      errors_open: errorsOpen?.count || 0,
      diagnoses: diags.length,
      specialists: specs.length,
      reminders: rems.length,
    },
  });
});

dashboard.get('/ai-summary', async (c) => {
  const pid = c.get('patientId');
  const key = `ai_summary_${pid}`;
  try {
    const row = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
    const data = row ? JSON.parse(row.value) : { summary: '', updated_at: null };
    return c.json(data);
  } catch {
    return c.json({ summary: '', updated_at: null });
  }
});

dashboard.put('/ai-summary', async (c) => {
  const pid = c.get('patientId');
  const body = await c.req.json();
  const { summary, priorities, next_steps, warnings, updated_at } = body;

  const data = JSON.stringify({
    summary, priorities, next_steps, warnings,
    updated_at: updated_at || new Date().toISOString(),
  });
  const key = `ai_summary_${pid}`;

  await c.env.DB.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, data).run();

  return c.json(JSON.parse(data));
});

export default dashboard;
