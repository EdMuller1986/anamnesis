import { Hono } from 'hono';
import * as b2 from '../services/b2-storage';

const vaccinations = new Hono();

// GET /api/vaccinations
vaccinations.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { status } = c.req.query();
  
  let query = 'SELECT * FROM vaccinations WHERE patient_id = ? ORDER BY scheduled_date ASC';
  const params = [patientId];

  if (status) {
    query = 'SELECT * FROM vaccinations WHERE patient_id = ? AND status = ? ORDER BY scheduled_date ASC';
    params.push(status);
  }

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  
  const parsedResults = results.map(row => ({
    ...row,
    photos: JSON.parse(row.photos || '[]')
  }));
  
  return c.json(parsedResults);
});

// GET /api/vaccinations/:id
vaccinations.get('/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('SELECT * FROM vaccinations WHERE id = ?').bind(id).first();
  
  if (!result) return c.json({ error: 'Not found' }, 404);
  
  return c.json({
    ...result,
    photos: JSON.parse(result.photos || '[]')
  });
});

// POST /api/vaccinations
vaccinations.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { name, vaccine_name, dose_number, scheduled_date, actual_date, status, administered_by, batch_number, reaction, notes } = body;

  if (!name) return c.json({ error: 'Name is required' }, 400);

  const { results } = await c.env.DB.prepare(`
    INSERT INTO vaccinations (name, vaccine_name, dose_number, scheduled_date, actual_date, status, administered_by, batch_number, reaction, notes, patient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(name, vaccine_name, dose_number || 1, scheduled_date, actual_date, status || 'scheduled', administered_by, batch_number, reaction, notes, patientId).all();

  const vac = results[0];
  return c.json({ ...vac, photos: JSON.parse(vac.photos || '[]') }, 201);
});

// PUT /api/vaccinations/:id
vaccinations.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, vaccine_name, dose_number, scheduled_date, actual_date, status, administered_by, batch_number, reaction, notes } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE vaccinations
    SET name = ?, vaccine_name = ?, dose_number = ?, scheduled_date = ?,
        actual_date = ?, status = ?, administered_by = ?, batch_number = ?,
        reaction = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
    RETURNING *
  `).bind(name, vaccine_name, dose_number, scheduled_date, actual_date, status, administered_by, batch_number, reaction, notes, id).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  
  const vac = results[0];
  return c.json({ ...vac, photos: JSON.parse(vac.photos || '[]') });
});

// POST /api/vaccinations/:id/photos
vaccinations.post('/:id/photos', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const file = body.photo;

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'Photo is required' }, 400);
  }

  const vac = await c.env.DB.prepare('SELECT photos FROM vaccinations WHERE id = ?').bind(id).first();
  if (!vac) return c.json({ error: 'Not found' }, 404);

  const fileName = `vaccinations/${crypto.randomUUID()}-${file.name}`;
  await b2.uploadFile(c.env, fileName, await file.arrayBuffer(), file.type);

  let photos = JSON.parse(vac.photos || '[]');
  photos.push(fileName);

  await c.env.DB.prepare('UPDATE vaccinations SET photos = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(JSON.stringify(photos), id).run();

  return c.json({ photos, added: fileName });
});

// DELETE /api/vaccinations/:id
vaccinations.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const vac = await c.env.DB.prepare('SELECT photos FROM vaccinations WHERE id = ?').bind(id).first();
  
  if (vac) {
    const photos = JSON.parse(vac.photos || '[]');
    for (const photoPath of photos) {
      try { await b2.deleteFile(c.env, photoPath); } catch (e) {}
    }
  }

  await c.env.DB.prepare('DELETE FROM vaccinations WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

export default vaccinations;
