import { Hono } from 'hono';

const timeline = new Hono();

// GET /api/timeline
timeline.get('/', async (c) => {
  const patientId = c.get('patientId');
  const { from, to, category } = c.req.query();
  
  let query = `
    SELECT t.*, s.full_name as specialist_name_resolved, s.specialization as specialist_specialty
    FROM timeline t
    LEFT JOIN specialists s ON t.specialist_id = s.id
    WHERE t.patient_id = ?
  `;
  const params = [patientId];

  if (from) {
    query += ' AND t.event_date >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND t.event_date <= ?';
    params.push(to);
  }
  if (category) {
    query += ' AND t.category = ?';
    params.push(category);
  }

  query += ' ORDER BY t.event_date DESC';

  const { results: events } = await c.env.DB.prepare(query).bind(...params).all();

  // Fetch documents for these events
  const { results: docs } = await c.env.DB.prepare(
    'SELECT * FROM documents WHERE patient_id = ? AND timeline_id IS NOT NULL'
  ).bind(patientId).all();

  const docsByTimeline = {};
  docs.forEach(doc => {
    if (!docsByTimeline[doc.timeline_id]) docsByTimeline[doc.timeline_id] = [];
    docsByTimeline[doc.timeline_id].push(doc);
  });

  const result = events.map(event => ({
    ...event,
    documents: docsByTimeline[event.id] || []
  }));

  return c.json(result);
});

// GET /api/timeline/:id
timeline.get('/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('SELECT * FROM timeline WHERE id = ?').bind(id).first();
  if (!result) return c.json({ error: 'Not found' }, 404);
  return c.json(result);
});

// POST /api/timeline
timeline.post('/', async (c) => {
  const patientId = c.get('patientId');
  const body = await c.req.json();
  const { 
    title, description, category, event_date, notes, 
    specialist_name, specialist_type, specialist_id,
    transcription, ai_assessment 
  } = body;

  const { results } = await c.env.DB.prepare(`
    INSERT INTO timeline (
      title, description, category, event_date, notes, 
      specialist_name, specialist_type, specialist_id, 
      transcription, ai_assessment, patient_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    title, description, category || 'visit', event_date, notes,
    specialist_name, specialist_type, specialist_id, 
    transcription, ai_assessment, patientId
  ).all();

  return c.json(results[0], 201);
});

// PUT /api/timeline/:id
timeline.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { 
    title, description, category, event_date, notes, 
    specialist_name, specialist_type, specialist_id,
    transcription, ai_assessment 
  } = body;

  const { results } = await c.env.DB.prepare(`
    UPDATE timeline
    SET title = ?, description = ?, category = ?,
        event_date = ?, notes = ?, specialist_name = ?,
        specialist_type = ?, specialist_id = ?,
        transcription = ?, ai_assessment = ?, updated_at = datetime('now')
    WHERE id = ?
    RETURNING *
  `).bind(
    title, description, category, event_date, notes,
    specialist_name, specialist_type, specialist_id,
    transcription, ai_assessment, id
  ).all();

  if (results.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json(results[0]);
});

// DELETE /api/timeline/:id
timeline.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const patientId = c.get('patientId');

  await c.env.DB.prepare('DELETE FROM timeline WHERE id = ? AND patient_id = ?')
    .bind(id, patientId)
    .run();

  return c.json({ message: 'Deleted' });
});

export default timeline;
