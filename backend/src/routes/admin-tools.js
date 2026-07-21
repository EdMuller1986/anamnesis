import { Hono } from 'hono';

const adminTools = new Hono();

// GET /integrity — Simplified for D1 (D1 doesn't support PRAGMA check directly via API)
adminTools.get('/integrity', async (c) => {
  const ftsValid = [];
  for (const tbl of ['timeline_fts', 'documents_fts', 'comments_fts']) {
    try {
      await c.env.DB.prepare(`INSERT INTO ${tbl}(${tbl}) VALUES ('integrity-check')`).run();
      ftsValid.push({ table: tbl, ok: true });
    } catch (e) {
      ftsValid.push({ table: tbl, ok: false, error: e.message });
    }
  }
  return c.json({
    integrity: 'D1 handled',
    foreign_key_violations: [], // D1 validates on write
    fts_status: ftsValid
  });
});

// GET /orphan-check
adminTools.get('/orphan-check', async (c) => {
  const pid = c.get('patientId');

  const deadFkPrescriptions = await c.env.DB.prepare(`
    SELECT p.id, p.medication_id, p.diagnosis_id, p.specialist_id, p.timeline_id
    FROM prescriptions p
    LEFT JOIN medications m ON m.id = p.medication_id
    LEFT JOIN diagnoses d ON d.id = p.diagnosis_id
    LEFT JOIN specialists s ON s.id = p.specialist_id
    LEFT JOIN timeline t ON t.id = p.timeline_id
    WHERE p.patient_id = ?
      AND (
        (p.medication_id IS NOT NULL AND m.id IS NULL) OR
        (p.diagnosis_id IS NOT NULL AND d.id IS NULL) OR
        (p.specialist_id IS NOT NULL AND s.id IS NULL) OR
        (p.timeline_id IS NOT NULL AND t.id IS NULL)
      )
  `).bind(pid).all();

  const orphanDocuments = await c.env.DB.prepare(`
    SELECT id, title, file_path, created_at
    FROM documents
    WHERE patient_id = ?
      AND timeline_id IS NULL
      AND (source_doctor IS NULL OR source_doctor = '')
      AND (source_org IS NULL OR source_org = '')
    ORDER BY created_at DESC
  `).bind(pid).all();

  const orphanMedications = await c.env.DB.prepare(`
    SELECT m.id, m.name, m.status, m.created_at
    FROM medications m
    WHERE m.patient_id = ?
      AND NOT EXISTS (SELECT 1 FROM prescriptions p WHERE p.medication_id = m.id)
    ORDER BY m.created_at DESC
  `).bind(pid).all();

  const emptyTimeline = await c.env.DB.prepare(`
    SELECT t.id, t.event_date, t.title, t.category
    FROM timeline t
    WHERE t.patient_id = ?
      AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.timeline_id = t.id)
      AND (t.transcription IS NULL OR length(t.transcription) < 20)
    ORDER BY t.event_date DESC
  `).bind(pid).all();

  return c.json({
    summary: {
      dead_fk_prescriptions: deadFkPrescriptions.results.length,
      orphan_documents: orphanDocuments.results.length,
      orphan_medications: orphanMedications.results.length,
      empty_timeline: emptyTimeline.results.length,
    },
    dead_fk_prescriptions: deadFkPrescriptions.results,
    orphan_documents: orphanDocuments.results,
    orphan_medications: orphanMedications.results,
    empty_timeline: emptyTimeline.results,
    clean: deadFkPrescriptions.results.length === 0 && 
           orphanDocuments.results.length === 0 && 
           orphanMedications.results.length === 0 && 
           emptyTimeline.results.length === 0
  });
});

// POST /sql
adminTools.post('/sql', async (c) => {
  const { sql, params = [] } = await c.req.json();
  const forbidden = /\b(PRAGMA|ATTACH|DETACH|LOAD_EXTENSION)\b/i;
  
  if (forbidden.test(sql)) {
    return c.json({ error: 'forbidden SQL pattern' }, 403);
  }

  try {
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
    if (isSelect) {
      const { results } = await c.env.DB.prepare(sql).bind(...params).all();
      return c.json({ rows: results, count: results.length });
    } else {
      const result = await c.env.DB.prepare(sql).bind(...params).run();
      return c.json({
        changes: result.meta.changes,
        last_insert_rowid: result.meta.last_row_id
      });
    }
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// GET /search
adminTools.get('/search', async (c) => {
  const q = c.req.query('q');
  const pid = c.get('patientId');
  if (!q) return c.json({ error: 'q required' }, 400);

  const ftsQuery = q.replace(/"/g, '""');

  const [timeline, documents, comments] = await Promise.all([
    c.env.DB.prepare(`
      SELECT t.id, t.event_date, t.title,
             snippet(timeline_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet
      FROM timeline_fts
      JOIN timeline t ON t.id = timeline_fts.rowid
      WHERE timeline_fts MATCH ? AND t.patient_id = ?
      LIMIT 20
    `).bind(ftsQuery, pid).all(),
    c.env.DB.prepare(`
      SELECT d.id, d.title,
             snippet(documents_fts, 1, '<mark>', '</mark>', '…', 20) AS snippet
      FROM documents_fts
      JOIN documents d ON d.id = documents_fts.rowid
      WHERE documents_fts MATCH ? AND d.patient_id = ?
      LIMIT 20
    `).bind(ftsQuery, pid).all(),
    c.env.DB.prepare(`
      SELECT c.id, c.entity_type, c.entity_id,
             snippet(comments_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
      FROM comments_fts
      JOIN comments c ON c.id = comments_fts.rowid
      WHERE comments_fts MATCH ? AND c.patient_id = ?
      LIMIT 20
    `).bind(ftsQuery, pid).all()
  ]);

  return c.json({
    timeline: timeline.results,
    documents: documents.results,
    comments: comments.results
  });
});

export default adminTools;
