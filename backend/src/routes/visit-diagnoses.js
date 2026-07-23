import { Hono } from 'hono';

const visitDiagnoses = new Hono();

// GET /api/visit-diagnoses?visit_id=X or ?diagnosis_id=X
visitDiagnoses.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { visit_id, diagnosis_id } = c.req.query();
  
  let query = `
    SELECT vd.*,
           t.title as visit_title, t.event_date as visit_date,
           d.name as diagnosis_name, d.status as diagnosis_status
    FROM visit_diagnoses vd
    LEFT JOIN timeline t ON vd.visit_id = t.id
    LEFT JOIN diagnoses d ON vd.diagnosis_id = d.id
    WHERE vd.patient_id = ?
  `;
  
  const params = [patientId];

  if (visit_id) {
    query += ' AND vd.visit_id = ?';
    params.push(visit_id);
  }
  if (diagnosis_id) {
    query += ' AND vd.diagnosis_id = ?';
    params.push(diagnosis_id);
  }

  query += ' ORDER BY t.event_date DESC';

  try {
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  } catch (err) {
    console.error('Error fetching visit_diagnoses:', err);
    return c.json({ error: 'Internal error', message: err.message }, 500);
  }
});

// POST /api/visit-diagnoses
visitDiagnoses.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { visit_id, diagnosis_id, relation } = body;

  if (!visit_id || !diagnosis_id) {
    return c.json({ error: 'visit_id and diagnosis_id required' }, 400);
  }

  try {
    const { results } = await c.env.DB.prepare(`
      INSERT INTO visit_diagnoses (visit_id, diagnosis_id, relation, patient_id)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).bind(visit_id, diagnosis_id, relation || 'discussed', patientId).all();

    return c.json(results[0], 201);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return c.json({ error: 'This visit-diagnosis link already exists' }, 409);
    }
    console.error('Error creating visit_diagnosis:', err);
    return c.json({ error: 'Internal error', message: err.message }, 500);
  }
});

// DELETE /api/visit-diagnoses/:visitId/:diagnosisId
visitDiagnoses.delete('/:visitId/:diagnosisId', async (c) => {
  const visitId = c.req.param('visitId');
  const diagnosisId = c.req.param('diagnosisId');
  const patientId = c.get('patientId');

  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM visit_diagnoses WHERE visit_id = ? AND diagnosis_id = ? AND patient_id = ?'
    ).bind(visitId, diagnosisId, patientId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Link not found' }, 404);
    }
    return c.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting visit_diagnosis:', err);
    return c.json({ error: 'Internal error', message: err.message }, 500);
  }
});

export default visitDiagnoses;
