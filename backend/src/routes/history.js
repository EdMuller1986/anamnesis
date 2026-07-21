import { Hono } from 'hono';
import { renderHistory } from '../services/changelog';

const history = new Hono();

// GET /api/history
history.get('/', async (c) => {
  const pid = c.get('patientId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM audit_log WHERE patient_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(pid, limit).all();

  const rendered = await renderHistory(results);
  return c.json(rendered);
});

export default history;
