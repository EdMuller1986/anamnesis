import { Hono } from 'hono';

const aiRequests = new Hono();

aiRequests.get('/', async (c) => {
  const pid = c.get('patientId');
  const status = c.req.query('status');
  let query = 'SELECT * FROM ai_requests WHERE patient_id = ?';
  const params = [pid];
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC';
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

// POST /api/ai-requests — create pending request (frontend createAiRequest)
aiRequests.post('/', async (c) => {
  const pid = c.get('patientId');
  const body = await c.req.json();
  const { entity_type, entity_id } = body;

  if (!entity_type || entity_id == null) {
    return c.json({ error: 'entity_type and entity_id are required' }, 400);
  }

  // Avoid duplicate pending for same entity
  const existing = await c.env.DB.prepare(
    `SELECT * FROM ai_requests
     WHERE patient_id = ? AND entity_type = ? AND entity_id = ? AND status = 'pending'
     LIMIT 1`
  ).bind(pid, entity_type, entity_id).first();

  if (existing) {
    return c.json(existing, 200);
  }

  const { results } = await c.env.DB.prepare(
    `INSERT INTO ai_requests (entity_type, entity_id, status, patient_id)
     VALUES (?, ?, 'pending', ?)
     RETURNING *`
  ).bind(entity_type, entity_id, pid).all();

  return c.json(results[0], 201);
});

// PUT /api/ai-requests/:id — complete/update (AI coordinator)
aiRequests.put('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { status, completed_at } = body;

  const { results } = await c.env.DB.prepare(
    `UPDATE ai_requests
     SET status = COALESCE(?, status),
         completed_at = COALESCE(?, completed_at)
     WHERE id = ? AND patient_id = ?
     RETURNING *`
  ).bind(
    status || null,
    completed_at || (status === 'completed' || status === 'failed' ? new Date().toISOString() : null),
    id,
    pid
  ).all();

  if (!results.length) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

// DELETE /api/ai-requests/:id
aiRequests.delete('/:id', async (c) => {
  const pid = c.get('patientId');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM ai_requests WHERE id = ? AND patient_id = ?'
  ).bind(id, pid).run();
  return c.json({ message: 'Deleted' });
});

export default aiRequests;
