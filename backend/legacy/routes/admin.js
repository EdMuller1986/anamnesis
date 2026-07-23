const { Router } = require('express');
const pool = require('../db');
const rawDb = require('../db').rawDb;

const router = Router();

// ─── Helpers ────────────────────────────────────────────────

// Ensure patient_id column exists in app_versions
try { rawDb.exec('ALTER TABLE app_versions ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}

function getCurrentVersion(patientId = 1) {
  const key = `current_version_${patientId}`;
  const row = rawDb.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? row.value : '1.0.0';
}

function incrementVersion(version) {
  const parts = version.split('.').map(Number);
  parts[2] += 1;
  return parts.join('.');
}

function saveVersion(version, changes, reason, patientId = 1) {
  const key = `current_version_${patientId}`;
  const exists = rawDb.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(key);
  if (exists) {
    rawDb.prepare("UPDATE app_settings SET value = ? WHERE key = ?").run(version, key);
  } else {
    rawDb.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(key, version);
  }
  rawDb.prepare("INSERT INTO app_versions (version, changes, reason, patient_id) VALUES (?, ?, ?, ?)").run(
    version,
    JSON.stringify(changes),
    reason || 'Обновление данных',
    patientId
  );
}

// ─── GET /api/admin/state ───────────────────────────────────

router.get('/state', async (req, res) => {
  try {
    const pid = req.patientId;
    const patient = rawDb.prepare('SELECT * FROM patient WHERE id = ?').get(pid) || null;
    const diagnoses = rawDb.prepare('SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY id').all(pid);
    const medications = rawDb.prepare('SELECT * FROM medications WHERE patient_id = ? ORDER BY id').all(pid);
    const specialists = rawDb.prepare('SELECT * FROM specialists WHERE patient_id = ? ORDER BY id').all(pid);
    const medical_errors = rawDb.prepare('SELECT * FROM medical_errors WHERE patient_id = ? ORDER BY id').all(pid);
    const plan = rawDb.prepare('SELECT * FROM plan WHERE patient_id = ? ORDER BY sort_order, id').all(pid);

    // Timeline with documents
    const timelineRows = rawDb.prepare('SELECT * FROM timeline WHERE patient_id = ? ORDER BY event_date DESC').all(pid);
    const allDocs = rawDb.prepare('SELECT * FROM documents WHERE patient_id = ? ORDER BY id').all(pid);
    const docsByTimeline = {};
    const orphanDocs = [];
    for (const doc of allDocs) {
      if (doc.timeline_id) {
        if (!docsByTimeline[doc.timeline_id]) docsByTimeline[doc.timeline_id] = [];
        docsByTimeline[doc.timeline_id].push(doc);
      } else {
        orphanDocs.push(doc);
      }
    }
    const timeline = timelineRows.map(row => ({
      ...row,
      documents: docsByTimeline[row.id] || [],
    }));

    const reminders = rawDb.prepare('SELECT * FROM reminders WHERE patient_id = ? ORDER BY remind_at').all(pid);

    // Recent comments (last 50)
    const comments = rawDb.prepare('SELECT * FROM comments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50').all(pid);

    // New tables
    let vaccinations = [];
    let growth_log = [];
    let lab_results = [];
    try { vaccinations = rawDb.prepare('SELECT * FROM vaccinations WHERE patient_id = ? ORDER BY scheduled_date ASC').all(pid); } catch(e) {}
    try { growth_log = rawDb.prepare('SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC').all(pid); } catch(e) {}
    try { lab_results = rawDb.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_date DESC').all(pid); } catch(e) {}

    const version = getCurrentVersion();

    res.json({
      version,
      patient,
      diagnoses,
      medications,
      specialists,
      medical_errors,
      plan,
      timeline,
      documents: orphanDocs,
      reminders,
      comments,
      vaccinations,
      growth_log,
      lab_results,
    });
  } catch (err) {
    console.error('Admin state error:', err);
    res.status(500).json({ error: 'Ошибка получения состояния: ' + err.message });
  }
});

// ─── POST /api/admin/import ─────────────────────────────────

router.post('/import', async (req, res) => {
  const data = req.body;
  const changeLog = [];

  const transaction = rawDb.transaction(() => {
    // ── Timeline events ──────────────────────────────────
    if (Array.isArray(data.timeline)) {
      for (const event of data.timeline) {
        if (event.id && event._action === 'update') {
          const sets = [];
          const vals = [];
          for (const key of ['title', 'description', 'category', 'event_date', 'severity', 'badge_text', 'badge_color', 'notes']) {
            if (event[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(event[key]);
            }
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(event.id);
            rawDb.prepare(`UPDATE timeline SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`Обновлено событие: ${event.title || event.id}`);
          }
        } else if (event.id && event._action === 'delete') {
          rawDb.prepare('DELETE FROM timeline WHERE id = ?').run(event.id);
          changeLog.push(`Удалено событие: ${event.title || event.id}`);
        } else {
          // Insert new
          const info = rawDb.prepare(
            `INSERT INTO timeline (title, description, category, event_date, severity, badge_text, badge_color, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            event.title, event.description || null, event.category || null,
            event.event_date, event.severity || 'info',
            event.badge_text || null, event.badge_color || null, event.notes || null
          );
          const timelineId = info.lastInsertRowid;
          changeLog.push(`Добавлено событие: ${event.title} (${event.event_date})`);

          // Attach documents to this timeline event
          if (Array.isArray(event.documents)) {
            for (const doc of event.documents) {
              if (doc.id && doc._action === 'link') {
                // Link existing document to timeline
                rawDb.prepare('UPDATE documents SET timeline_id = ? WHERE id = ?').run(timelineId, doc.id);
                changeLog.push(`Привязан документ #${doc.id} к событию`);
              } else {
                rawDb.prepare(
                  `INSERT INTO documents (title, category, file_path, original_name, file_size, mime_type, notes, transcription, ai_assessment, timeline_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                  doc.title, doc.category || null, doc.file_path || null,
                  doc.original_name || null, doc.file_size || null, doc.mime_type || null,
                  doc.notes || null, doc.transcription || null, doc.ai_assessment || null,
                  timelineId
                );
                changeLog.push(`Добавлен документ: ${doc.title}`);
              }
            }
          }
        }
      }
    }

    // ── Medical errors ───────────────────────────────────
    if (Array.isArray(data.medical_errors)) {
      for (const err of data.medical_errors) {
        if (err.id && (err._action === 'update' || err._action === 'resolve')) {
          const sets = [];
          const vals = [];
          for (const key of ['title', 'description', 'severity', 'status', 'error_date', 'specialist_id', 'action_text', 'source_docs', 'detail', 'advice', 'ai_assessment', 'notes']) {
            if (err[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(err[key]);
            }
          }
          if (err._action === 'resolve' && !err.status) {
            sets.push('status = ?');
            vals.push('resolved');
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(err.id);
            rawDb.prepare(`UPDATE medical_errors SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`${err._action === 'resolve' ? 'Разрешена' : 'Обновлена'} ошибка: ${err.title || err.id}`);
          }
        } else if (err.id && err._action === 'delete') {
          rawDb.prepare('DELETE FROM medical_errors WHERE id = ?').run(err.id);
          changeLog.push(`Удалена ошибка: ${err.title || err.id}`);
        } else {
          // Insert new
          rawDb.prepare(
            `INSERT INTO medical_errors (title, description, severity, status, error_date, specialist_id, action_text, source_docs, detail, advice, ai_assessment, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            err.title, err.description, err.severity || 'medium', err.status || 'open',
            err.error_date || null, err.specialist_id || null,
            err.action_text || null, err.source_docs || null,
            err.detail || null, err.advice || null, err.ai_assessment || null, err.notes || null
          );
          changeLog.push(`Добавлена ошибка: ${err.title}`);
        }
      }
    }

    // ── Plan items ───────────────────────────────────────
    if (Array.isArray(data.plan)) {
      for (const item of data.plan) {
        if (item.id && (item._action === 'update' || item._action === 'complete')) {
          const sets = [];
          const vals = [];
          for (const key of ['title', 'description', 'detail', 'priority', 'status', 'due_date', 'sort_order', 'advice', 'ai_assessment', 'notes']) {
            if (item[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(item[key]);
            }
          }
          if (item._action === 'complete' && !item.status) {
            sets.push('status = ?');
            vals.push('completed');
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(item.id);
            rawDb.prepare(`UPDATE plan SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`${item._action === 'complete' ? 'Завершён' : 'Обновлён'} пункт плана: ${item.title || item.id}`);
          }
        } else if (item.id && item._action === 'delete') {
          rawDb.prepare('DELETE FROM plan WHERE id = ?').run(item.id);
          changeLog.push(`Удалён пункт плана: ${item.title || item.id}`);
        } else {
          // Insert new
          rawDb.prepare(
            `INSERT INTO plan (title, description, detail, priority, status, due_date, sort_order, advice, ai_assessment, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            item.title, item.description || null, item.detail || null,
            item.priority || 'medium', item.status || 'pending',
            item.due_date || null, item.sort_order || 0,
            item.advice || null, item.ai_assessment || null, item.notes || null
          );
          changeLog.push(`Добавлен пункт плана: ${item.title}`);
        }
      }
    }

    // ── Medications ───────────────────────────────────────
    if (Array.isArray(data.medications)) {
      for (const med of data.medications) {
        if (med.id && med._action === 'update') {
          const sets = [];
          const vals = [];
          for (const key of ['name', 'dosage', 'frequency', 'start_date', 'end_date', 'prescribed_by', 'status', 'detail', 'ai_assessment', 'notes']) {
            if (med[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(med[key]);
            }
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(med.id);
            rawDb.prepare(`UPDATE medications SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`Обновлён препарат: ${med.name || med.id}`);
          }
        } else if (med.id && med._action === 'delete') {
          rawDb.prepare('DELETE FROM medications WHERE id = ?').run(med.id);
          changeLog.push(`Удалён препарат: ${med.name || med.id}`);
        } else {
          rawDb.prepare(
            `INSERT INTO medications (name, dosage, frequency, start_date, end_date, prescribed_by, status, detail, ai_assessment, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            med.name, med.dosage || null, med.frequency || null,
            med.start_date || null, med.end_date || null, med.prescribed_by || null,
            med.status || 'active', med.detail || null, med.ai_assessment || null, med.notes || null
          );
          changeLog.push(`Добавлен препарат: ${med.name}`);
        }
      }
    }

    // ── Diagnoses ────────────────────────────────────────
    if (Array.isArray(data.diagnoses)) {
      for (const diag of data.diagnoses) {
        if (diag.id && diag._action === 'update') {
          const sets = [];
          const vals = [];
          for (const key of ['name', 'icd_code', 'status', 'diagnosed_date', 'source', 'detail', 'ai_assessment', 'notes']) {
            if (diag[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(diag[key]);
            }
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(diag.id);
            rawDb.prepare(`UPDATE diagnoses SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`Обновлён диагноз: ${diag.name || diag.id}`);
          }
        } else if (diag.id && diag._action === 'delete') {
          rawDb.prepare('DELETE FROM diagnoses WHERE id = ?').run(diag.id);
          changeLog.push(`Удалён диагноз: ${diag.name || diag.id}`);
        } else {
          rawDb.prepare(
            `INSERT INTO diagnoses (name, icd_code, status, diagnosed_date, source, detail, ai_assessment, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            diag.name, diag.icd_code || null, diag.status || 'active',
            diag.diagnosed_date || null, diag.source || null,
            diag.detail || null, diag.ai_assessment || null, diag.notes || null
          );
          changeLog.push(`Добавлен диагноз: ${diag.name}`);
        }
      }
    }

    // ── Specialists ──────────────────────────────────────
    if (Array.isArray(data.specialists)) {
      for (const spec of data.specialists) {
        if (spec.id && spec._action === 'update') {
          const sets = [];
          const vals = [];
          for (const key of ['full_name', 'specialization', 'clinic', 'phone', 'email', 'status', 'notes']) {
            if (spec[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(spec[key]);
            }
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(spec.id);
            rawDb.prepare(`UPDATE specialists SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`Обновлён специалист: ${spec.full_name || spec.specialization || spec.id}`);
          }
        } else if (spec.id && spec._action === 'delete') {
          rawDb.prepare('DELETE FROM specialists WHERE id = ?').run(spec.id);
          changeLog.push(`Удалён специалист: ${spec.full_name || spec.id}`);
        } else {
          rawDb.prepare(
            `INSERT INTO specialists (full_name, specialization, clinic, phone, email, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            spec.full_name || null, spec.specialization, spec.clinic || null,
            spec.phone || null, spec.email || null, spec.status || 'active', spec.notes || null
          );
          changeLog.push(`Добавлен специалист: ${spec.full_name || spec.specialization}`);
        }
      }
    }

    // ── Reminders ────────────────────────────────────────
    if (Array.isArray(data.reminders)) {
      for (const rem of data.reminders) {
        if (rem.id && rem._action === 'update') {
          const sets = [];
          const vals = [];
          for (const key of ['title', 'message', 'remind_at', 'repeat_cron', 'status', 'notes']) {
            if (rem[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(rem[key]);
            }
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(rem.id);
            rawDb.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`Обновлено напоминание: ${rem.title || rem.id}`);
          }
        } else if (rem.id && rem._action === 'delete') {
          rawDb.prepare('DELETE FROM reminders WHERE id = ?').run(rem.id);
          changeLog.push(`Удалено напоминание: ${rem.title || rem.id}`);
        } else {
          rawDb.prepare(
            `INSERT INTO reminders (title, message, remind_at, repeat_cron, status, notes)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            rem.title, rem.message || null, rem.remind_at,
            rem.repeat_cron || null, rem.status || 'pending', rem.notes || null
          );
          changeLog.push(`Добавлено напоминание: ${rem.title}`);
        }
      }
    }

    // ── Vaccinations ─────────────────────────────────────
    if (Array.isArray(data.vaccinations)) {
      for (const vac of data.vaccinations) {
        if (vac.id && vac._action === 'update') {
          const sets = [];
          const vals = [];
          for (const key of ['name', 'vaccine_name', 'dose_number', 'scheduled_date', 'actual_date', 'status', 'administered_by', 'batch_number', 'reaction', 'notes']) {
            if (vac[key] !== undefined) { sets.push(`${key} = ?`); vals.push(vac[key]); }
          }
          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            vals.push(vac.id);
            rawDb.prepare(`UPDATE vaccinations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            changeLog.push(`Обновлена прививка: ${vac.name || vac.id}`);
          }
        } else if (vac.id && vac._action === 'delete') {
          rawDb.prepare('DELETE FROM vaccinations WHERE id = ?').run(vac.id);
          changeLog.push(`Удалена прививка: ${vac.name || vac.id}`);
        } else {
          rawDb.prepare(
            `INSERT INTO vaccinations (name, vaccine_name, dose_number, scheduled_date, actual_date, status, administered_by, batch_number, reaction, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(vac.name, vac.vaccine_name || null, vac.dose_number || 1, vac.scheduled_date || null, vac.actual_date || null, vac.status || 'scheduled', vac.administered_by || null, vac.batch_number || null, vac.reaction || null, vac.notes || null);
          changeLog.push(`Добавлена прививка: ${vac.name}`);
        }
      }
    }

    // ── Growth log ────────────────────────────────────────
    if (Array.isArray(data.growth_log)) {
      for (const g of data.growth_log) {
        if (g.id && g._action === 'delete') {
          rawDb.prepare('DELETE FROM growth_log WHERE id = ?').run(g.id);
          changeLog.push(`Удалено измерение роста #${g.id}`);
        } else {
          rawDb.prepare(
            `INSERT INTO growth_log (measured_at, height_cm, weight_kg, head_circumference_cm, notes)
             VALUES (?, ?, ?, ?, ?)`
          ).run(g.measured_at, g.height_cm || null, g.weight_kg || null, g.head_circumference_cm || null, g.notes || null);
          changeLog.push(`Добавлено измерение роста: ${g.measured_at}`);
        }
      }
    }

    // ── Lab results ───────────────────────────────────────
    if (Array.isArray(data.lab_results)) {
      for (const l of data.lab_results) {
        if (l.id && l._action === 'delete') {
          rawDb.prepare('DELETE FROM lab_results WHERE id = ?').run(l.id);
          changeLog.push(`Удалён результат анализа #${l.id}`);
        } else {
          rawDb.prepare(
            `INSERT INTO lab_results (test_date, test_name, parameter, value, unit, ref_min, ref_max, status, timeline_id, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(l.test_date, l.test_name, l.parameter, l.value || null, l.unit || null, l.ref_min || null, l.ref_max || null, l.status || 'normal', l.timeline_id || null, l.notes || null);
          changeLog.push(`Добавлен результат: ${l.test_name} — ${l.parameter}`);
        }
      }
    }

    // ── Comments processing ──────────────────────────────
    if (Array.isArray(data.comments)) {
      for (const comment of data.comments) {
        if (comment._action === 'respond') {
          // Admin response to a user comment
          rawDb.prepare(
            'INSERT INTO comments (entity_type, entity_id, text) VALUES (?, ?, ?)'
          ).run(comment.entity_type, comment.entity_id, comment.text);
          changeLog.push(`Ответ на комментарий (${comment.entity_type} #${comment.entity_id})`);
        } else if (comment._action === 'delete' && comment.id) {
          rawDb.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
          changeLog.push(`Удалён комментарий #${comment.id}`);
        } else if (!comment._action || comment._action === 'add') {
          rawDb.prepare(
            'INSERT INTO comments (entity_type, entity_id, text) VALUES (?, ?, ?)'
          ).run(comment.entity_type, comment.entity_id, comment.text);
          changeLog.push(`Добавлен комментарий к ${comment.entity_type} #${comment.entity_id}`);
        }
      }
    }

    // ── Patient update ───────────────────────────────────
    if (data.patient) {
      const p = data.patient;
      const sets = [];
      const vals = [];
      for (const key of ['full_name', 'date_of_birth', 'gender', 'blood_type', 'birth_weight_g', 'birth_height_cm', 'apgar', 'birth_notes', 'current_height_cm', 'current_weight_kg', 'city', 'allergies', 'notes']) {
        if (p[key] !== undefined) {
          sets.push(`${key} = ?`);
          vals.push(p[key]);
        }
      }
      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        vals.push(req.patientId || 1);
        rawDb.prepare(`UPDATE patient SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        changeLog.push('Обновлены данные пациента');
      }
    }

    // ── Version increment ────────────────────────────────
    const pid = req.patientId || 1;
    if (changeLog.length > 0) {
      const oldVersion = getCurrentVersion(pid);
      const newVersion = incrementVersion(oldVersion);
      const reason = data._reason || 'Обновление данных';
      saveVersion(newVersion, changeLog, reason, pid);
      return newVersion;
    }
    return getCurrentVersion(pid);
  });

  try {
    const newVersion = transaction();
    res.json({
      success: true,
      version: newVersion,
      changes: changeLog,
      changes_count: changeLog.length,
    });
  } catch (err) {
    console.error('Admin import error:', err);
    res.status(500).json({ error: 'Ошибка импорта: ' + err.message });
  }
});

// ─── GET /api/version ───────────────────────────────────────

router.get('/version', (req, res) => {
  try {
    const pid = req.patientId || 1;
    const version = getCurrentVersion(pid);
    res.json({ version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/changelog ─────────────────────────────────────

router.get('/changelog', (req, res) => {
  try {
    const pid = req.patientId || 1;
    const rows = rawDb.prepare('SELECT * FROM app_versions WHERE patient_id = ? ORDER BY id DESC').all(pid);
    const result = rows.map(row => ({
      ...row,
      changes: JSON.parse(row.changes || '[]'),
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
