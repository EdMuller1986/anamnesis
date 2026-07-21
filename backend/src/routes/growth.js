import { Hono } from 'hono';

const growth = new Hono();

// GET /api/growth
growth.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC'
  ).bind(patientId).all();
  return c.json(results);
});

// GET /api/growth/:id
growth.get('/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('SELECT * FROM growth_log WHERE id = ?').bind(id).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

// POST /api/growth
growth.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { measured_at, height_cm, weight_kg, head_circumference_cm, notes } = body;

  if (!measured_at) return c.json({ error: 'measured_at required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO growth_log (measured_at, height_cm, weight_kg, head_circumference_cm, notes, patient_id)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(measured_at, height_cm, weight_kg, head_circumference_cm, notes, patientId).all();

  return c.json(results[0], 201);
});

// PUT /api/growth/:id
growth.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { measured_at, height_cm, weight_kg, head_circumference_cm, notes } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE growth_log
    SET measured_at = ?, height_cm = ?, weight_kg = ?, head_circumference_cm = ?, notes = ?
    WHERE id = ?
    RETURNING *
  `).bind(measured_at, height_cm, weight_kg, head_circumference_cm, notes, id).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

// DELETE /api/growth/:id
growth.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM growth_log WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

export default growth;
