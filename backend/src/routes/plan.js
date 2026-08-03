import { Hono } from 'hono';

const plan = new Hono();

/** Map DB row → FE PlanItem (deadline, description aliases). */
function mapPlan(row) {
  if (!row) return row;
  return {
    ...row,
    description: row.description ?? row.detail ?? null,
    deadline: row.due_date ?? null,
    sort_order: row.sort_order ?? 0,
  };
}

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

  query += ' ORDER BY COALESCE(sort_order, 0) ASC, created_at DESC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json((results || []).map(mapPlan));
});

// PUT /api/plan/reorder — must be before /:id
plan.put('/reorder', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const order = body.order || body.ids;
  if (!Array.isArray(order) || order.length === 0) {
    return c.json({ error: 'order array required' }, 400);
  }

  const batch = order.map((id, index) =>
    c.env.DB.prepare(
      `UPDATE plan SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND patient_id = ?`
    ).bind(index, id, patientId)
  );
  await c.env.DB.batch(batch);
  return c.json({ ok: true, count: order.length });
});

plan.get('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare('SELECT * FROM plan WHERE id = ? AND patient_id = ?').bind(id, patientId).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(mapPlan(result));
});

plan.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const title = body.title;
  const detail = body.detail ?? body.description ?? null;
  const description = body.description ?? body.detail ?? null;
  const status = body.status || 'pending';
  const priority = body.priority || 'medium';
  const due_date = body.due_date ?? body.deadline ?? null;
  const sort_order = body.sort_order ?? 0;
  const notes = body.notes || null;

  if (!title) return c.json({ error: 'Title is required' }, 400);

  const completed_at = (status === 'done') ? new Date().toISOString() : null;

  const { results } = await c.env.DB.prepare(`
    INSERT INTO plan (title, detail, description, status, priority, due_date, completed_at, sort_order, notes, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(title, detail, description, status, priority, due_date, completed_at, sort_order, notes, patientId).all();

  return c.json(mapPlan(results[0]), 201);
});

plan.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM plan WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const title = body.title !== undefined ? body.title : existing.title;
  const detail = body.detail !== undefined ? body.detail : (body.description !== undefined ? body.description : existing.detail);
  const description = body.description !== undefined ? body.description : (existing.description ?? detail);
  const status = body.status !== undefined ? body.status : existing.status;
  const priority = body.priority !== undefined ? body.priority : existing.priority;
  const due_date = body.due_date !== undefined ? body.due_date : (body.deadline !== undefined ? body.deadline : existing.due_date);
  const outcome = body.outcome !== undefined ? body.outcome : existing.outcome;
  const sort_order = body.sort_order !== undefined ? body.sort_order : existing.sort_order;
  const notes = body.notes !== undefined ? body.notes : existing.notes;
  const completed_at = (status === 'done')
    ? (existing.completed_at || new Date().toISOString())
    : (status && status !== 'done' ? null : existing.completed_at);

  const { results } = await c.env.DB.prepare(`
    UPDATE plan
    SET title = ?, detail = ?, description = ?, status = ?, priority = ?, due_date = ?,
        outcome = ?, completed_at = ?, sort_order = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(
    title, detail, description, status, priority, due_date,
    outcome || null, completed_at, sort_order ?? 0, notes, id, patientId
  ).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(mapPlan(results[0]));
});

plan.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  await c.env.DB.prepare('DELETE FROM plan WHERE id = ? AND patient_id = ?').bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default plan;
