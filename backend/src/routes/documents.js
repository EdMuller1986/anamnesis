import { Hono } from 'hono';
import * as b2 from '../services/b2-storage';
import { validateUpload, fileResponseHeaders } from '../services/upload-policy';

const documents = new Hono();

// GET /api/documents
documents.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE patient_id = ? ORDER BY created_at DESC'
  ).bind(patientId).all();
  return c.json(results);
});

// GET /api/documents/:id — metadata (before /:id/file is fine; Hono matches longer paths)
documents.get('/:id', async (c) => {
  const id = c.req.param('id');
  // Avoid capturing "file" as id when route order is wrong
  if (id === 'file') return c.json({ error: 'Not found' }, 404);
  const patientId = c.get('patientId');
  const doc = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!doc) return c.json({ error: 'Not found' }, 404);
  return c.json(doc);
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
    return c.body(res.body, 200, fileResponseHeaders(doc.mime_type, fileName));
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

  const check = validateUpload(file);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status);
  }

  const title = body.title || file.name;
  const category = body.category || 'report';
  const notes = body.notes || '';
  const timelineId = body.timeline_id || null;
  
  // Clean filename for storage (only UUID + safe extension)
  const fileName = `${crypto.randomUUID()}.${check.extension}`;
  
  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > 50 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 50 MB)' }, 413);
    }

    // Save to B2 with canonical MIME from policy (not raw client type)
    await b2.uploadFile(c.env, fileName, buffer, check.mime);

    // Save to D1 (original_name / file_size for FE)
    const { results } = await c.env.DB.prepare(
      `INSERT INTO documents (title, category, file_path, mime_type, notes, timeline_id, patient_id, original_name, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    ).bind(
      title,
      category,
      fileName,
      check.mime,
      notes,
      timelineId,
      patientId,
      file.name || null,
      buffer.byteLength
    ).all();

    return c.json(results[0], 201);
  } catch (e) {
    // Best-effort cleanup if D1 insert fails after B2 upload
    try { await b2.deleteFile(c.env, fileName); } catch (_) { /* ignore */ }
    console.error('S3 Upload Error:', e);
    return c.json({ error: 'Upload failed', message: e.message, code: e.code }, 500);
  }
});

// PUT /api/documents/:id — metadata only
documents.put('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const title = body.title !== undefined ? body.title : existing.title;
  const category = body.category !== undefined ? body.category : existing.category;
  const notes = body.notes !== undefined ? body.notes : existing.notes;
  const description = body.description !== undefined ? body.description : existing.description;
  const timeline_id = body.timeline_id !== undefined ? body.timeline_id : existing.timeline_id;
  const document_date = body.document_date !== undefined ? body.document_date : existing.document_date;
  const source_doctor = body.source_doctor !== undefined ? body.source_doctor : existing.source_doctor;
  const source_org = body.source_org !== undefined ? body.source_org : existing.source_org;

  const { results } = await c.env.DB.prepare(`
    UPDATE documents
    SET title = ?, category = ?, notes = ?, description = ?, timeline_id = ?,
        document_date = ?, source_doctor = ?, source_org = ?, updated_at = datetime('now')
    WHERE id = ? AND patient_id = ?
    RETURNING *
  `).bind(
    title, category, notes, description, timeline_id,
    document_date, source_doctor, source_org, id, patientId
  ).all();

  if (!results.length) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
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
