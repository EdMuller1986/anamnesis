import { Hono } from 'hono';
import { renderHistory } from '../services/changelog';

const history = new Hono();

// GET /api/history?limit=&offset=&since=
history.get('/', async (c) => {
  const pid = c.get('patientId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  const since = c.req.query('since');

  let query = 'SELECT * FROM audit_log WHERE patient_id = ?';
  const params = [pid];
  if (since) {
    query += ' AND created_at >= ?';
    params.push(since);
  }
  // Fetch one extra row to compute has_more
  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit + 1, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  const rows = results || [];
  const page = rows.slice(0, limit);
  const rendered = await renderHistory(page, { limit });
  rendered.has_more = rows.length > limit;
  return c.json(rendered);
});

export default history;
