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
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare(
    'SELECT * FROM growth_log WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
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

  // Keep patient profile in sync with latest measurement (upstream behavior)
  if (height_cm != null || weight_kg != null) {
    const sets = ["updated_at = datetime('now')"];
    const vals = [];
    if (height_cm != null) {
      sets.push('current_height_cm = ?');
      vals.push(height_cm);
    }
    if (weight_kg != null) {
      sets.push('current_weight_kg = ?');
      vals.push(weight_kg);
    }
    vals.push(patientId);
    await c.env.DB.prepare(
      `UPDATE patient SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...vals).run();
  }

  return c.json(results[0], 201);
});

// PUT /api/growth/:id
growth.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { measured_at, height_cm, weight_kg, head_circumference_cm, notes } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE growth_log
    SET measured_at = ?, height_cm = ?, weight_kg = ?, head_circumference_cm = ?, notes = ?
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(measured_at, height_cm, weight_kg, head_circumference_cm, notes, id, patientId).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

// DELETE /api/growth/:id
growth.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  await c.env.DB.prepare(
    'DELETE FROM growth_log WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default growth;
