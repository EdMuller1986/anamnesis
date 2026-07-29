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

  try {
    // 0. Optional Wipe (Full Restore)
    if (data.wipe === true) {
      const tablesToWipe = [
        'timeline', 'documents', 'diagnoses', 'medications', 
        'specialists', 'lab_results', 'vaccinations', 'growth_log', 
        'plan', 'medical_errors', 'reminders', 'prescriptions',
        'ai_requests', 'visit_diagnoses'
      ];
      for (const t of tablesToWipe) {
        batch.push(db.prepare(`DELETE FROM ${t} WHERE patient_id = ?`).bind(pid));
      }
      changeLog.push('Wiped all existing patient data for full restore');
    }

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

    // 4. Process Specialists
    if (Array.isArray(data.specialists)) {
      for (const spec of data.specialists) {
        if (spec.id && spec._action === 'update') {
          batch.push(db.prepare('UPDATE specialists SET full_name = ?, specialization = ?, clinic = ?, notes = ? WHERE id = ? AND patient_id = ?')
            .bind(spec.full_name, spec.specialization || null, spec.clinic || null, spec.notes || null, spec.id, pid));
          changeLog.push(`Updated specialist: ${spec.full_name}`);
        } else if (spec.id && spec._action === 'delete') {
          batch.push(db.prepare('DELETE FROM specialists WHERE id = ? AND patient_id = ?').bind(spec.id, pid));
          changeLog.push(`Deleted specialist: ${spec.full_name}`);
        } else if (!spec.id) {
          batch.push(db.prepare('INSERT INTO specialists (full_name, specialization, clinic, notes, patient_id) VALUES (?, ?, ?, ?, ?)')
            .bind(spec.full_name, spec.specialization || null, spec.clinic || null, spec.notes || null, pid));
          changeLog.push(`Added specialist: ${spec.full_name}`);
        }
      }
    }

    // 5. Process Lab Results
    if (Array.isArray(data.lab_results)) {
      for (const lab of data.lab_results) {
        if (lab.id && lab._action === 'update') {
          batch.push(db.prepare('UPDATE lab_results SET test_date = ?, test_name = ?, parameter = ?, value = ?, unit = ?, ref_min = ?, ref_max = ?, status = ?, notes = ? WHERE id = ? AND patient_id = ?')
            .bind(lab.test_date, lab.test_name, lab.parameter, lab.value, lab.unit, lab.ref_min, lab.ref_max, lab.status || 'normal', lab.notes || null, lab.id, pid));
          changeLog.push(`Updated lab result: ${lab.test_name} - ${lab.parameter}`);
        } else if (lab.id && lab._action === 'delete') {
          batch.push(db.prepare('DELETE FROM lab_results WHERE id = ? AND patient_id = ?').bind(lab.id, pid));
          changeLog.push(`Deleted lab result: ${lab.id}`);
        } else if (!lab.id) {
          batch.push(db.prepare('INSERT INTO lab_results (test_date, test_name, parameter, value, unit, ref_min, ref_max, status, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(lab.test_date, lab.test_name, lab.parameter, lab.value, lab.unit, lab.ref_min, lab.ref_max, lab.status || 'normal', lab.notes || null, pid));
          changeLog.push(`Added lab result: ${lab.test_name} - ${lab.parameter}`);
        }
      }
    }

    // 6. Process Vaccinations
    if (Array.isArray(data.vaccinations)) {
      for (const vac of data.vaccinations) {
        if (vac.id && vac._action === 'update') {
          batch.push(db.prepare('UPDATE vaccinations SET name = ?, vaccine_name = ?, dose_number = ?, scheduled_date = ?, actual_date = ?, status = ?, reaction = ?, notes = ? WHERE id = ? AND patient_id = ?')
            .bind(vac.name, vac.vaccine_name || null, vac.dose_number || 1, vac.scheduled_date || null, vac.actual_date || null, vac.status || 'scheduled', vac.reaction || null, vac.notes || null, vac.id, pid));
          changeLog.push(`Updated vaccination: ${vac.name}`);
        } else if (vac.id && vac._action === 'delete') {
          batch.push(db.prepare('DELETE FROM vaccinations WHERE id = ? AND patient_id = ?').bind(vac.id, pid));
          changeLog.push(`Deleted vaccination: ${vac.name}`);
        } else if (!vac.id) {
          batch.push(db.prepare('INSERT INTO vaccinations (name, vaccine_name, dose_number, scheduled_date, actual_date, status, reaction, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(vac.name, vac.vaccine_name || null, vac.dose_number || 1, vac.scheduled_date || null, vac.actual_date || null, vac.status || 'scheduled', vac.reaction || null, vac.notes || null, pid));
          changeLog.push(`Added vaccination: ${vac.name}`);
        }
      }
    }

    // 7. Process Growth Log
    if (Array.isArray(data.growth_log)) {
      for (const g of data.growth_log) {
        if (g.id && g._action === 'update') {
          batch.push(db.prepare('UPDATE growth_log SET measured_at = ?, height_cm = ?, weight_kg = ?, head_circumference_cm = ?, notes = ? WHERE id = ? AND patient_id = ?')
            .bind(g.measured_at, g.height_cm, g.weight_kg, g.head_circumference_cm || null, g.notes || null, g.id, pid));
          changeLog.push(`Updated growth record: ${g.measured_at}`);
        } else if (g.id && g._action === 'delete') {
          batch.push(db.prepare('DELETE FROM growth_log WHERE id = ? AND patient_id = ?').bind(g.id, pid));
          changeLog.push(`Deleted growth record: ${g.id}`);
        } else if (!g.id) {
          batch.push(db.prepare('INSERT INTO growth_log (measured_at, height_cm, weight_kg, head_circumference_cm, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(g.measured_at, g.height_cm, g.weight_kg, g.head_circumference_cm || null, g.notes || null, pid));
          changeLog.push(`Added growth record: ${g.measured_at}`);
        }
      }
    }

    // 8. Process Plan
    if (Array.isArray(data.plan)) {
      for (const p of data.plan) {
        if (p.id && p._action === 'update') {
          batch.push(db.prepare('UPDATE plan SET title = ?, detail = ?, advice = ?, status = ?, priority = ?, due_date = ?, outcome = ? WHERE id = ? AND patient_id = ?')
            .bind(p.title, p.detail || null, p.advice || null, p.status || 'pending', p.priority || 'medium', p.due_date || null, p.outcome || null, p.id, pid));
          changeLog.push(`Updated plan task: ${p.title}`);
        } else if (p.id && p._action === 'delete') {
          batch.push(db.prepare('DELETE FROM plan WHERE id = ? AND patient_id = ?').bind(p.id, pid));
          changeLog.push(`Deleted plan task: ${p.title}`);
        } else if (!p.id) {
          batch.push(db.prepare('INSERT INTO plan (title, detail, advice, status, priority, due_date, outcome, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(p.title, p.detail || null, p.advice || null, p.status || 'pending', p.priority || 'medium', p.due_date || null, p.outcome || null, pid));
          changeLog.push(`Added plan task: ${p.title}`);
        }
      }
    }

    // 9. Process Medical Errors
    if (Array.isArray(data.medical_errors)) {
      for (const e of data.medical_errors) {
        if (e.id && e._action === 'update') {
          batch.push(db.prepare('UPDATE medical_errors SET title = ?, detail = ?, advice = ?, severity = ?, status = ?, resolution = ? WHERE id = ? AND patient_id = ?')
            .bind(e.title, e.detail || null, e.advice || null, e.severity || 'medium', e.status || 'open', e.resolution || null, e.id, pid));
          changeLog.push(`Updated anomaly/error: ${e.title}`);
        } else if (e.id && e._action === 'delete') {
          batch.push(db.prepare('DELETE FROM medical_errors WHERE id = ? AND patient_id = ?').bind(e.id, pid));
          changeLog.push(`Deleted anomaly/error: ${e.title}`);
        } else if (!e.id) {
          batch.push(db.prepare('INSERT INTO medical_errors (title, detail, advice, severity, status, resolution, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(e.title, e.detail || null, e.advice || null, e.severity || 'medium', e.status || 'open', e.resolution || null, pid));
          changeLog.push(`Added anomaly/error: ${e.title}`);
        }
      }
    }

    // 10. Process Reminders
    if (Array.isArray(data.reminders)) {
      for (const r of data.reminders) {
        if (r.id && r._action === 'update') {
          batch.push(db.prepare('UPDATE reminders SET title = ?, remind_at = ?, status = ? WHERE id = ? AND patient_id = ?')
            .bind(r.title, r.remind_at, r.status || 'pending', r.id, pid));
          changeLog.push(`Updated reminder: ${r.title}`);
        } else if (r.id && r._action === 'delete') {
          batch.push(db.prepare('DELETE FROM reminders WHERE id = ? AND patient_id = ?').bind(r.id, pid));
          changeLog.push(`Deleted reminder: ${r.title}`);
        } else if (!r.id) {
          batch.push(db.prepare('INSERT INTO reminders (title, remind_at, status, patient_id) VALUES (?, ?, ?, ?)')
            .bind(r.title, r.remind_at, r.status || 'pending', pid));
          changeLog.push(`Added reminder: ${r.title}`);
        }
      }
    }

    // 11. Process Prescriptions
    if (Array.isArray(data.prescriptions)) {
      for (const pr of data.prescriptions) {
        if (pr.id && pr._action === 'update') {
          batch.push(db.prepare('UPDATE prescriptions SET medication_id = ?, diagnosis_id = ?, specialist_id = ?, timeline_id = ?, dosage = ?, frequency = ?, start_date = ?, end_date = ?, course_status = ?, stop_reason = ?, duration_text = ?, rationale = ? WHERE id = ? AND patient_id = ?')
            .bind(pr.medication_id, pr.diagnosis_id || null, pr.specialist_id || null, pr.timeline_id || null, pr.dosage || null, pr.frequency || null, pr.start_date || null, pr.end_date || null, pr.course_status || 'active', pr.stop_reason || null, pr.duration_text || null, pr.rationale || null, pr.id, pid));
          changeLog.push(`Updated prescription #${pr.id}`);
        } else if (pr.id && pr._action === 'delete') {
          batch.push(db.prepare('DELETE FROM prescriptions WHERE id = ? AND patient_id = ?').bind(pr.id, pid));
          changeLog.push(`Deleted prescription #${pr.id}`);
        } else if (!pr.id) {
          batch.push(db.prepare('INSERT INTO prescriptions (medication_id, diagnosis_id, specialist_id, timeline_id, dosage, frequency, start_date, end_date, course_status, stop_reason, duration_text, rationale, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(pr.medication_id, pr.diagnosis_id || null, pr.specialist_id || null, pr.timeline_id || null, pr.dosage || null, pr.frequency || null, pr.start_date || null, pr.end_date || null, pr.course_status || 'active', pr.stop_reason || null, pr.duration_text || null, pr.rationale || null, pid));
          changeLog.push(`Added prescription for medication #${pr.medication_id}`);
        }
      }
    }

    // 12. Process Visit Diagnoses
    if (Array.isArray(data.visit_diagnoses)) {
      for (const vd of data.visit_diagnoses) {
        if (vd._action === 'delete') {
          batch.push(db.prepare('DELETE FROM visit_diagnoses WHERE visit_id = ? AND diagnosis_id = ? AND patient_id = ?').bind(vd.visit_id, vd.diagnosis_id, pid));
          changeLog.push(`Removed diagnosis #${vd.diagnosis_id} from visit #${vd.visit_id}`);
        } else {
          // Use INSERT OR REPLACE for many-to-many
          batch.push(db.prepare('INSERT OR REPLACE INTO visit_diagnoses (visit_id, diagnosis_id, relation, patient_id) VALUES (?, ?, ?, ?)')
            .bind(vd.visit_id, vd.diagnosis_id, vd.relation || 'discussed', pid));
          changeLog.push(`Linked diagnosis #${vd.diagnosis_id} to visit #${vd.visit_id}`);
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
