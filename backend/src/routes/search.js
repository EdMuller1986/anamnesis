import { Hono } from 'hono';

const search = new Hono();

/**
 * GET /api/search?q=текст
 * Поиск по всем разделам медкарты.
 * Использует FTS5 для контента и LIKE для справочников.
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
    // 1. Поиск по справочникам (LIKE)
    const [diagnoses, specialists, medications] = await Promise.all([
      c.env.DB.prepare(`SELECT id, name as title, 'diagnosis' as _type FROM diagnoses WHERE patient_id = ? AND (name LIKE ? OR icd_code LIKE ?) LIMIT 5`).bind(pid, like, like).all(),
      c.env.DB.prepare(`SELECT id, full_name as title, 'specialist' as _type FROM specialists WHERE patient_id = ? AND (full_name LIKE ? OR specialization LIKE ?) LIMIT 5`).bind(pid, like, like).all(),
      c.env.DB.prepare(`SELECT id, name as title, 'medication' as _type FROM medications WHERE patient_id = ? AND name LIKE ? LIMIT 5`).bind(pid, like).all()
    ]);
    results.push(...diagnoses.results, ...specialists.results, ...medications.results);

    // 2. Поиск по контенту (FTS5)
    const [timeline, documents, comments] = await Promise.all([
      c.env.DB.prepare(`SELECT t.id, t.title, 'timeline' as _type FROM timeline_fts JOIN timeline t ON t.id = timeline_fts.rowid WHERE timeline_fts MATCH ? AND t.patient_id = ? LIMIT 5`).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`SELECT d.id, d.title, 'document' as _type FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid WHERE documents_fts MATCH ? AND d.patient_id = ? LIMIT 5`).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`SELECT c.id, c.entity_type as _type, c.entity_id FROM comments_fts JOIN comments c ON c.id = comments_fts.rowid WHERE comments_fts MATCH ? AND c.patient_id = ? LIMIT 5`).bind(ftsQuery, pid).all()
    ]);
    results.push(...timeline.results, ...documents.results, ...commentHits(comments.results));

    return c.json(results);
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

function commentHits(rows) {
  return rows.map(r => ({ id: r.entity_id, title: `Комментарий к ${r._type}`, _type: 'comment' }));
}

export default search;
