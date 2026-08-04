import { Hono } from 'hono';
import * as backup from '../services/backup';
import { applyImport } from './admin';
import { checkRateLimit, clientRateKey } from '../services/rate-limit';

const adminTools = new Hono();

// GET /api/admin/tools/integrity
adminTools.get('/integrity', async (c) => {
  const db = c.env.DB;
  const ftsValid = [];
  for (const tbl of ['timeline_fts', 'documents_fts', 'comments_fts']) {
    try {
      await db.prepare(`INSERT INTO ${tbl}(${tbl}) VALUES ('integrity-check')`).run();
      ftsValid.push({ table: tbl, ok: true });
    } catch (e) {
      ftsValid.push({ table: tbl, ok: false, error: e.message });
    }
  }

  // Real-ish FK probes (D1 has limited PRAGMA support)
  let foreign_key_violations = [];
  try {
    const checks = await Promise.all([
      db.prepare(`
        SELECT 'prescriptions.medication_id' AS fk, p.id AS row_id
        FROM prescriptions p
        LEFT JOIN medications m ON m.id = p.medication_id
        WHERE p.medication_id IS NOT NULL AND m.id IS NULL
        LIMIT 50
      `).all(),
      db.prepare(`
        SELECT 'documents.timeline_id' AS fk, d.id AS row_id
        FROM documents d
        LEFT JOIN timeline t ON t.id = d.timeline_id
        WHERE d.timeline_id IS NOT NULL AND t.id IS NULL
        LIMIT 50
      `).all(),
      db.prepare(`
        SELECT 'visit_diagnoses.visit_id' AS fk, vd.visit_id AS row_id
        FROM visit_diagnoses vd
        LEFT JOIN timeline t ON t.id = vd.visit_id
        WHERE t.id IS NULL
        LIMIT 50
      `).all(),
    ]);
    foreign_key_violations = checks.flatMap((r) => r.results || []);
  } catch (e) {
    foreign_key_violations = [{ error: e.message }];
  }

  const fts_ok = ftsValid.every((f) => f.ok);
  const fk_ok = foreign_key_violations.length === 0
    || (foreign_key_violations.length === 1 && foreign_key_violations[0].error);

  return c.json({
    integrity: fts_ok && foreign_key_violations.filter((v) => !v.error).length === 0 ? 'ok' : 'issues',
    foreign_key_violations: foreign_key_violations.filter((v) => !v.error),
    fts_status: ftsValid,
    ok: fts_ok && foreign_key_violations.filter((v) => !v.error).length === 0,
  });
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

// POST /api/admin/tools/sql — tight rate limit; block dangerous multi-statement / write without allow
adminTools.post('/sql', async (c) => {
  const rl = await checkRateLimit(c.env.DB, clientRateKey(c, 'admin-sql'), {
    windowSec: 60,
    max: 20,
  });
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfterSec || 60));
    return c.json({ error: 'Too many SQL requests', retry_after_sec: rl.retryAfterSec }, 429);
  }

  const { sql, params = [], allow_write = false } = await c.req.json();
  if (!sql || typeof sql !== 'string') return c.json({ error: 'sql required' }, 400);
  if (/\b(PRAGMA|ATTACH|DETACH|LOAD_EXTENSION|VACUUM)\b/i.test(sql)) {
    return c.json({ error: 'forbidden statement' }, 403);
  }
  // Single statement only
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (stripped.includes(';') && stripped.replace(/;+\s*$/, '').includes(';')) {
    return c.json({ error: 'multiple statements not allowed' }, 400);
  }

  const upper = stripped.toUpperCase();
  const isSelect = upper.startsWith('SELECT') || upper.startsWith('WITH');
  if (!isSelect && !allow_write) {
    return c.json({ error: 'writes require allow_write: true' }, 403);
  }
  if (!isSelect && /\b(DROP|ALTER|CREATE)\b/i.test(upper)) {
    return c.json({ error: 'DDL not allowed via admin SQL' }, 403);
  }

  try {
    if (isSelect) {
      const { results } = await c.env.DB.prepare(sql).bind(...(params || [])).all();
      return c.json({ rows: results, count: results.length });
    }
    const result = await c.env.DB.prepare(sql).bind(...(params || [])).run();
    return c.json({ changes: result.meta?.changes ?? result.changes ?? 0 });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// GET /api/admin/tools/auth-log
adminTools.get('/auth-log', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);
  const event = c.req.query('event');
  try {
    let q = 'SELECT * FROM auth_log';
    const params = [];
    if (event) {
      q += ' WHERE event = ?';
      params.push(event);
    }
    q += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);
    const { results } = await c.env.DB.prepare(q).bind(...params).all();
    return c.json(results || []);
  } catch (e) {
    return c.json({ error: e.message, rows: [] }, 500);
  }
});

// GET /api/admin/tools/schema-info — quick health of migrations / key tables
adminTools.get('/schema-info', async (c) => {
  const db = c.env.DB;
  const tables = [];
  try {
    const { results } = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    for (const row of results || []) tables.push(row.name);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }

  let d1Migrations = [];
  try {
    const { results } = await db.prepare(
      'SELECT id, name, applied_at FROM d1_migrations ORDER BY id'
    ).all();
    d1Migrations = results || [];
  } catch {
    // table name may differ or not exist locally
  }

  const expected = [
    'patient', 'timeline', 'documents', 'diagnoses', 'medications',
    'sessions', 'auth_log', 'rate_limits', 'app_versions',
  ];
  const missing = expected.filter((t) => !tables.includes(t));

  return c.json({
    table_count: tables.length,
    tables,
    missing_expected: missing,
    d1_migrations: d1Migrations,
    ok: missing.length === 0,
  });
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

    const deadFks = orphanCheck?.fks || 0;
    const orphanDocs = orphanCheck?.docs || 0;
    const integrity_ok = deadFks === 0;
    const ready_to_work = integrity_ok && (pendingAi.results || []).length === 0;

    return c.json({
      integrity_ok,
      fk_violations: deadFks > 0 ? [{ type: 'prescriptions.medication_id', count: deadFks }] : [],
      pending_ai_requests: pendingAi.results,
      orphan_counts: { documents: orphanDocs, dead_fks: deadFks },
      new_since_review: {
        timeline: newTimeline.count,
        documents: newDocs.count,
        comments: newComments.count
      },
      ready_to_work,
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

// POST /api/admin/tools/backup-now
adminTools.post('/backup-now', async (c) => {
  // Выполняем в фоне, чтобы не ждать долго ответа
  c.executionCtx.waitUntil(backup.runBackup(c.env));
  return c.json({ ok: true, message: 'Backup task started in background' });
});

// POST /api/admin/tools/restore-from-backup
// Safe path: download latest B2 backup → unwrap → applyImport with wipe guard
// (refuses wipe if payload has no table arrays). Still does NOT restore B2 file bytes.
adminTools.post('/restore-from-backup', async (c) => {
  const pid = c.get('patientId') || 1;
  try {
    const state = await backup.restoreFromLatest(c.env);
    const payload = { ...state, wipe: true };
    const result = await applyImport(c.env.DB, payload, pid);
    return c.json({
      ok: true,
      message: 'Restore from latest B2 backup completed (metadata only; file blobs not re-uploaded)',
      import_details: result,
    });
  } catch (err) {
    console.error('[Restore] Failed:', err);
    const status = err.status || 500;
    return c.json({ error: 'Restore failed: ' + err.message }, status);
  }
});

export default adminTools;
