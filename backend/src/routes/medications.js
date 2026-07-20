import { Hono } from 'hono';

const medications = new Hono();

medications.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { status } = c.req.query();
  
  let query = `
    SELECT m.*, s.full_name as specialist_name_resolved, s.specialization as specialist_specialty
    FROM medications m
    LEFT JOIN specialists s ON m.specialist_id = s.id
    WHERE m.patient_id = ?
  `;
  const params = [patientId];

  if (status) {
    query += ' AND m.status = ?';
    params.push(status);
  }

  query += ' ORDER BY m.created_at DESC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

medications.get('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare('SELECT * FROM medications WHERE id = ? AND patient_id = ?').bind(id, patientId).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

medications.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { name, dosage, frequency, status, specialist_id, detail } = body;

  if (!name) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO medications (name, dosage, frequency, status, specialist_id, detail, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(name, dosage, frequency, status || 'active', specialist_id || null, detail, patientId).all();

  return c.json(results[0], 201);
});

medications.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { name, dosage, frequency, status, specialist_id, detail } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE medications
    SET name = ?, dosage = ?, frequency = ?, status = ?, specialist_id = ?, detail = ?
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(name, dosage, frequency, status, specialist_id || null, detail, id, patientId).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

medications.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  await c.env.DB.prepare('DELETE FROM medications WHERE id = ? AND patient_id = ?').bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default medications;
