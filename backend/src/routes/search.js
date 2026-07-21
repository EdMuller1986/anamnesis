import { Hono } from 'hono';

const search = new Hono();

/**
 * GET /api/search?q=...
 * Полнотекстовый поиск по всей медкарте.
 * Использует FTS5 индексы для timeline, documents и comments.
 */
search.get('/', async (c) => {
  const q = c.req.query('q');
  const pid = c.get('patientId');
  if (!q) return c.json({ timeline: [], documents: [], comments: [] });

  const ftsQuery = q.replace(/"/g, '""');

  try {
    const [timelineHits, documentHits, commentHits] = await Promise.all([
      c.env.DB.prepare(`
        SELECT t.id, t.event_date, t.title, t.category,
               snippet(timeline_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet
        FROM timeline_fts
        JOIN timeline t ON t.id = timeline_fts.rowid
        WHERE timeline_fts MATCH ? AND t.patient_id = ?
        LIMIT 20
      `).bind(ftsQuery, pid).all(),
      c.env.DB.prepare(`
        SELECT d.id, d.title, d.category,
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
      timeline: timelineHits.results,
      documents: documentHits.results,
      comments: commentHits.results
    });
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

export default search;
