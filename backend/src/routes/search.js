import { Hono } from 'hono';

const search = new Hono();

/**
 * GET /api/search?q=текст
 * Returns a flat array of hits with `_type` (frontend SearchModal expects this).
 * FTS failures fall back to LIKE-only so search still works.
 */
search.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const pid = c.get('patientId') || 1;

  if (!q || q.length < 2) {
    return c.json([]);
  }

  const like = `%${q}%`;
  // FTS5: escape quotes; prefix search
  const ftsQuery = `"${q.replace(/"/g, '""')}"*`;
  const results = [];
  const seen = new Set();

  const pushUnique = (rows) => {
    for (const r of rows || []) {
      const key = `${r._type}:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(r);
    }
  };

  try {
    const queries = [
      { sql: "SELECT id, name as title, name, 'diagnosis' as _type FROM diagnoses WHERE patient_id = ? AND (name LIKE ? OR icd_code LIKE ? OR detail LIKE ? OR notes LIKE ?) LIMIT 8", params: [pid, like, like, like, like] },
      { sql: "SELECT id, full_name as title, full_name as name, 'specialist' as _type FROM specialists WHERE patient_id = ? AND (full_name LIKE ? OR specialization LIKE ? OR clinic LIKE ?) LIMIT 8", params: [pid, like, like, like] },
      { sql: "SELECT id, name as title, name, 'medication' as _type FROM medications WHERE patient_id = ? AND (name LIKE ? OR dosage LIKE ? OR detail LIKE ?) LIMIT 8", params: [pid, like, like, like] },
      { sql: "SELECT id, name as title, name, 'vaccination' as _type FROM vaccinations WHERE patient_id = ? AND (name LIKE ? OR vaccine_name LIKE ? OR notes LIKE ?) LIMIT 8", params: [pid, like, like, like] },
      { sql: "SELECT id, parameter as title, parameter as name, 'lab_result' as _type FROM lab_results WHERE patient_id = ? AND (parameter LIKE ? OR test_name LIKE ? OR notes LIKE ?) LIMIT 8", params: [pid, like, like, like] },
      { sql: "SELECT id, title, title as name, 'plan' as _type FROM plan WHERE patient_id = ? AND (title LIKE ? OR detail LIKE ? OR description LIKE ?) LIMIT 5", params: [pid, like, like, like] },
      { sql: "SELECT id, title, title as name, 'timeline' as _type FROM timeline WHERE patient_id = ? AND (title LIKE ? OR description LIKE ? OR notes LIKE ?) LIMIT 8", params: [pid, like, like, like] },
      { sql: "SELECT id, title, title as name, 'document' as _type FROM documents WHERE patient_id = ? AND (title LIKE ? OR original_name LIKE ? OR notes LIKE ?) LIMIT 8", params: [pid, like, like, like] },
      { sql: "SELECT id, title, title as name, 'error' as _type FROM medical_errors WHERE patient_id = ? AND (title LIKE ? OR detail LIKE ? OR description LIKE ? OR notes LIKE ?) LIMIT 5", params: [pid, like, like, like, like] },
      { sql: "SELECT id, title, title as name, 'reminder' as _type FROM reminders WHERE patient_id = ? AND (title LIKE ? OR message LIKE ? OR notes LIKE ?) LIMIT 5", params: [pid, like, like, like] },
    ];

    for (const qry of queries) {
      try {
        const { results: res } = await c.env.DB.prepare(qry.sql).bind(...qry.params).all();
        pushUnique(res);
      } catch (e) {
        // column may not exist yet on partially migrated DB — skip that query
        console.warn('[search] query skipped:', e.message);
      }
    }

    // FTS optional enrichment
    try {
      const fts = await Promise.all([
        c.env.DB.prepare(
          `SELECT t.id, t.title, 'timeline' as _type FROM timeline_fts
           JOIN timeline t ON t.id = timeline_fts.rowid
           WHERE timeline_fts MATCH ? AND t.patient_id = ? LIMIT 8`
        ).bind(ftsQuery, pid).all(),
        c.env.DB.prepare(
          `SELECT d.id, d.title, 'document' as _type FROM documents_fts
           JOIN documents d ON d.id = documents_fts.rowid
           WHERE documents_fts MATCH ? AND d.patient_id = ? LIMIT 8`
        ).bind(ftsQuery, pid).all(),
      ]);
      fts.forEach((f) => pushUnique(f.results));
    } catch (e) {
      console.warn('[search] FTS unavailable:', e.message);
    }

    return c.json(results);
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

export default search;
