import { Hono } from 'hono';
import * as telegram from '../services/telegram';

const admin = new Hono();

// Helper to get current version
async function getCurrentVersion(db, patientId = 1) {
  const key = `current_version_${patientId}`;
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
  return row ? row.value : '1.0.0';
}

// Helper to save version
async function saveVersion(db, version, changes, reason, patientId = 1) {
  const key = `current_version_${patientId}`;
  const exists = await db.prepare("SELECT 1 FROM app_settings WHERE key = ?").bind(key).first();
  if (exists) {
    await db.prepare("UPDATE app_settings SET value = ? WHERE key = ?").bind(version, key).run();
  } else {
    await db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").bind(key, version).run();
  }
  await db.prepare("INSERT INTO app_versions (version, changes, reason, patient_id) VALUES (?, ?, ?, ?)").bind(
    version,
    JSON.stringify(changes),
    reason || 'Обновление данных',
    patientId
  ).run();
}

// ─── GET /api/admin/state ───────────────────────────────────

admin.get('/state', async (c) => {
  const pid = c.get('patientId') || 1;
  const db = c.env.DB;

  try {
    const [
      patient, diagnoses, medications, specialists, 
      medical_errors, plan, timelineRows, allDocs,
      reminders, comments, vaccinations, growth_log, lab_results
    ] = await Promise.all([
      db.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).first(),
      db.prepare('SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY id').bind(pid).all(),
      db.prepare('SELECT * FROM medications WHERE patient_id = ? ORDER BY id').bind(pid).all(),
      db.prepare('SELECT * FROM specialists WHERE patient_id = ? ORDER BY id').bind(pid).all(),
      db.prepare('SELECT * FROM medical_errors WHERE patient_id = ? ORDER BY id').bind(pid).all(),
      db.prepare('SELECT * FROM plan WHERE patient_id = ? ORDER BY id').bind(pid).all(),
      db.prepare('SELECT * FROM timeline WHERE patient_id = ? ORDER BY event_date DESC').bind(pid).all(),
      db.prepare('SELECT * FROM documents WHERE patient_id = ? ORDER BY id').bind(pid).all(),
      db.prepare('SELECT * FROM reminders WHERE patient_id = ? ORDER BY remind_at').bind(pid).all(),
      db.prepare('SELECT * FROM comments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50').bind(pid).all(),
      db.prepare('SELECT * FROM vaccinations WHERE patient_id = ? ORDER BY scheduled_date ASC').bind(pid).all(),
      db.prepare('SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC').bind(pid).all(),
      db.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_date DESC').bind(pid).all()
    ]);

    const docsByTimeline = {};
    const orphanDocs = [];
    for (const doc of allDocs.results) {
      if (doc.timeline_id) {
        if (!docsByTimeline[doc.timeline_id]) docsByTimeline[doc.timeline_id] = [];
        docsByTimeline[doc.timeline_id].push(doc);
      } else {
        orphanDocs.push(doc);
      }
    }

    const timeline = timelineRows.results.map(row => ({
      ...row,
      documents: docsByTimeline[row.id] || [],
    }));

    const version = await getCurrentVersion(db, pid);

    return c.json({
      version,
      patient,
      diagnoses: diagnoses.results,
      medications: medications.results,
      specialists: specialists.results,
      medical_errors: medical_errors.results,
      plan: plan.results,
      timeline,
      documents: orphanDocs,
      reminders: reminders.results,
      comments: comments.results,
      vaccinations: vaccinations.results,
      growth_log: growth_log.results,
      lab_results: lab_results.results,
    });
  } catch (err) {
    console.error('Admin state error:', err);
    return c.json({ error: 'Ошибка получения состояния: ' + err.message }, 500);
  }
});

// ─── POST /api/admin/import ─────────────────────────────────

admin.post('/import', async (c) => {
  const pid = c.get('patientId') || 1;
  const db = c.env.DB;
  const data = await c.req.json();
  const changeLog = [];
  const batch = [];

  // This is a simplified migration of the import logic.
  // Real implementation should handle all tables and actions.
  // D1 batch() is used to ensure atomicity.

  try {
    // 1. Process Timeline
    if (Array.isArray(data.timeline)) {
      for (const event of data.timeline) {
        if (event.id && event._action === 'update') {
          const sets = [];
          const vals = [];
          for (const key of ['title', 'description', 'category', 'event_date', 'notes']) {
            if (event[key] !== undefined) {
              sets.push(`${key} = ?`);
              vals.push(event[key]);
            }
          }
          if (sets.length > 0) {
            vals.push(event.id, pid);
            batch.push(db.prepare(`UPDATE timeline SET ${sets.join(', ')} WHERE id = ? AND patient_id = ?`).bind(...vals));
            changeLog.push(`Updated event: ${event.title || event.id}`);
          }
        } else if (event.id && event._action === 'delete') {
          batch.push(db.prepare('DELETE FROM timeline WHERE id = ? AND patient_id = ?').bind(event.id, pid));
          changeLog.push(`Deleted event: ${event.title || event.id}`);
        } else if (!event.id) {
          // New event (D1 doesn't support lastInsertRowid in batch easily for foreign keys)
          // For now, we skip complex nested inserts in this simplified version or handle them separately
          batch.push(db.prepare(
            `INSERT INTO timeline (title, description, category, event_date, notes, patient_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(event.title, event.description || null, event.category || null, event.event_date, event.notes || null, pid));
          changeLog.push(`Added event: ${event.title}`);
        }
      }
    }

    // 2. Process Diagnoses
    if (Array.isArray(data.diagnoses)) {
      for (const diag of data.diagnoses) {
        if (diag.id && diag._action === 'update') {
          batch.push(db.prepare('UPDATE diagnoses SET name = ?, icd_code = ?, status = ?, detail = ? WHERE id = ? AND patient_id = ?')
            .bind(diag.name, diag.icd_code || null, diag.status || 'active', diag.detail || null, diag.id, pid));
          changeLog.push(`Updated diagnosis: ${diag.name}`);
        } else if (diag.id && diag._action === 'delete') {
          batch.push(db.prepare('DELETE FROM diagnoses WHERE id = ? AND patient_id = ?').bind(diag.id, pid));
          changeLog.push(`Deleted diagnosis: ${diag.name}`);
        } else if (!diag.id) {
          batch.push(db.prepare('INSERT INTO diagnoses (name, icd_code, status, detail, patient_id) VALUES (?, ?, ?, ?, ?)')
            .bind(diag.name, diag.icd_code || null, diag.status || 'active', diag.detail || null, pid));
          changeLog.push(`Added diagnosis: ${diag.name}`);
        }
      }
    }

    // 3. Process Medications
    if (Array.isArray(data.medications)) {
      for (const med of data.medications) {
        if (med.id && med._action === 'update') {
          batch.push(db.prepare('UPDATE medications SET name = ?, dosage = ?, frequency = ?, status = ?, detail = ? WHERE id = ? AND patient_id = ?')
            .bind(med.name, med.dosage || null, med.frequency || null, med.status || 'active', med.detail || null, med.id, pid));
          changeLog.push(`Updated medication: ${med.name}`);
        } else if (med.id && med._action === 'delete') {
          batch.push(db.prepare('DELETE FROM medications WHERE id = ? AND patient_id = ?').bind(med.id, pid));
          changeLog.push(`Deleted medication: ${med.name}`);
        } else if (!med.id) {
          batch.push(db.prepare('INSERT INTO medications (name, dosage, frequency, status, detail, patient_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(med.name, med.dosage || null, med.frequency || null, med.status || 'active', med.detail || null, pid));
          changeLog.push(`Added medication: ${med.name}`);
        }
      }
    }

    if (batch.length > 0) {
      await db.batch(batch);
    }

    // Update version
    const currentVer = await getCurrentVersion(db, pid);
    const newVer = incrementVersion(currentVer);
    await saveVersion(db, newVer, changeLog, 'AI Import', pid);

    // Telegram notification
    const summary = changeLog.length > 5 ? `${changeLog.slice(0, 5).join('\n')}... (+${changeLog.length - 5})` : changeLog.join('\n');
    telegram.sendMessage(c.env, 
      `<b>[AI IMPORT SUCCESS]</b>\n\n` +
      `Данные успешно импортированы ИИ-координатором.\n\n` +
      `• Версия: <b>${newVer}</b>\n` +
      `• Пациент ID: ${pid}\n` +
      `• Изменений: ${changeLog.length}\n\n` +
      `<code>${summary}</code>`
    ).catch(() => {});

    return c.json({ ok: true, version: newVer, changes: changeLog });
  } catch (err) {
    console.error('Import error:', err);
    return c.json({ error: 'Import failed: ' + err.message }, 500);
  }
});

function incrementVersion(version) {
  const parts = version.split('.').map(Number);
  if (parts.length < 3) return '1.0.1';
  parts[2] += 1;
  return parts.join('.');
}

export default admin;
