import { Hono } from 'hono';

const reminders = new Hono();

reminders.get('/', async (c) => {
  const pid = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM reminders WHERE patient_id = ? ORDER BY remind_at ASC'
  ).bind(pid).all();
  return c.json(results);
});

reminders.get('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT * FROM reminders WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

reminders.post('/', async (c) => {
  const pid = c.get('patientId');
  const body = await c.req.json();
  const { title, remind_at, status, message, recurring, notes } = body;
  if (!title || !remind_at) {
    return c.json({ error: 'title and remind_at are required' }, 400);
  }

  const { results } = await c.env.DB.prepare(`
    INSERT INTO reminders (title, remind_at, status, message, recurring, notes, patient_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    RETURNING *
  `).bind(
    title,
    remind_at,
    status || 'pending',
    message || null,
    recurring || null,
    notes || null,
    pid
  ).all();
  return c.json(results[0], 201);
});

reminders.put('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM reminders WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const title = body.title !== undefined ? body.title : existing.title;
  const remind_at = body.remind_at !== undefined ? body.remind_at : existing.remind_at;
  const status = body.status !== undefined ? body.status : existing.status;
  const message = body.message !== undefined ? body.message : existing.message;
  const recurring = body.recurring !== undefined ? body.recurring : existing.recurring;
  const notes = body.notes !== undefined ? body.notes : existing.notes;
  const sent_at = body.sent_at !== undefined ? body.sent_at : existing.sent_at;

  const { results } = await c.env.DB.prepare(`
    UPDATE reminders
    SET title = ?, remind_at = ?, status = ?, message = ?, recurring = ?, notes = ?,
        sent_at = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(title, remind_at, status, message, recurring, notes, sent_at, id, pid).all();

  if (!results.length) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

reminders.delete('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM reminders WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).run();
  return c.json({ message: 'Deleted' });
});

export default reminders;
