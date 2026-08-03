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
  const { full_name, specialization, clinic, contact_info, notes, phone, email, status } = body;

  if (!full_name) return c.json({ error: 'Full name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO specialists (full_name, specialization, clinic, contact_info, notes, phone, email, status, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    full_name, specialization, clinic, contact_info, notes,
    phone || null, email || null, status || 'active', patientId
  ).all();

  return c.json(results[0], 201);
});

specialists.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const existing = await c.env.DB.prepare(
    'SELECT * FROM specialists WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const full_name = body.full_name !== undefined ? body.full_name : existing.full_name;
  const specialization = body.specialization !== undefined ? body.specialization : existing.specialization;
  const clinic = body.clinic !== undefined ? body.clinic : existing.clinic;
  const contact_info = body.contact_info !== undefined ? body.contact_info : existing.contact_info;
  const notes = body.notes !== undefined ? body.notes : existing.notes;
  const phone = body.phone !== undefined ? body.phone : existing.phone;
  const email = body.email !== undefined ? body.email : existing.email;
  const status = body.status !== undefined ? body.status : existing.status;

  const { results } = await c.env.DB.prepare(`
    UPDATE specialists
    SET full_name = ?, specialization = ?, clinic = ?, contact_info = ?, notes = ?,
        phone = ?, email = ?, status = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(
    full_name, specialization, clinic, contact_info, notes,
    phone, email, status || 'active', id, patientId
  ).all();

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
