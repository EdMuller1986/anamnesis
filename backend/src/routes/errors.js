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
  const {
    title, detail, description, advice, severity, status, resolution,
    action_text, error_date, specialist_id, notes,
  } = body;
  if (!title && !description) return c.json({ error: 'title is required' }, 400);

  const finalTitle = title || description;
  const finalDetail = detail ?? description ?? null;

  const { results } = await c.env.DB.prepare(`
    INSERT INTO medical_errors (
      title, detail, description, advice, severity, status, resolution,
      action_text, error_date, specialist_id, notes, patient_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
  `).bind(
    finalTitle,
    finalDetail,
    description || finalDetail,
    advice || null,
    severity || 'medium',
    status || 'open',
    resolution || null,
    action_text || null,
    error_date || null,
    specialist_id || null,
    notes || null,
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
  const description = body.description !== undefined ? body.description : existing.description;
  const advice = body.advice !== undefined ? body.advice : existing.advice;
  const severity = body.severity !== undefined ? body.severity : existing.severity;
  const status = body.status !== undefined ? body.status : existing.status;
  const resolution = body.resolution !== undefined ? body.resolution : existing.resolution;
  const action_text = body.action_text !== undefined ? body.action_text : existing.action_text;
  const error_date = body.error_date !== undefined ? body.error_date : existing.error_date;
  const specialist_id = body.specialist_id !== undefined ? body.specialist_id : existing.specialist_id;
  const notes = body.notes !== undefined ? body.notes : existing.notes;
  const resolved_at = status === 'resolved' && !existing.resolved_at
    ? new Date().toISOString()
    : (body.resolved_at !== undefined ? body.resolved_at : existing.resolved_at);

  const { results } = await c.env.DB.prepare(`
    UPDATE medical_errors
    SET title = ?, detail = ?, description = ?, advice = ?, severity = ?, status = ?,
        resolution = ?, action_text = ?, error_date = ?, specialist_id = ?, notes = ?,
        resolved_at = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(
    title, detail, description, advice, severity, status,
    resolution, action_text, error_date, specialist_id || null, notes,
    resolved_at, id, pid
  ).all();

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
