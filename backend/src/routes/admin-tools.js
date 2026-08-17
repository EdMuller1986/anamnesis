import { Hono } from 'hono';
import * as backup from '../services/backup';
import { applyImport } from './admin';
import { checkRateLimit, clientRateKey } from '../services/rate-limit';

const adminTools = new Hono();

// GET /api/admin/tools — catalog of available tools
adminTools.get('/', async (c) => {
  return c.json({
    tools: [
      { method: 'GET', path: '/integrity' },
      { method: 'GET', path: '/orphan-check', query: 'include_b2=1' },
      { method: 'GET', path: '/schema-info' },
      { method: 'GET', path: '/auth-log' },
      { method: 'GET', path: '/backup-status' },
      { method: 'GET', path: '/backups' },
      { method: 'POST', path: '/inspect-backup', body: '{ key? }' },
      { method: 'POST', path: '/validate-restore', query: 'key=backups/…', body: '{ key? }' },
      { method: 'POST', path: '/backup-now', query: 'wait=1&include_files=1&force=1' },
      { method: 'POST', path: '/restore-from-backup', query: 'dry_run=1&key=backups/…&restore_files=1', body: '{"confirm":"WIPE"}' },
      { method: 'POST', path: '/sql', body: '{ sql, params?, allow_write? }' },
      { method: 'GET', path: '/search?q=' },
      { method: 'GET', path: '/ai-review' },
      { method: 'GET', path: '/changelog' },
      { method: 'GET', path: '/impact?type=&id=' },
    ],
  });
});

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
// ?include_b2=1 — also compare document/vaccination keys vs B2 listing (slower)
adminTools.get('/orphan-check', async (c) => {
  const pid = c.get('patientId') || 1;
  const includeB2 = c.req.query('include_b2') === '1' || c.req.query('include_b2') === 'true';

  const results = await Promise.all([
    c.env.DB.prepare('SELECT p.id, p.medication_id FROM prescriptions p LEFT JOIN medications m ON m.id = p.medication_id WHERE p.patient_id = ? AND p.medication_id IS NOT NULL AND m.id IS NULL').bind(pid).all(),
    c.env.DB.prepare('SELECT id, title FROM documents WHERE patient_id = ? AND timeline_id IS NULL AND (source_doctor IS NULL OR source_doctor = "")').bind(pid).all(),
    c.env.DB.prepare('SELECT m.id, m.name FROM medications m WHERE m.patient_id = ? AND NOT EXISTS (SELECT 1 FROM prescriptions p WHERE p.medication_id = m.id)').bind(pid).all()
  ]);

  const payload = {
    dead_fk: results[0].results,
    orphan_docs: results[1].results,
    orphan_meds: results[2].results,
  };

  if (includeB2) {
    try {
      const b2mod = await import('../services/b2-storage.js');
      const { results: docs } = await c.env.DB.prepare(
        'SELECT id, file_path FROM documents WHERE patient_id = ? AND file_path IS NOT NULL'
      ).bind(pid).all();
      const { results: vacs } = await c.env.DB.prepare(
        'SELECT id, photos FROM vaccinations WHERE patient_id = ?'
      ).bind(pid).all();

      const dbKeys = new Set();
      for (const d of docs || []) if (d.file_path) dbKeys.add(d.file_path);
      for (const v of vacs || []) {
        try {
          for (const p of JSON.parse(v.photos || '[]')) {
            if (p) dbKeys.add(String(p).replace(/^\/api\/vaccinations\/photos\//, ''));
          }
        } catch { /* skip */ }
      }

      // List non-system prefixes (documents often root UUID keys; photos under vaccinations/)
      const listed = await b2mod.listAllFiles(c.env, '');
      const b2Keys = new Set(
        (listed || [])
          .map((o) => o.Key)
          .filter((k) => k && !k.startsWith('backups/') && !k.startsWith('system/'))
      );

      const missing_in_b2 = [...dbKeys].filter((k) => !b2Keys.has(k));
      const orphan_in_b2 = [...b2Keys].filter((k) => !dbKeys.has(k)).slice(0, 200);

      payload.b2 = {
        db_keys: dbKeys.size,
        b2_keys: b2Keys.size,
        missing_in_b2,
        orphan_in_b2_sample: orphan_in_b2,
        orphan_in_b2_truncated: orphan_in_b2.length >= 200,
      };
    } catch (e) {
      payload.b2 = { error: e.message };
    }
  }

  return c.json(payload);
});

// GET /api/admin/tools/backup-status — last cron/manual backup outcome
adminTools.get('/backup-status', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'last_backup_status'"
    ).first();
    const hash = await c.env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'last_backup_hash'"
    ).first();
    let status = null;
    if (row?.value) {
      try { status = JSON.parse(row.value); } catch { status = { raw: row.value }; }
    }
    let age_hours = null;
    if (status?.at) {
      age_hours = Math.round((Date.now() - new Date(status.at).getTime()) / 3600000);
    }
    return c.json({
      last_backup_status: status,
      last_backup_hash: hash?.value || null,
      age_hours,
      stale: age_hours != null ? age_hours > 36 : null,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/admin/tools/inspect-backup — decrypt & summarize without restore
// Body optional: { "key": "backups/..." } or query ?key=
adminTools.post('/inspect-backup', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch { /* empty */ }
  const key = body.key || c.req.query('key') || 'system/latest-backup.json.gz.enc';
  try {
    const { state, key: usedKey } = await backup.restoreFromKey(c.env, key);
    const summary = backup.summarizeBackupState(state);
    return c.json({
      ok: true,
      backup_key: usedKey,
      summary,
      notes: state.notes || null,
      backup_errors: state.backup_errors || null,
    });
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

// POST /api/admin/tools/validate-restore — staging check (no writes)
// Compares backup vs live D1 counts; validates readiness before WIPE.
// Body optional: { "key": "..." } or query ?key=
adminTools.post('/validate-restore', async (c) => {
  const pid = c.get('patientId') || 1;
  let body = {};
  try { body = await c.req.json(); } catch { /* empty */ }
  const key = body.key || c.req.query('key') || 'system/latest-backup.json.gz.enc';

  const rl = await checkRateLimit(c.env.DB, clientRateKey(c, 'admin-validate-restore'), {
    windowSec: 60,
    max: 15,
  });
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfterSec || 60));
    return c.json({ error: 'Too many validate-restore requests', retry_after_sec: rl.retryAfterSec }, 429);
  }

  try {
    const { state, key: usedKey } = await backup.restoreFromKey(c.env, key);
    const report = await backup.validateRestoreAgainstLive(c.env.DB, state, pid);
    return c.json({
      ok: report.ready,
      backup_key: usedKey,
      ...report,
    }, report.ready ? 200 : 422);
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
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

  let audit_triggers = [];
  try {
    const { results } = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'audit_%' ORDER BY name"
    ).all();
    audit_triggers = (results || []).map((r) => r.name);
  } catch { /* ignore */ }

  const expectedAuditPrefixes = [
    'audit_timeline_', 'audit_documents_', 'audit_diagnoses_', 'audit_medications_',
    'audit_prescriptions_', 'audit_plan_', 'audit_errors_', 'audit_labs_',
    'audit_specialists_', 'audit_comments_', 'audit_vaccinations_', 'audit_growth_',
    'audit_reminders_',
  ];
  // Expect at least insert+update+delete (3) per family except partial legacy names
  const audit_ok = audit_triggers.length >= 30;

  return c.json({
    table_count: tables.length,
    tables,
    missing_expected: missing,
    d1_migrations: d1Migrations,
    audit_triggers,
    audit_trigger_count: audit_triggers.length,
    audit_ok,
    expected_audit_families: expectedAuditPrefixes,
    ok: missing.length === 0 && audit_ok,
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

// GET /api/admin/tools/backups — list encrypted backups in B2
adminTools.get('/backups', async (c) => {
  try {
    const b2mod = await import('../services/b2-storage.js');
    const files = await b2mod.listAllFiles(c.env, 'backups/');
    const list = (files || [])
      .map((f) => ({
        key: f.Key,
        size: f.Size,
        last_modified: f.LastModified,
      }))
      .sort((a, b) => String(b.last_modified).localeCompare(String(a.last_modified)));
    return c.json({ count: list.length, backups: list });
  } catch (e) {
    return c.json({ error: e.message, backups: [] }, 500);
  }
});

// POST /api/admin/tools/backup-now
// Query:
//   wait=1 — await result (recommended for include_files)
//   include_files=1 — embed B2 object bytes (size-capped) into encrypted backup
//   force=1 — write even if content hash unchanged
adminTools.post('/backup-now', async (c) => {
  const includeFiles = c.req.query('include_files') === '1' || c.req.query('include_files') === 'true';
  const force = c.req.query('force') === '1' || c.req.query('force') === 'true';
  const opts = { includeFiles, force };

  // File packing is slow/memory-heavy — always await when include_files
  const shouldWait = includeFiles
    || c.req.query('wait') === '1'
    || c.req.query('wait') === 'true';

  if (shouldWait) {
    const result = await backup.runBackup(c.env, opts);
    return c.json(result);
  }
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(backup.runBackup(c.env, opts));
    return c.json({ ok: true, message: 'Backup task started in background', include_files: includeFiles });
  }
  const result = await backup.runBackup(c.env, opts);
  return c.json(result);
});

// POST /api/admin/tools/restore-from-backup
// Query:
//   dry_run=1 — download + summarize only
//   key=backups/xxx.json.gz.enc — restore from a specific object (default: system/latest)
//   skip_snapshot=1 — do not write pre-restore snapshot to B2
//   restore_files=1 — re-upload embedded b2_file_blobs (if present in backup)
// Body (required unless dry_run): { "confirm": "WIPE" }
adminTools.post('/restore-from-backup', async (c) => {
  const pid = c.get('patientId') || 1;
  const dryRun = c.req.query('dry_run') === '1' || c.req.query('dry_run') === 'true';
  const skipSnapshot = c.req.query('skip_snapshot') === '1' || c.req.query('skip_snapshot') === 'true';
  const restoreFiles = c.req.query('restore_files') === '1' || c.req.query('restore_files') === 'true';
  const key = c.req.query('key') || 'system/latest-backup.json.gz.enc';

  const rl = await checkRateLimit(c.env.DB, clientRateKey(c, 'admin-restore'), {
    windowSec: 300,
    max: 5,
  });
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfterSec || 300));
    return c.json({ error: 'Too many restore attempts', retry_after_sec: rl.retryAfterSec }, 429);
  }

  try {
    const { state, key: usedKey } = await backup.restoreFromKey(c.env, key);
    if (dryRun) {
      const summary = backup.summarizeBackupState(state);
      const staging = await backup.validateRestoreAgainstLive(c.env.DB, state, pid);
      return c.json({
        ok: true,
        dry_run: true,
        staging: true,
        message: 'Dry-run only — nothing written. To apply, POST again with body {"confirm":"WIPE"}'
          + (summary.b2_embedded_files
            ? `; backup has ${summary.b2_embedded_files} embedded file(s) — add restore_files=1 to re-upload`
            : ' (no embedded file bytes; metadata only)'),
        backup_key: usedKey,
        summary,
        staging_report: staging,
        would_wipe: true,
        would_restore_files: restoreFiles,
        patient_id: pid,
      });
    }

    let body = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    if (body.confirm !== 'WIPE') {
      return c.json({
        error: 'Destructive restore requires body: {"confirm":"WIPE"}',
        hint: 'Run dry_run=1 first to inspect counts',
      }, 400);
    }

    let snapshot = null;
    if (!skipSnapshot) {
      snapshot = await backup.snapshotBeforeRestore(c.env);
    }

    const payload = { ...state, wipe: true };
    const result = await applyImport(c.env.DB, payload, pid);

    let files_restored = null;
    if (restoreFiles) {
      files_restored = await backup.restoreEmbeddedFiles(c.env, state);
    }

    // Post-restore row counts for the active patient (sanity check)
    const verification = await verifyPatientCounts(c.env.DB, pid);

    return c.json({
      ok: true,
      message: restoreFiles
        ? 'Restore completed (metadata + embedded file re-upload attempted)'
        : 'Restore completed (metadata only; pass restore_files=1 if backup has b2_file_blobs)',
      backup_key: usedKey,
      pre_restore_snapshot: snapshot,
      import_details: result,
      files_restored,
      verification,
    });
  } catch (err) {
    console.error('[Restore] Failed:', err);
    const status = err.status || 500;
    return c.json({ error: 'Restore failed: ' + err.message }, status);
  }
});

/** Count key tables for post-restore verification. */
async function verifyPatientCounts(db, pid) {
  const tables = [
    'timeline', 'documents', 'diagnoses', 'medications', 'specialists',
    'vaccinations', 'prescriptions', 'comments', 'plan', 'reminders',
  ];
  const counts = {};
  for (const t of tables) {
    try {
      const row = await db.prepare(
        `SELECT COUNT(*) AS c FROM ${t} WHERE patient_id = ?`
      ).bind(pid).first();
      counts[t] = row?.c ?? row?.['COUNT(*)'] ?? 0;
    } catch (e) {
      counts[t] = { error: e.message };
    }
  }
  return { patient_id: pid, counts };
}

export default adminTools;
