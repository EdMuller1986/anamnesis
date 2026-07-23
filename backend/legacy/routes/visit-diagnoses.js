const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/visit-diagnoses?visit_id=X or ?diagnosis_id=X
router.get('/', async (req, res) => {
  try {
    const { visit_id, diagnosis_id } = req.query;
    const conditions = ['vd.patient_id = $1'];
    const params = [req.patientId];
    let paramIndex = 2;

    if (visit_id) {
      conditions.push(`vd.visit_id = $${paramIndex++}`);
      params.push(visit_id);
    }
    if (diagnosis_id) {
      conditions.push(`vd.diagnosis_id = $${paramIndex++}`);
      params.push(diagnosis_id);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await pool.query(
      `SELECT vd.*,
              t.title as visit_title, t.event_date as visit_date,
              d.name as diagnosis_name, d.status as diagnosis_status
       FROM visit_diagnoses vd
       LEFT JOIN timeline t ON vd.visit_id = t.id
       LEFT JOIN diagnoses d ON vd.diagnosis_id = d.id
       ${where}
       ORDER BY t.event_date DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching visit_diagnoses:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/visit-diagnoses
router.post('/', async (req, res) => {
  try {
    const { visit_id, diagnosis_id, relation } = req.body;
    if (!visit_id || !diagnosis_id) {
      return res.status(400).json({ error: 'visit_id and diagnosis_id required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO visit_diagnoses (visit_id, diagnosis_id, relation, patient_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [visit_id, diagnosis_id, relation || 'discussed', req.patientId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'This visit-diagnosis link already exists' });
    }
    console.error('Error creating visit_diagnosis:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// DELETE /api/visit-diagnoses/:visitId/:diagnosisId
router.delete('/:visitId/:diagnosisId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM visit_diagnoses WHERE visit_id = $1 AND diagnosis_id = $2',
      [req.params.visitId, req.params.diagnosisId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting visit_diagnosis:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
