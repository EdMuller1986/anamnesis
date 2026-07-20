import { Hono } from 'hono';

const patient = new Hono();

// GET /api/patient/list
patient.get('/list', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, created_at FROM patient ORDER BY id'
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
  const { name } = body;

  if (!name) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(
    'INSERT INTO patient (name) VALUES (?) RETURNING *'
  ).bind(name).all();

  return c.json(results[0], 201);
});

export default patient;
