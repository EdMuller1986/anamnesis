import { Hono } from 'hono';

const diagnoses = new Hono();

diagnoses.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { status } = c.req.query();
  let query = 'SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY created_at DESC';
  const params = [patientId];

  if (status) {
    query = 'SELECT * FROM diagnoses WHERE patient_id = ? AND status = ? ORDER BY created_at DESC';
    params.push(status);
  }

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

diagnoses.get('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare('SELECT * FROM diagnoses WHERE id = ? AND patient_id = ?').bind(id, patientId).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

diagnoses.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { name, icd_code, status, detail, diagnosed_date, source, notes } = body;

  if (!name) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO diagnoses (name, icd_code, status, detail, diagnosed_date, source, notes, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    name,
    icd_code || null,
    status || 'active',
    detail || null,
    diagnosed_date || null,
    source || null,
    notes || null,
    patientId
  ).all();

  return c.json(results[0], 201);
});

diagnoses.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM diagnoses WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = body.name !== undefined ? body.name : existing.name;
  const icd_code = body.icd_code !== undefined ? body.icd_code : existing.icd_code;
  const status = body.status !== undefined ? body.status : existing.status;
  const detail = body.detail !== undefined ? body.detail : existing.detail;
  const diagnosed_date = body.diagnosed_date !== undefined ? body.diagnosed_date : existing.diagnosed_date;
  const source = body.source !== undefined ? body.source : existing.source;
  const notes = body.notes !== undefined ? body.notes : existing.notes;

  const { results } = await c.env.DB.prepare(`
    UPDATE diagnoses
    SET name = ?, icd_code = ?, status = ?, detail = ?, diagnosed_date = ?, source = ?, notes = ?,
        updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(name, icd_code, status, detail, diagnosed_date, source, notes, id, patientId).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

diagnoses.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  await c.env.DB.prepare('DELETE FROM diagnoses WHERE id = ? AND patient_id = ?').bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default diagnoses;
