import { Hono } from 'hono';

const patient = new Hono();

// GET /api/patient/list
patient.get('/list', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, birth_date, gender, created_at FROM patient ORDER BY id'
  ).all();
  return c.json(results);
});

// GET /api/patient
patient.get('/', async (c) => {
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare('SELECT * FROM patient WHERE id = ?')
    .bind(patientId)
    .first();
  
  if (!result) return c.json({ error: 'Patient not found' }, 404);
  return c.json(result);
});

// POST /api/patient
patient.post('/', async (c) => {
  const body = await c.req.json();
  const { name, birth_date, gender } = body;

  if (!name) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(
    'INSERT INTO patient (name, birth_date, gender) VALUES (?, ?, ?) RETURNING *'
  ).bind(name, birth_date || null, gender || null).all();

  return c.json(results[0], 201);
});

export default patient;
