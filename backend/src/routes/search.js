import { Hono } from 'hono';

const search = new Hono();

/**
 * GET /api/search?q=текст
 * Поиск по всем разделам медкарты.
 */
search.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const pid = c.get('patientId');

  if (!q || q.length < 2) {
    return c.json([]);
  }

  const like = `%${q}%`;
  const ftsQuery = q.replace(/"/g, '""');
  const results = [];

  try {
    // 1. Поиск по справочникам (LIKE) - используем явные переменные
    const diagnoses = await c.env.DB.prepare(
      "SELECT id, name as title, 'diagnosis' as _type FROM diagnoses WHERE patient_id = ? AND (name LIKE ? OR icd_code LIKE ? OR detail LIKE ?) LIMIT 10"
    ).bind(pid, like, like, like).all();
    if (diagnoses.results) results.push(...diagnoses.results);

    const specialists = await c.env.DB.prepare(
      "SELECT id, full_name as title, 'specialist' as _type FROM specialists WHERE patient_id = ? AND (full_name LIKE ? OR specialization LIKE ? OR clinic LIKE ?) LIMIT 10"
    ).bind(pid, like, like, like).all();
    if (specialists.results) results.push(...specialists.results);

    const medications = await c.env.DB.prepare(
      "SELECT id, name as title, 'medication' as _type FROM medications WHERE patient_id = ? AND name LIKE ? LIMIT 10"
    ).bind(pid, like).all();
    if (medications.results) results.push(...medications.results);

    // 2. Поиск по контенту (FTS5) - используем явные переменные
    const timeline = await c.env.DB.prepare(`
        SELECT t.id, t.title, 'timeline' as _type 
        FROM timeline_fts 
        JOIN timeline t ON t.id = timeline_fts.rowid 
        WHERE timeline_fts MATCH ? AND t.patient_id = ? 
        LIMIT 10
      `).bind(ftsQuery, pid).all();
    if (timeline.results) results.push(...timeline.results);

    const documents = await c.env.DB.prepare(`
        SELECT d.id, d.title, 'document' as _type 
        FROM documents_fts 
        JOIN documents d ON d.id = documents_fts.rowid 
        WHERE documents_fts MATCH ? AND d.patient_id = ? 
        LIMIT 10
      `).bind(ftsQuery, pid).all();
    if (documents.results) results.push(...documents.results);

    return c.json(results);
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

export default search;
