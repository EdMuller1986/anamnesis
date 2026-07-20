import { Hono } from 'hono';

const labResults = new Hono();

labResults.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { group_by } = c.req.query();

  if (group_by === 'parameter') {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM lab_results WHERE patient_id = ? ORDER BY parameter ASC, test_date DESC'
    ).bind(patientId).all();
    
    const grouped = {};
    results.forEach(row => {
      if (!grouped[row.parameter]) grouped[row.parameter] = [];
      grouped[row.parameter].push(row);
    });
    return c.json(grouped);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_date DESC, parameter ASC'
  ).bind(patientId).all();
  return c.json(results);
});

labResults.get('/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('SELECT * FROM lab_results WHERE id = ?').bind(id).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

labResults.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { test_date, test_name, parameter, value, unit, ref_min, ref_max, status, timeline_id, specialist_id, notes } = body;

  if (!test_date || !test_name || !parameter) {
    return c.json({ error: 'Date, name and parameter are required' }, 400);
  }

  const { results } = await c.env.DB.prepare(`
    INSERT INTO lab_results (test_date, test_name, parameter, value, unit, ref_min, ref_max, status, timeline_id, specialist_id, notes, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(test_date, test_name, parameter, value, unit, ref_min, ref_max, status || 'normal', timeline_id, specialist_id || null, notes, patientId).all();

  return c.json(results[0], 201);
});

labResults.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { test_date, test_name, parameter, value, unit, ref_min, ref_max, status, timeline_id, specialist_id, notes } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE lab_results
    SET test_date = ?, test_name = ?, parameter = ?, value = ?, unit = ?, ref_min = ?, ref_max = ?, status = ?, timeline_id = ?, specialist_id = ?, notes = ?
    WHERE id = ?
    RETURNING *
  `).bind(test_date, test_name, parameter, value, unit, ref_min, ref_max, status, timeline_id, specialist_id || null, notes, id).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

labResults.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM lab_results WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

export default labResults;
