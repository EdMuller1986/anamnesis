import { Hono } from 'hono';

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
    medications: c.env.DB.prepare("SELECT * FROM medications WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC").bind(pid).all(),
    specialists: c.env.DB.prepare("SELECT * FROM specialists WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC").bind(pid).all(),
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

    return c.json({
      patient: data.patient || null,
      active_diagnoses: data.diagnoses.results,
      active_medications: data.medications.results,
      active_specialists: data.specialists.results,
      upcoming_reminders: data.reminders.results,
      urgent_plan_items: data.plan.results,
      open_errors: data.errors.results,
      upcoming_vaccinations: data.upcomingVaccinations.results,
      latest_growth: data.latestGrowth || null,
      lab_anomalies: data.labAnomalies.results,
      stats: {
        documents: data.docsCount?.count || 0,
        plan_total: data.planTotal?.count || 0,
        plan_done: data.planDone?.count || 0,
        errors_open: data.errorsOpen?.count || 0,
        diagnoses: data.diagnoses.results.length,
        specialists: data.specialists.results.length,
        reminders: data.reminders.results.length,
      },
    });
  } catch (err) {
    console.error('Dashboard Error:', err);
    throw err; // Проброс в глобальный обработчик (app.onError)
  }
});

/**
 * GET /api/dashboard/ai-summary
 * Получить последнюю сгенерированную ИИ-сводку по состоянию здоровья.
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
 * Обновить ИИ-сводку (вызывается ИИ-координатором после анализа).
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
