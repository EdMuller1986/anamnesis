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
    // Стримим файл через Worker, чтобы избежать проблем с CORS на B2 при предпросмотре
    const res = await fetch(url);
    if (!res.ok) throw new Error(`B2 storage responded with ${res.status}`);

    const fileName = doc.title || doc.original_name || 'document';
    return c.body(res.body, 200, {
      'Content-Type': doc.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'public, max-age=3600',
    });
  } catch (e) {
    console.error('[Documents] Download error:', e);
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
  
  // Clean filename for storage (only UUID + extension)
  const extension = file.name.split('.').pop() || 'bin';
  const fileName = `${crypto.randomUUID()}.${extension}`;
  
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
    console.error('S3 Upload Error:', e);
    return c.json({ error: 'Upload failed', message: e.message, code: e.code }, 500);
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
