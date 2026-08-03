import { Hono } from 'hono';

const medications = new Hono();

function mapMedication(row) {
  if (!row) return row;
  return {
    ...row,
    // FE expects prescribed_by string; also expose resolved specialist name
    prescribed_by: row.prescribed_by || row.specialist_name_resolved || null,
    prescribed_by_name: row.specialist_name_resolved || null,
    prescribed_by_spec: row.specialist_specialty || null,
  };
}

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
  return c.json((results || []).map(mapMedication));
});

medications.get('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare(`
    SELECT m.*, s.full_name as specialist_name_resolved, s.specialization as specialist_specialty
    FROM medications m
    LEFT JOIN specialists s ON m.specialist_id = s.id
    WHERE m.id = ? AND m.patient_id = ?
  `).bind(id, patientId).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(mapMedication(result));
});

medications.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const {
    name, dosage, frequency, status, specialist_id, detail,
    prescribed_by, start_date, end_date, notes,
  } = body;

  if (!name) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO medications (name, dosage, frequency, status, specialist_id, detail, prescribed_by, start_date, end_date, notes, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    name,
    dosage || null,
    frequency || null,
    status || 'active',
    specialist_id || null,
    detail || null,
    prescribed_by || null,
    start_date || null,
    end_date || null,
    notes || null,
    patientId
  ).all();

  return c.json(mapMedication(results[0]), 201);
});

medications.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM medications WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = body.name !== undefined ? body.name : existing.name;
  const dosage = body.dosage !== undefined ? body.dosage : existing.dosage;
  const frequency = body.frequency !== undefined ? body.frequency : existing.frequency;
  const status = body.status !== undefined ? body.status : existing.status;
  const specialist_id = body.specialist_id !== undefined ? body.specialist_id : existing.specialist_id;
  const detail = body.detail !== undefined ? body.detail : existing.detail;
  const prescribed_by = body.prescribed_by !== undefined ? body.prescribed_by : existing.prescribed_by;
  const start_date = body.start_date !== undefined ? body.start_date : existing.start_date;
  const end_date = body.end_date !== undefined ? body.end_date : existing.end_date;
  const notes = body.notes !== undefined ? body.notes : existing.notes;

  const { results } = await c.env.DB.prepare(`
    UPDATE medications
    SET name = ?, dosage = ?, frequency = ?, status = ?, specialist_id = ?, detail = ?,
        prescribed_by = ?, start_date = ?, end_date = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(
    name, dosage, frequency, status, specialist_id || null, detail,
    prescribed_by, start_date, end_date, notes, id, patientId
  ).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(mapMedication(results[0]));
});

medications.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  await c.env.DB.prepare('DELETE FROM medications WHERE id = ? AND patient_id = ?').bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default medications;
