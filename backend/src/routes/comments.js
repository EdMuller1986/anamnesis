import { Hono } from 'hono';

const comments = new Hono();

comments.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { entity_type, entity_id, limit, order } = c.req.query();
  
  const conditions = [`patient_id = ?`];
  const params = [patientId];

  if (entity_type) {
    conditions.push(`entity_type = ?`);
    params.push(entity_type);
  }
  if (entity_id) {
    conditions.push(`entity_id = ?`);
    params.push(entity_id);
  }

  const direction = String(order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  let query = 'SELECT * FROM comments WHERE ' + conditions.join(' AND ') + ` ORDER BY created_at ${direction}`;

  const parsedLimit = parseInt(limit, 10);
  if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
    query += ` LIMIT ${parsedLimit}`;
  }

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

comments.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { entity_type, entity_id, text, author } = body;

  if (!entity_type || entity_id == null || !text) {
    return c.json({ error: 'entity_type, entity_id, text required' }, 400);
  }

  const authorValue = author === 'ai' ? 'ai' : 'user';
  const { results } = await c.env.DB.prepare(
    'INSERT INTO comments (entity_type, entity_id, text, author, patient_id) VALUES (?, ?, ?, ?, ?) RETURNING *'
  ).bind(entity_type, entity_id, text, authorValue, patientId).all();

  return c.json(results[0], 201);
});

comments.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

export default comments;
