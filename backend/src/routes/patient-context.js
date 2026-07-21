import { Hono } from 'hono';

const patientContext = new Hono();

/**
 * GET /api/patient-context
 * Собирает ВСЕ данные пациента для построения графа здоровья и AI-анализа.
 */
patientContext.get('/', async (c) => {
  const pid = c.get('patientId');

  const queries = {
    diagnoses: c.env.DB.prepare('SELECT * FROM diagnoses WHERE patient_id = ?').bind(pid).all(),
    specialists: c.env.DB.prepare('SELECT * FROM specialists WHERE patient_id = ?').bind(pid).all(),
    medications: c.env.DB.prepare('SELECT * FROM medications WHERE patient_id = ?').bind(pid).all(),
    timeline: c.env.DB.prepare('SELECT id, title, event_date, specialist_id FROM timeline WHERE patient_id = ?').bind(pid).all(),
    prescriptions: c.env.DB.prepare('SELECT * FROM prescriptions WHERE patient_id = ?').bind(pid).all(),
    visit_diagnoses: c.env.DB.prepare('SELECT * FROM visit_diagnoses WHERE patient_id = ?').bind(pid).all(),
    medical_errors: c.env.DB.prepare('SELECT * FROM medical_errors WHERE patient_id = ?').bind(pid).all(),
  };

  try {
    const results = await Promise.all(Object.values(queries).map(p => p));
    const keys = Object.keys(queries);
    const data = {};
    keys.forEach((key, i) => {
      data[key] = results[i].results;
    });

    return c.json(data);
  } catch (err) {
    console.error('Patient Context Error:', err);
    return c.json({ error: 'Failed to fetch patient context', message: err.message }, 500);
  }
});

export default patientContext;
