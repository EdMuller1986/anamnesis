import { Hono } from 'hono';

const patient = new Hono();

// GET /api/patient/list
patient.get('/list', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM patient ORDER BY id'
  ).all();
  return c.json(results);
});

// GET /api/patient
patient.get('/', async (c) => {
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare('SELECT * FROM patient WHERE id = ?')
    .bind(patientId)
    .first();
  
  if (!result) return c.json({ error: 'Patient not found' }, 404);
  return c.json(result);
});

// POST /api/patient
patient.post('/', async (c) => {
  const body = await c.req.json();
  const { 
    full_name, name, 
    date_of_birth, birth_date, 
    gender, city, allergies, 
    current_height_cm, current_weight_kg, birth_weight_g, 
    notes 
  } = body;

  const finalName = full_name || name;
  const finalBirthDate = date_of_birth || birth_date;

  if (!finalName) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO patient (
      full_name, name, 
      date_of_birth, birth_date, 
      gender, city, allergies, 
      current_height_cm, current_weight_kg, birth_weight_g, 
      notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
    RETURNING *
  `).bind(
    finalName, finalName, 
    finalBirthDate || null, finalBirthDate || null, 
    gender || null, city || null, allergies || null,
    current_height_cm || null, current_weight_kg || null, birth_weight_g || null,
    notes || null
  ).all();

  return c.json(results[0], 201);
});

export default patient;
