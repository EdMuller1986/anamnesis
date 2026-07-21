import { Hono } from 'hono';

const history = new Hono();

history.get('/', async (c) => {
  const pid = c.get('patientId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM audit_log WHERE patient_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(pid, limit).all();
  return c.json(results);
});

export default history;
