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

export default aiRequests;
