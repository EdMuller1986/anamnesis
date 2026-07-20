import { Hono } from 'hono';

const plan = new Hono();

plan.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { status, priority } = c.req.query();
  let query = 'SELECT * FROM plan WHERE patient_id = ?';
  const params = [patientId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (priority) {
    query += ' AND priority = ?';
    params.push(priority);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

plan.get('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare('SELECT * FROM plan WHERE id = ? AND patient_id = ?').bind(id, patientId).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

plan.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { title, detail, status, priority, due_date } = body;

  if (!title) return c.json({ error: 'Title is required' }, 400);

  const completed_at = (status === 'done') ? new Date().toISOString() : null;

  const { results } = await c.env.DB.prepare(`
    INSERT INTO plan (title, detail, status, priority, due_date, completed_at, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(title, detail, status || 'pending', priority || 'medium', due_date, completed_at, patientId).all();

  return c.json(results[0], 201);
});

plan.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { title, detail, status, priority, due_date, outcome } = body;

  const completed_at = (status === 'done') ? new Date().toISOString() : null;

  const { results } = await c.env.DB.prepare(`
    UPDATE plan
    SET title = ?, detail = ?, status = ?, priority = ?, due_date = ?, outcome = ?, completed_at = ?
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(title, detail, status, priority, due_date, outcome || null, completed_at, id, patientId).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

plan.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  await c.env.DB.prepare('DELETE FROM plan WHERE id = ? AND patient_id = ?').bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default plan;
