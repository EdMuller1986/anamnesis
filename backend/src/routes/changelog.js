import { Hono } from 'hono';

const changelog = new Hono();

// GET /api/changelog — version journal for UI
changelog.get('/', async (c) => {
  const pid = c.get('patientId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

  // Prefer patient-scoped rows when patient_id column is present; fall back to all
  let rows;
  try {
    const r = await c.env.DB.prepare(
      `SELECT id, version, changes, reason, created_at, patient_id
       FROM app_versions
       WHERE patient_id IS NULL OR patient_id = ?
       ORDER BY id DESC
       LIMIT ?`
    ).bind(pid, limit).all();
    rows = r.results || [];
  } catch {
    const r = await c.env.DB.prepare(
      `SELECT id, version, changes, reason, created_at
       FROM app_versions
       ORDER BY id DESC
       LIMIT ?`
    ).bind(limit).all();
    rows = r.results || [];
  }

  const parsed = rows.map((row) => {
    let changes = row.changes;
    if (typeof changes === 'string') {
      try { changes = JSON.parse(changes); } catch { changes = [changes]; }
    }
    if (!Array.isArray(changes)) changes = [];
    return {
      id: row.id,
      version: row.version,
      reason: row.reason,
      changes,
      created_at: row.created_at,
      patient_id: row.patient_id ?? null,
    };
  });

  return c.json(parsed);
});

export default changelog;
