import { Hono } from 'hono';

const search = new Hono();

/**
 * GET /api/search?q=текст
 * Поиск по всем разделам медкарты.
 * Использует LIKE для широкого охвата всех сущностей.
 */
search.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const pid = c.get('patientId');

  if (!q || q.length < 2) {
    return c.json([]);
  }

  const like = `%${q}%`;
  const results = [];

  try {
    // 1. Диагнозы
    const diagnoses = await c.env.DB.prepare(
      `SELECT id, name, icd_code, status, 'diagnosis' as _type 
       FROM diagnoses WHERE patient_id = ? AND (name LIKE ? OR icd_code LIKE ? OR detail LIKE ?) LIMIT 10`
    ).bind(pid, like, like, like).all();
    results.push(...diagnoses.results.map(r => ({ ...r, title: r.name })));

    // 2. Лекарства
    const medications = await c.env.DB.prepare(
      `SELECT id, name, dosage, status, 'medication' as _type 
       FROM medications WHERE patient_id = ? AND (name LIKE ? OR dosage LIKE ? OR detail LIKE ?) LIMIT 10`
    ).bind(pid, like, like, like).all();
    results.push(...medications.results.map(r => ({ ...r, title: r.name })));

    // 3. Специалисты
    const specialists = await c.env.DB.prepare(
      `SELECT id, full_name as name, specialization, 'specialist' as _type 
       FROM specialists WHERE patient_id = ? AND (full_name LIKE ? OR specialization LIKE ? OR clinic LIKE ?) LIMIT 10`
    ).bind(pid, like, like, like).all();
    results.push(...specialists.results.map(r => ({ ...r, title: r.name })));

    // 4. Таймлайн
    const timeline = await c.env.DB.prepare(
      `SELECT id, title as name, category, 'timeline' as _type 
       FROM timeline WHERE patient_id = ? AND (title LIKE ? OR description LIKE ? OR transcription LIKE ?) LIMIT 10`
    ).bind(pid, like, like, like).all();
    results.push(...timeline.results.map(r => ({ ...r, title: r.name })));

    // 5. План
    const plan = await c.env.DB.prepare(
      `SELECT id, title as name, priority as status, 'plan' as _type 
       FROM plan WHERE patient_id = ? AND (title LIKE ? OR detail LIKE ?) LIMIT 10`
    ).bind(pid, like, like).all();
    results.push(...plan.results.map(r => ({ ...r, title: r.name })));

    // 6. Документы
    const documents = await c.env.DB.prepare(
      `SELECT id, title as name, category, 'document' as _type 
       FROM documents WHERE patient_id = ? AND (title LIKE ? OR notes LIKE ? OR transcription LIKE ?) LIMIT 10`
    ).bind(pid, like, like, like).all();
    results.push(...documents.results.map(r => ({ ...r, title: r.name })));

    // 7. Прививки
    const vaccinations = await c.env.DB.prepare(
      `SELECT id, name, status, 'vaccination' as _type 
       FROM vaccinations WHERE patient_id = ? AND (name LIKE ? OR vaccine_name LIKE ? OR notes LIKE ?) LIMIT 10`
    ).bind(pid, like, like, like).all();
    results.push(...vaccinations.results.map(r => ({ ...r, title: r.name })));

    return c.json(results);
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Search failed', message: err.message }, 500);
  }
});

export default search;
