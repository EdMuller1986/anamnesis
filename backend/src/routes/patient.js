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

// PUT /api/patient — update active chart profile
patient.put('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT * FROM patient WHERE id = ?')
    .bind(patientId).first();
  if (!existing) return c.json({ error: 'Patient not found' }, 404);

  const finalName = body.full_name ?? body.name ?? existing.full_name ?? existing.name;
  const finalBirth = body.date_of_birth ?? body.birth_date ?? existing.date_of_birth ?? existing.birth_date;
  const gender = body.gender !== undefined ? body.gender : existing.gender;
  const city = body.city !== undefined ? body.city : existing.city;
  const allergies = body.allergies !== undefined ? body.allergies : existing.allergies;
  const current_height_cm = body.current_height_cm !== undefined ? body.current_height_cm : existing.current_height_cm;
  const current_weight_kg = body.current_weight_kg !== undefined ? body.current_weight_kg : existing.current_weight_kg;
  const birth_weight_g = body.birth_weight_g !== undefined ? body.birth_weight_g : existing.birth_weight_g;
  const notes = body.notes !== undefined ? body.notes : existing.notes;
  const blood_type = body.blood_type !== undefined ? body.blood_type : existing.blood_type;
  const birth_height_cm = body.birth_height_cm !== undefined ? body.birth_height_cm : existing.birth_height_cm;
  const apgar = body.apgar !== undefined ? body.apgar : existing.apgar;
  const birth_notes = body.birth_notes !== undefined ? body.birth_notes : existing.birth_notes;

  if (!finalName) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    UPDATE patient SET
      full_name = ?, name = ?,
      date_of_birth = ?, birth_date = ?,
      gender = ?, city = ?, allergies = ?,
      current_height_cm = ?, current_weight_kg = ?, birth_weight_g = ?,
      notes = ?, blood_type = ?, birth_height_cm = ?, apgar = ?, birth_notes = ?,
      updated_at = datetime('now')
    WHERE id = ?
    RETURNING *
  `).bind(
    finalName, finalName,
    finalBirth || null, finalBirth || null,
    gender || null, city || null, allergies || null,
    current_height_cm ?? null, current_weight_kg ?? null, birth_weight_g ?? null,
    notes || null, blood_type || null, birth_height_cm ?? null, apgar || null, birth_notes || null,
    patientId
  ).all();

  return c.json(results[0]);
});

export default patient;
