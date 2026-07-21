import { Hono } from 'hono';

const medicalErrors = new Hono();

medicalErrors.get('/', async (c) => {
  const pid = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM medical_errors WHERE patient_id = ? ORDER BY created_at DESC'
  ).bind(pid).all();
  return c.json(results);
});

medicalErrors.post('/', async (c) => {
  const pid = c.get('patientId');
  const body = await c.req.json();
  const { title, detail, advice, severity, status } = body;
  const { results } = await c.env.DB.prepare(`
    INSERT INTO medical_errors (title, detail, advice, severity, status, patient_id)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING *
  `).bind(title, detail, advice, severity || 'medium', status || 'open', pid).all();
  return c.json(results[0], 201);
});

export default medicalErrors;
