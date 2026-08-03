import { Hono } from 'hono';
import * as b2 from '../services/b2-storage';
import { validateUpload, validateBufferSignature, MAX_PHOTO_BYTES } from '../services/upload-policy';

const vaccinations = new Hono();

// GET /api/vaccinations/section-photos — FE endpoint (legacy section gallery)
vaccinations.get('/section-photos', async (c) => {
  const patientId = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, photos FROM vaccinations WHERE patient_id = ? AND photos IS NOT NULL AND photos != ?'
  ).bind(patientId, '[]').all();

  const photos = [];
  for (const row of results || []) {
    try {
      const paths = JSON.parse(row.photos || '[]');
      for (const p of paths) {
        photos.push({
          vaccination_id: row.id,
          name: row.name,
          url: `/api/vaccinations/photos/${p}`,
          path: p,
        });
      }
    } catch { /* skip */ }
  }
  return c.json(photos);
});

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
  
  const parsedResults = results.map(row => {
    const photoPaths = JSON.parse(row.photos || '[]');
    return {
      ...row,
      photos: photoPaths.map(p => `/api/vaccinations/photos/${p}`)
    };
  });
  
  return c.json(parsedResults);
});

// GET /api/vaccinations/photos/*  (before /:id so it is not captured as id)
// Stream photo only if the B2 key belongs to a vaccination of the active patient.
vaccinations.get('/photos/*', async (c) => {
  const patientId = c.get('patientId');
  let path = c.req.path.replace('/api/vaccinations/photos/', '');
  path = path.replace(/\.\.\//g, '');

  if (!path || path.includes('..')) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  // Ownership: key must appear in photos JSON of a vaccination for this patient
  const { results } = await c.env.DB.prepare(
    'SELECT photos FROM vaccinations WHERE patient_id = ?'
  ).bind(patientId).all();

  const owned = (results || []).some((row) => {
    try {
      const photos = JSON.parse(row.photos || '[]');
      return Array.isArray(photos) && photos.includes(path);
    } catch {
      return false;
    }
  });

  if (!owned) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const url = await b2.getDownloadUrl(c.env, path);
    const res = await fetch(url);
    if (!res.ok) return c.json({ error: 'Photo not found' }, 404);

    return c.body(res.body, 200, {
      'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'private, no-store',
    });
  } catch (e) {
    return c.json({ error: 'Storage error' }, 500);
  }
});

// GET /api/vaccinations/:id
vaccinations.get('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const result = await c.env.DB.prepare(
    'SELECT * FROM vaccinations WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  
  if (!result) return c.json({ error: 'Not found' }, 404);
  
  const vac = result;
  const photoPaths = JSON.parse(vac.photos || '[]');
  
  return c.json({
    ...vac,
    photos: photoPaths.map(p => `/api/vaccinations/photos/${p}`)
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
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { name, vaccine_name, dose_number, scheduled_date, actual_date, status, administered_by, batch_number, reaction, notes } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE vaccinations
    SET name = ?, vaccine_name = ?, dose_number = ?, scheduled_date = ?,
        actual_date = ?, status = ?, administered_by = ?, batch_number = ?,
        reaction = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(name, vaccine_name, dose_number, scheduled_date, actual_date, status, administered_by, batch_number, reaction, notes, id, patientId).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  
  const vac = results[0];
  return c.json({ ...vac, photos: JSON.parse(vac.photos || '[]') });
});

// POST /api/vaccinations/:id/photos
vaccinations.post('/:id/photos', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.parseBody();
  const file = body.photo;

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'Photo is required' }, 400);
  }

  const check = validateUpload(file, { maxBytes: MAX_PHOTO_BYTES, photoOnly: true });
  if (!check.ok) {
    return c.json({ error: check.error }, check.status);
  }

  const vac = await c.env.DB.prepare(
    'SELECT photos FROM vaccinations WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!vac) return c.json({ error: 'Not found' }, 404);

  const buffer = await file.arrayBuffer();
  const sig = validateBufferSignature(buffer, check.extension, check.mime);
  if (!sig.ok) {
    return c.json({ error: sig.error }, sig.status);
  }

  const fileName = `vaccinations/${crypto.randomUUID()}.${check.extension}`;
  await b2.uploadFile(c.env, fileName, buffer, sig.mime);

  const photos = JSON.parse(vac.photos || '[]');
  const fullPhotos = photos.map(p => `/api/vaccinations/photos/${p}`);
  fullPhotos.push(`/api/vaccinations/photos/${fileName}`);

  await c.env.DB.prepare(
    'UPDATE vaccinations SET photos = ?, updated_at = datetime(\'now\') WHERE id = ? AND patient_id = ?'
  ).bind(JSON.stringify([...photos, fileName]), id, patientId).run();

  return c.json({ photos: fullPhotos, added: `/api/vaccinations/photos/${fileName}` });
});

// DELETE /api/vaccinations/:id/photos — remove one photo by path or proxy URL
vaccinations.delete('/:id/photos', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  let body = {};
  try { body = await c.req.json(); } catch { /* empty */ }
  const raw = body.photo_url || body.photo || body.path;
  if (!raw) return c.json({ error: 'photo_url required' }, 400);

  let path = String(raw).replace(/^\/api\/vaccinations\/photos\//, '');
  path = path.replace(/\.\.\//g, '');

  const vac = await c.env.DB.prepare(
    'SELECT photos FROM vaccinations WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!vac) return c.json({ error: 'Not found' }, 404);

  const photos = JSON.parse(vac.photos || '[]');
  if (!photos.includes(path)) {
    return c.json({ error: 'Photo not found on this vaccination' }, 404);
  }

  const next = photos.filter((p) => p !== path);
  try { await b2.deleteFile(c.env, path); } catch (e) { /* best effort */ }

  await c.env.DB.prepare(
    `UPDATE vaccinations SET photos = ?, updated_at = datetime('now') WHERE id = ? AND patient_id = ?`
  ).bind(JSON.stringify(next), id, patientId).run();

  return c.json({
    photos: next.map((p) => `/api/vaccinations/photos/${p}`),
    removed: path,
  });
});

// DELETE /api/vaccinations/:id
vaccinations.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const vac = await c.env.DB.prepare(
    'SELECT photos FROM vaccinations WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  
  if (!vac) return c.json({ error: 'Not found' }, 404);

  const photos = JSON.parse(vac.photos || '[]');
  for (const photoPath of photos) {
    try { await b2.deleteFile(c.env, photoPath); } catch (e) {}
  }

  await c.env.DB.prepare(
    'DELETE FROM vaccinations WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).run();
  return c.json({ message: 'Deleted' });
});

export default vaccinations;
