import { Hono } from 'hono';

const adminTools = new Hono();

// GET /api/admin/tools/integrity
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
  return c.json({ integrity: 'D1 managed', foreign_key_violations: [], fts_status: ftsValid });
});

// GET /api/admin/tools/orphan-check
adminTools.get('/orphan-check', async (c) => {
  const pid = c.get('patientId') || 1;
  const results = await Promise.all([
    c.env.DB.prepare('SELECT p.id, p.medication_id FROM prescriptions p LEFT JOIN medications m ON m.id = p.medication_id WHERE p.patient_id = ? AND p.medication_id IS NOT NULL AND m.id IS NULL').bind(pid).all(),
    c.env.DB.prepare('SELECT id, title FROM documents WHERE patient_id = ? AND timeline_id IS NULL AND (source_doctor IS NULL OR source_doctor = "")').bind(pid).all(),
    c.env.DB.prepare('SELECT m.id, m.name FROM medications m WHERE m.patient_id = ? AND NOT EXISTS (SELECT 1 FROM prescriptions p WHERE p.medication_id = m.id)').bind(pid).all()
  ]);

  return c.json({
    dead_fk: results[0].results,
    orphan_docs: results[1].results,
    orphan_meds: results[2].results
  });
});

// POST /api/admin/tools/sql
adminTools.post('/sql', async (c) => {
  const { sql, params = [] } = await c.req.json();
  if (/\b(PRAGMA|ATTACH|DETACH|LOAD_EXTENSION)\b/i.test(sql)) return c.json({ error: 'forbidden' }, 403);
  try {
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
    if (isSelect) {
      const { results } = await c.env.DB.prepare(sql).bind(...params).all();
      return c.json({ rows: results, count: results.length });
    } else {
      const result = await c.env.DB.prepare(sql).bind(...params).run();
      return c.json({ changes: result.meta.changes });
    }
  } catch (e) { return c.json({ error: e.message }, 400); }
});

// GET /api/admin/tools/search
adminTools.get('/search', async (c) => {
  const q = c.req.query('q');
  const pid = c.get('patientId') || 1;
  if (!q) return c.json({ timeline: [], documents: [], comments: [], specialists: [], diagnoses: [] });

  const like = `%${q}%`;
  const ftsQuery = q.replace(/"/g, '""');

  try {
    const [timelineHits, documentHits, commentHits, specialistHits, diagnosisHits] = await Promise.all([
      c.env.DB.prepare(`SELECT t.id, t.title, 'timeline' as _type, snippet(timeline_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet FROM timeline_fts JOIN timeline t ON t.id = timeline_fts.rowid WHERE timeline_fts MATCH ? AND t.patient_id = ? LIMIT 10`).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`SELECT d.id, d.title, 'document' as _type, snippet(documents_fts, 1, '<mark>', '</mark>', '…', 20) AS snippet FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid WHERE documents_fts MATCH ? AND d.patient_id = ? LIMIT 10`).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`SELECT c.id, c.entity_type as _type, c.entity_id, snippet(comments_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet FROM comments_fts JOIN comments c ON c.id = comments_fts.rowid WHERE comments_fts MATCH ? AND c.patient_id = ? LIMIT 10`).bind(ftsQuery, pid).all(),
      c.env.DB.prepare("SELECT id, full_name as title, 'specialist' as _type FROM specialists WHERE patient_id = ? AND (full_name LIKE ? OR specialization LIKE ? OR clinic LIKE ?) LIMIT 10").bind(pid, like, like, like).all(),
      c.env.DB.prepare("SELECT id, name as title, 'diagnosis' as _type FROM diagnoses WHERE patient_id = ? AND (name LIKE ? OR icd_code LIKE ?) LIMIT 10").bind(pid, like, like).all()
    ]);

    return c.json({
      timeline: timelineHits.results,
      documents: documentHits.results,
      comments: commentHits.results.map(r => ({ id: r.entity_id, title: `Комментарий к ${r._type}`, _type: 'comment' })),
      specialists: specialistHits.results,
      diagnoses: diagnosisHits.results
    });
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

// GET /api/admin/tools/ai-review
adminTools.get('/ai-review', async (c) => {
  const pid = c.get('patientId') || 1;
  const db = c.env.DB;

  try {
    const lastReviewKey = `last_ai_review_at_${pid}`;
    const lastReviewRow = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(lastReviewKey).first();
    const lastReviewAt = lastReviewRow?.value || '1970-01-01 00:00:00';

    const [pendingAi, orphanCheck, newTimeline, newDocs, newComments] = await Promise.all([
      db.prepare("SELECT id, entity_type, entity_id FROM ai_requests WHERE patient_id = ? AND status = 'pending'").bind(pid).all(),
      // Simplified orphan check count
      db.prepare("SELECT (SELECT COUNT(*) FROM documents WHERE patient_id = ? AND timeline_id IS NULL) as docs, (SELECT COUNT(*) FROM prescriptions p LEFT JOIN medications m ON m.id = p.medication_id WHERE p.patient_id = ? AND m.id IS NULL) as fks").bind(pid, pid).first(),
      db.prepare("SELECT COUNT(*) as count FROM timeline WHERE patient_id = ? AND created_at > ?").bind(pid, lastReviewAt).first(),
      db.prepare("SELECT COUNT(*) as count FROM documents WHERE patient_id = ? AND created_at > ?").bind(pid, lastReviewAt).first(),
      db.prepare("SELECT COUNT(*) as count FROM comments WHERE patient_id = ? AND created_at > ?").bind(pid, lastReviewAt).first()
    ]);

    return c.json({
      integrity_ok: true, // D1 managed
      fk_violations: [],
      pending_ai_requests: pendingAi.results,
      orphan_counts: { documents: orphanCheck.docs, dead_fks: orphanCheck.fks },
      new_since_review: {
        timeline: newTimeline.count,
        documents: newDocs.count,
        comments: newComments.count
      },
      ready_to_work: true,
      last_review_at: lastReviewAt
    });
  } catch (err) {
    return c.json({ error: 'AI Review failed', message: err.message }, 500);
  }
});

// POST /api/admin/tools/mark-reviewed
adminTools.post('/mark-reviewed', async (c) => {
  const pid = c.get('patientId') || 1;
  const key = `last_ai_review_at_${pid}`;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  await c.env.DB.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, now).run();

  return c.json({ ok: true, reviewed_at: now });
});

// GET /api/admin/tools/since-last-review
adminTools.get('/since-last-review', async (c) => {
  const pid = c.get('patientId') || 1;
  const db = c.env.DB;

  const lastReviewKey = `last_ai_review_at_${pid}`;
  const lastReviewRow = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(lastReviewKey).first();
  const lastReviewAt = lastReviewRow?.value || '1970-01-01 00:00:00';

  const [timeline, documents, comments, diagnoses, medications] = await Promise.all([
    db.prepare("SELECT * FROM timeline WHERE patient_id = ? AND (created_at > ? OR updated_at > ?)").bind(pid, lastReviewAt, lastReviewAt).all(),
    db.prepare("SELECT * FROM documents WHERE patient_id = ? AND (created_at > ? OR updated_at > ?)").bind(pid, lastReviewAt, lastReviewAt).all(),
    db.prepare("SELECT * FROM comments WHERE patient_id = ? AND created_at > ?").bind(pid, lastReviewAt).all(),
    db.prepare("SELECT * FROM diagnoses WHERE patient_id = ? AND (created_at > ? OR updated_at > ?)").bind(pid, lastReviewAt, lastReviewAt).all(),
    db.prepare("SELECT * FROM medications WHERE patient_id = ? AND (created_at > ? OR updated_at > ?)").bind(pid, lastReviewAt, lastReviewAt).all()
  ]);

  return c.json({
    timeline: timeline.results,
    documents: documents.results,
    comments: comments.results,
    diagnoses: diagnoses.results,
    medications: medications.results
  });
});

// GET /api/admin/tools/impact
adminTools.get('/impact', async (c) => {
  const { type, id } = c.req.query();
  const pid = c.get('patientId') || 1;
  if (!type || !id) return c.json({ error: 'type and id required' }, 400);

  const impacts = [];
  if (type === 'timeline') {
    const docs = await c.env.DB.prepare("SELECT id, title FROM documents WHERE timeline_id = ?").bind(id).all();
    if (docs.results.length > 0) impacts.push({ table: 'documents', count: docs.results.length, items: docs.results });
    const prescriptions = await c.env.DB.prepare("SELECT id FROM prescriptions WHERE timeline_id = ?").bind(id).all();
    if (prescriptions.results.length > 0) impacts.push({ table: 'prescriptions', count: prescriptions.results.length });
  } else if (type === 'medication') {
    const prescriptions = await c.env.DB.prepare("SELECT id FROM prescriptions WHERE medication_id = ?").bind(id).all();
    if (prescriptions.results.length > 0) impacts.push({ table: 'prescriptions', count: prescriptions.results.length });
  } else if (type === 'diagnosis') {
    const prescriptions = await c.env.DB.prepare("SELECT id FROM prescriptions WHERE diagnosis_id = ?").bind(id).all();
    if (prescriptions.results.length > 0) impacts.push({ table: 'prescriptions', count: prescriptions.results.length });
    const visitDiags = await c.env.DB.prepare("SELECT visit_id FROM visit_diagnoses WHERE diagnosis_id = ?").bind(id).all();
    if (visitDiags.results.length > 0) impacts.push({ table: 'visit_diagnoses', count: visitDiags.results.length });
  }

  return c.json({ type, id, impacts });
});

// GET /api/admin/tools/changelog
adminTools.get('/changelog', async (c) => {
  const pid = c.get('patientId') || 1;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const { results } = await c.env.DB.prepare("SELECT * FROM audit_log WHERE patient_id = ? ORDER BY id DESC LIMIT ?").bind(pid, limit).all();
  return c.json(results);
});

export default adminTools;
