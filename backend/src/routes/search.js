import { Hono } from 'hono';

const search = new Hono();

/**
 * GET /api/search?q=текст
 * Поиск по всем разделам медкарты.
 */
search.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const pid = c.get('patientId') || 1;

  if (!q || q.length < 2) {
    return c.json([]);
  }

  const like = `%${q}%`;
  const ftsQuery = q.replace(/"/g, '""') + '*'; // Добавляем * для префиксного поиска
  const results = [];

  try {
    // 1. Поиск по справочникам и результатам (LIKE)
    const queries = [
      { sql: "SELECT id, name as title, 'diagnosis' as _type FROM diagnoses WHERE patient_id = ? AND (name LIKE ? OR icd_code LIKE ? OR detail LIKE ?) LIMIT 5", params: [pid, like, like, like] },
      { sql: "SELECT id, full_name as title, 'specialist' as _type FROM specialists WHERE patient_id = ? AND (full_name LIKE ? OR specialization LIKE ? OR clinic LIKE ?) LIMIT 5", params: [pid, like, like, like] },
      { sql: "SELECT id, name as title, 'medication' as _type FROM medications WHERE patient_id = ? AND (name LIKE ? OR dosage LIKE ? OR detail LIKE ?) LIMIT 5", params: [pid, like, like, like] },
      { sql: "SELECT id, name as title, 'vaccination' as _type FROM vaccinations WHERE patient_id = ? AND (name LIKE ? OR vaccine_name LIKE ? OR notes LIKE ?) LIMIT 5", params: [pid, like, like, like] },
      { sql: "SELECT id, parameter as title, 'lab_result' as _type FROM lab_results WHERE patient_id = ? AND (parameter LIKE ? OR test_name LIKE ? OR notes LIKE ?) LIMIT 5", params: [pid, like, like, like] }
    ];

    for (const qry of queries) {
      const { results: res } = await c.env.DB.prepare(qry.sql).bind(...qry.params).all();
      if (res) results.push(...res);
    }

    // 2. Поиск по контенту (FTS5) - дублируем LIKE, чтобы работало надежнее
    const fts = await Promise.all([
      c.env.DB.prepare(`SELECT t.id, t.title, 'timeline' as _type FROM timeline_fts JOIN timeline t ON t.id = timeline_fts.rowid WHERE timeline_fts MATCH ? AND t.patient_id = ? LIMIT 5`).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`SELECT d.id, d.title, 'document' as _type FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid WHERE documents_fts MATCH ? AND d.patient_id = ? LIMIT 5`).bind(ftsQuery, pid).all()
    ]);
    
    fts.forEach(f => { if (f.results) results.push(...f.results); });

    return c.json(results);
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

export default search;
