const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/prescriptions — list prescriptions with joined data
router.get('/', async (req, res) => {
  try {
    const { medication_id, diagnosis_id } = req.query;
    const conditions = ['p.patient_id = $1'];
    const params = [req.patientId];
    let paramIndex = 2;

    if (medication_id) {
      conditions.push(`p.medication_id = $${paramIndex++}`);
      params.push(medication_id);
    }
    if (diagnosis_id) {
      conditions.push(`p.diagnosis_id = $${paramIndex++}`);
      params.push(diagnosis_id);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await pool.query(
      `SELECT p.*,
              m.name as medication_name, m.dosage,
              d.name as diagnosis_name,
              s.full_name as specialist_name, s.specialization as specialty,
              t.title as visit_title, t.event_date as visit_date
       FROM prescriptions p
       LEFT JOIN medications m ON p.medication_id = m.id
       LEFT JOIN diagnoses d ON p.diagnosis_id = d.id
       LEFT JOIN specialists s ON p.specialist_id = s.id
       LEFT JOIN timeline t ON p.timeline_id = t.id
       ${where}
       ORDER BY p.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching prescriptions:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/prescriptions
router.post('/', async (req, res) => {
  try {
    const { medication_id, diagnosis_id, specialist_id, timeline_id, rationale } = req.body;
    if (!medication_id) {
      return res.status(400).json({ error: 'medication_id required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO prescriptions (medication_id, diagnosis_id, specialist_id, timeline_id, rationale, patient_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [medication_id, diagnosis_id || null, specialist_id || null, timeline_id || null, rationale || null, req.patientId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating prescription:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// PUT /api/prescriptions/:id
router.put('/:id', async (req, res) => {
  try {
    const { medication_id, diagnosis_id, specialist_id, timeline_id, rationale } = req.body;
    const { rows } = await pool.query(
      `UPDATE prescriptions
       SET medication_id = $1, diagnosis_id = $2, specialist_id = $3,
           timeline_id = $4, rationale = $5
       WHERE id = $6
       RETURNING *`,
      [medication_id, diagnosis_id || null, specialist_id || null, timeline_id || null, rationale || null, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Prescription not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating prescription:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// DELETE /api/prescriptions/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM prescriptions WHERE id = $1', [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Prescription not found' });
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting prescription:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
