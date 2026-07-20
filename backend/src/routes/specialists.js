import { Hono } from 'hono';

const specialists = new Hono();

specialists.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM specialists WHERE patient_id = ? ORDER BY full_name ASC'
  ).bind(patientId).all();
  return c.json(results);
});

specialists.get('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare('SELECT * FROM specialists WHERE id = ? AND patient_id = ?').bind(id, patientId).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

specialists.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { full_name, specialization, clinic, contact_info, notes } = body;

  if (!full_name) return c.json({ error: 'Full name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO specialists (full_name, specialization, clinic, contact_info, notes, patient_id)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(full_name, specialization, clinic, contact_info, notes, patientId).all();

  return c.json(results[0], 201);
});

specialists.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { full_name, specialization, clinic, contact_info, notes } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE specialists
    SET full_name = ?, specialization = ?, clinic = ?, contact_info = ?, notes = ?
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(full_name, specialization, clinic, contact_info, notes, id, patientId).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

specialists.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  await c.env.DB.prepare('DELETE FROM specialists WHERE id = ? AND patient_id = ?').bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default specialists;
