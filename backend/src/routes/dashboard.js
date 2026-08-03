import { Hono } from 'hono';
import {
  normalizePatient,
  mapPlanItem,
  mapMedicationRow,
  mapErrorRow,
} from '../services/patient-normalize';

const dashboard = new Hono();

/**
 * GET /api/dashboard — агрегированная статистика для главного экрана.
 * Собирает данные из 10+ таблиц за один проход через Promise.all.
 */
dashboard.get('/', async (c) => {
  const pid = c.get('patientId');
  
  const queries = {
    patient: c.env.DB.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).first(),
    diagnoses: c.env.DB.prepare("SELECT * FROM diagnoses WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC").bind(pid).all(),
    medications: c.env.DB.prepare(`
      SELECT m.*, s.full_name as specialist_name_resolved
      FROM medications m
      LEFT JOIN specialists s ON m.specialist_id = s.id
      WHERE m.patient_id = ? AND m.status = 'active'
      ORDER BY m.created_at DESC
    `).bind(pid).all(),
    // status may be NULL on older rows — treat as active
    specialists: c.env.DB.prepare(`
      SELECT * FROM specialists
      WHERE patient_id = ? AND (status = 'active' OR status IS NULL OR status = '')
      ORDER BY created_at DESC
    `).bind(pid).all(),
    reminders: c.env.DB.prepare("SELECT * FROM reminders WHERE patient_id = ? AND status = 'pending' ORDER BY remind_at ASC LIMIT 10").bind(pid).all(),
    plan: c.env.DB.prepare("SELECT * FROM plan WHERE patient_id = ? AND status IN ('pending', 'in_progress') AND priority IN ('urgent', 'high') ORDER BY created_at DESC LIMIT 10").bind(pid).all(),
    errors: c.env.DB.prepare("SELECT * FROM medical_errors WHERE patient_id = ? AND status = 'open' ORDER BY created_at DESC").bind(pid).all(),
    docsCount: c.env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE patient_id = ?").bind(pid).first(),
    planTotal: c.env.DB.prepare("SELECT COUNT(*) AS count FROM plan WHERE patient_id = ? AND status != 'done'").bind(pid).first(),
    planDone: c.env.DB.prepare("SELECT COUNT(*) AS count FROM plan WHERE patient_id = ? AND status = 'done'").bind(pid).first(),
    errorsOpen: c.env.DB.prepare("SELECT COUNT(*) AS count FROM medical_errors WHERE patient_id = ? AND status = 'open'").bind(pid).first(),
    upcomingVaccinations: c.env.DB.prepare("SELECT * FROM vaccinations WHERE patient_id = ? AND status = 'scheduled' ORDER BY scheduled_date ASC LIMIT 5").bind(pid).all(),
    latestGrowth: c.env.DB.prepare("SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 1").bind(pid).first(),
    labAnomalies: c.env.DB.prepare("SELECT * FROM lab_results WHERE patient_id = ? AND status IN ('high', 'low', 'critical') ORDER BY test_date DESC LIMIT 5").bind(pid).all()
  };

  try {
    const results = await Promise.all(Object.values(queries).map(p => p));
    const keys = Object.keys(queries);
    const data = {};
    keys.forEach((key, i) => {
      data[key] = results[i];
    });

    const diags = data.diagnoses?.results || [];
    const meds = (data.medications?.results || []).map(mapMedicationRow);
    const specs = data.specialists?.results || [];
    const rems = data.reminders?.results || [];
    const planItems = (data.plan?.results || []).map(mapPlanItem);
    const errs = (data.errors?.results || []).map(mapErrorRow);

    return c.json({
      patient: normalizePatient(data.patient),
      active_diagnoses: diags,
      active_medications: meds,
      active_specialists: specs,
      upcoming_reminders: rems,
      urgent_plan_items: planItems,
      open_errors: errs,
      upcoming_vaccinations: data.upcomingVaccinations?.results || [],
      latest_growth: data.latestGrowth || null,
      lab_anomalies: data.labAnomalies?.results || [],
      stats: {
        documents: data.docsCount?.count || 0,
        plan_total: data.planTotal?.count || 0,
        plan_done: data.planDone?.count || 0,
        errors_open: data.errorsOpen?.count || 0,
        diagnoses: diags.length,
        specialists: specs.length,
        reminders: rems.length,
      },
    });
  } catch (err) {
    console.error('Dashboard Error:', err);
    throw err;
  }
});

/**
 * GET /api/dashboard/ai-summary
 */
dashboard.get('/ai-summary', async (c) => {
  const pid = c.get('patientId');
  const key = `ai_summary_${pid}`;
  const row = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
  
  const data = row ? JSON.parse(row.value) : { summary: '', updated_at: null };
  return c.json(data);
});

/**
 * PUT /api/dashboard/ai-summary
 */
dashboard.put('/ai-summary', async (c) => {
  const pid = c.get('patientId');
  const body = await c.req.json();
  const { summary, priorities, next_steps, warnings, updated_at } = body;
  
  const data = JSON.stringify({ 
    summary, priorities, next_steps, warnings, 
    updated_at: updated_at || new Date().toISOString() 
  });
  const key = `ai_summary_${pid}`;

  await c.env.DB.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, data).run();

  return c.json(JSON.parse(data));
});

export default dashboard;
