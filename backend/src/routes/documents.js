import { Hono } from 'hono';
import * as b2 from '../services/b2-storage';

const documents = new Hono();

// GET /api/documents
documents.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE patient_id = ? ORDER BY created_at DESC'
  ).bind(patientId).all();
  return c.json(results);
});

// GET /api/documents/:id/file
documents.get('/:id/file', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ? AND patient_id = ?').bind(id, patientId).first();
  
  if (!doc) return c.json({ error: 'Not found' }, 404);

  try {
    const url = await b2.getDownloadUrl(c.env, doc.file_path);
    return c.redirect(url);
  } catch (e) {
    return c.json({ error: 'Storage error', message: e.message }, 500);
  }
});

// POST /api/documents
documents.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'File is required' }, 400);
  }

  const title = body.title || file.name;
  const category = body.category || 'report';
  const notes = body.notes || '';
  const timelineId = body.timeline_id || null;
  
  const fileName = `${crypto.randomUUID()}-${file.name}`;
  
  try {
    // Save to B2
    await b2.uploadFile(c.env, fileName, await file.arrayBuffer(), file.type);

    // Save to D1
    const { results } = await c.env.DB.prepare(
      `INSERT INTO documents (title, category, file_path, mime_type, notes, timeline_id, patient_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    ).bind(title, category, fileName, file.type, notes, timelineId, patientId).all();

    return c.json(results[0], 201);
  } catch (e) {
    return c.json({ error: 'Upload failed', message: e.message }, 500);
  }
});

// DELETE /api/documents/:id
documents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const doc = await c.env.DB.prepare('SELECT file_path FROM documents WHERE id = ? AND patient_id = ?').bind(id, patientId).first();

  if (doc) {
    try {
      await b2.deleteFile(c.env, doc.file_path);
      await c.env.DB.prepare('DELETE FROM documents WHERE id = ? AND patient_id = ?').bind(id, patientId).run();
    } catch (e) {
      return c.json({ error: 'Delete failed', message: e.message }, 500);
    }
  }

  return c.json({ message: 'Deleted' });
});

export default documents;
