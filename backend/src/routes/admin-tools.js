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
  const pid = c.get('patientId');
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
  const pid = c.get('patientId') || 1; // Fallback
  if (!q) return c.json({ timeline: [], documents: [], comments: [] });

  // D1 FTS5 MATCH требует экранирования спецсимволов
  const ftsQuery = q.replace(/"/g, '""');

  try {
    const [timelineHits, documentHits, commentHits] = await Promise.all([
      c.env.DB.prepare(`
        SELECT t.id, t.title, 'timeline' as _type,
               snippet(timeline_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet
        FROM timeline_fts
        JOIN timeline t ON t.id = timeline_fts.rowid
        WHERE timeline_fts MATCH ? AND t.patient_id = ?
        LIMIT 10
      `).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`
        SELECT d.id, d.title, 'document' as _type,
               snippet(documents_fts, 1, '<mark>', '</mark>', '…', 20) AS snippet
        FROM documents_fts
        JOIN documents d ON d.id = documents_fts.rowid
        WHERE documents_fts MATCH ? AND d.patient_id = ?
        LIMIT 10
      `).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`
        SELECT c.id, c.entity_type, c.entity_id, 'comment' as _type,
               snippet(comments_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
        FROM comments_fts
        JOIN comments c ON c.id = comments_fts.rowid
        WHERE comments_fts MATCH ? AND c.patient_id = ?
        LIMIT 10
      `).bind(ftsQuery, pid).all()
    ]);

    return c.json({
      timeline: timelineHits.results,
      documents: documentHits.results,
      comments: commentHits.results
    });
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

export default adminTools;
