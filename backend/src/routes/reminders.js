import { Hono } from 'hono';

const reminders = new Hono();

reminders.get('/', async (c) => {
  const pid = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM reminders WHERE patient_id = ? ORDER BY remind_at ASC'
  ).bind(pid).all();
  return c.json(results);
});

reminders.post('/', async (c) => {
  const pid = c.get('patientId');
  const body = await c.req.json();
  const { title, remind_at, status } = body;
  const { results } = await c.env.DB.prepare(`
    INSERT INTO reminders (title, remind_at, status, patient_id)
    VALUES (?, ?, ?, ?) RETURNING *
  `).bind(title, remind_at, status || 'pending', pid).all();
  return c.json(results[0], 201);
});

export default reminders;
