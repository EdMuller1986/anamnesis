import { Hono } from 'hono';

const medicalErrors = new Hono();

medicalErrors.get('/', async (c) => {
  const pid = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM medical_errors WHERE patient_id = ? ORDER BY created_at DESC'
  ).bind(pid).all();
  return c.json(results);
});

medicalErrors.get('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT * FROM medical_errors WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

medicalErrors.post('/', async (c) => {
  const pid = c.get('patientId');
  const body = await c.req.json();
  const { title, detail, advice, severity, status, resolution } = body;
  if (!title) return c.json({ error: 'title is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO medical_errors (title, detail, advice, severity, status, resolution, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
  `).bind(
    title,
    detail || null,
    advice || null,
    severity || 'medium',
    status || 'open',
    resolution || null,
    pid
  ).all();
  return c.json(results[0], 201);
});

// PUT /api/errors/:id — frontend updateError
medicalErrors.put('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM medical_errors WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const title = body.title !== undefined ? body.title : existing.title;
  const detail = body.detail !== undefined ? body.detail : existing.detail;
  const advice = body.advice !== undefined ? body.advice : existing.advice;
  const severity = body.severity !== undefined ? body.severity : existing.severity;
  const status = body.status !== undefined ? body.status : existing.status;
  const resolution = body.resolution !== undefined ? body.resolution : existing.resolution;
  const resolved_at = status === 'resolved' && !existing.resolved_at
    ? new Date().toISOString()
    : (body.resolved_at !== undefined ? body.resolved_at : existing.resolved_at);

  const { results } = await c.env.DB.prepare(`
    UPDATE medical_errors
    SET title = ?, detail = ?, advice = ?, severity = ?, status = ?, resolution = ?, resolved_at = ?,
        updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(title, detail, advice, severity, status, resolution, resolved_at, id, pid).all();

  if (!results.length) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

medicalErrors.delete('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM medical_errors WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).run();
  return c.json({ message: 'Deleted' });
});

export default medicalErrors;
