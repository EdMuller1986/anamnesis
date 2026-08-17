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

// POST /api/reminders/:id/send-now — mark as sent + optional Telegram notify
reminders.post('/:id/send-now', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM reminders WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const now = new Date().toISOString();
  const { results } = await c.env.DB.prepare(`
    UPDATE reminders
    SET status = 'sent', sent_at = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(now, id, pid).all();

  let telegram = null;
  try {
    const tg = await import('../services/telegram.js');
    const text = `<b>Напоминание</b>\n${existing.title || ''}`
      + (existing.message ? `\n${existing.message}` : '')
      + (existing.notes ? `\n\n${existing.notes}` : '');
    telegram = await tg.sendMessage(c.env, text);
  } catch (e) {
    telegram = { ok: false, reason: e.message };
  }

  return c.json({
    reminder: results[0],
    telegram,
  });
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
