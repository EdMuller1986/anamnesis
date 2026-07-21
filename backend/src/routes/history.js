import { Hono } from 'hono';

const history = new Hono();

// GET /api/history
history.get('/', async (c) => {
  const pid = c.get('patientId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM audit_log WHERE patient_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(pid, limit).all();

  // Десериализуем JSON-строки из базы в объекты для фронтенда
  const parsedResults = results.map(row => {
    let oldVal = null;
    let newVal = null;
    try { if (row.old_value) oldVal = JSON.parse(row.old_value); } catch (e) {}
    try { if (row.new_value) newVal = JSON.parse(row.new_value); } catch (e) {}
    
    return {
      ...row,
      old_value: oldVal,
      new_value: newVal
    };
  });

  return c.json(parsedResults);
});

export default history;
