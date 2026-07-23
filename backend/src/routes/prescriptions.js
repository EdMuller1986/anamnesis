import { Hono } from 'hono';

const prescriptions = new Hono();

// GET /api/prescriptions — list prescriptions with joined data
prescriptions.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { medication_id, diagnosis_id } = c.req.query();
  
  let query = `
    SELECT p.*,
           m.name as medication_name, m.dosage,
           d.name as diagnosis_name,
           s.full_name as specialist_name, s.specialization as specialty,
           t.title as visit_title, t.event_date as visit_date
    FROM prescriptions p
    LEFT JOIN medications m ON p.medication_id = m.id
    LEFT JOIN diagnoses d ON p.diagnosis_id = d.id
    LEFT JOIN specialists s ON p.specialist_id = s.id
    LEFT JOIN timeline t ON p.timeline_id = t.id
    WHERE p.patient_id = ?
  `;
  
  const params = [patientId];

  if (medication_id) {
    query += ' AND p.medication_id = ?';
    params.push(medication_id);
  }
  if (diagnosis_id) {
    query += ' AND p.diagnosis_id = ?';
    params.push(diagnosis_id);
  }

  query += ' ORDER BY p.created_at DESC';

  try {
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  } catch (err) {
    console.error('Error fetching prescriptions:', err);
    return c.json({ error: 'Internal error', message: err.message }, 500);
  }
});

// POST /api/prescriptions
prescriptions.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { 
    medication_id, diagnosis_id, specialist_id, timeline_id, rationale,
    dosage, frequency, start_date, end_date, course_status, stop_reason, duration_text
  } = body;

  if (!medication_id) {
    return c.json({ error: 'medication_id required' }, 400);
  }

  try {
    const { results } = await c.env.DB.prepare(`
      INSERT INTO prescriptions (
        medication_id, diagnosis_id, specialist_id, timeline_id, rationale, patient_id,
        dosage, frequency, start_date, end_date, course_status, stop_reason, duration_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(
      medication_id, 
      diagnosis_id || null, 
      specialist_id || null, 
      timeline_id || null, 
      rationale || null, 
      patientId,
      dosage || null,
      frequency || null,
      start_date || null,
      end_date || null,
      course_status || 'active',
      stop_reason || null,
      duration_text || null
    ).all();

    return c.json(results[0], 201);
  } catch (err) {
    console.error('Error creating prescription:', err);
    return c.json({ error: 'Internal error', message: err.message }, 500);
  }
});

// PUT /api/prescriptions/:id
prescriptions.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { 
    medication_id, diagnosis_id, specialist_id, timeline_id, rationale,
    dosage, frequency, start_date, end_date, course_status, stop_reason, duration_text
  } = body;

  try {
    const { results } = await c.env.DB.prepare(`
      UPDATE prescriptions
      SET medication_id = ?, diagnosis_id = ?, specialist_id = ?,
          timeline_id = ?, rationale = ?,
          dosage = ?, frequency = ?, start_date = ?, end_date = ?, 
          course_status = ?, stop_reason = ?, duration_text = ?
      WHERE id = ? AND patient_id = ?
      RETURNING *
    `).bind(
      medication_id, 
      diagnosis_id || null, 
      specialist_id || null, 
      timeline_id || null, 
      rationale || null,
      dosage || null,
      frequency || null,
      start_date || null,
      end_date || null,
      course_status || 'active',
      stop_reason || null,
      duration_text || null,
      id, 
      patientId
    ).all();

    if (results.length === 0) {
      return c.json({ error: 'Prescription not found' }, 404);
    }
    return c.json(results[0]);
  } catch (err) {
    console.error('Error updating prescription:', err);
    return c.json({ error: 'Internal error', message: err.message }, 500);
  }
});

// DELETE /api/prescriptions/:id
prescriptions.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');

  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM prescriptions WHERE id = ? AND patient_id = ?'
    ).bind(id, patientId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Prescription not found' }, 404);
    }
    return c.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting prescription:', err);
    return c.json({ error: 'Internal error', message: err.message }, 500);
  }
});

export default prescriptions;
