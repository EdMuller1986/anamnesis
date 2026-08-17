import { Hono } from 'hono';
import * as telegram from '../services/telegram';
import { unwrapBackupState } from '../services/backup';

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

/** True when row should be inserted (AI create or full wipe restore with ids). */
function wantsInsert(row, wipe) {
  if (!row) return false;
  if (row._action === 'delete' || row._action === 'update') return false;
  if (row._action === 'insert' || row._action === 'restore') return true;
  if (!row.id) return true;
  return !!wipe;
}

function wantsUpdate(row, wipe) {
  return !!(row?.id && row._action === 'update' && !wipe);
}

function wantsDelete(row, wipe) {
  return !!(row?.id && row._action === 'delete' && !wipe);
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

const PER_PATIENT_IMPORT_TABLES = [
  'timeline', 'diagnoses', 'medications', 'specialists', 'lab_results',
  'vaccinations', 'growth_log', 'plan', 'medical_errors', 'reminders',
  'prescriptions', 'documents', 'comments', 'ai_requests', 'visit_diagnoses',
];

/**
 * Family-mode backup may contain multiple patients. Partition rows by patient_id
 * so wipe restore does not collapse everyone onto the active session chart.
 */
function partitionImportByPatient(data, fallbackPid) {
  const fb = Number(fallbackPid) || 1;
  const buckets = new Map();

  const ensure = (id) => {
    const n = Number(id);
    if (!buckets.has(n)) {
      buckets.set(n, {
        wipe: true,
        patient: [],
        // globals restored once with first bucket
        known_devices: null,
        webauthn_credentials: null,
        app_settings: null,
        scope: data.scope,
        _backup_meta: data._backup_meta,
      });
      for (const t of PER_PATIENT_IMPORT_TABLES) buckets.get(n)[t] = [];
    }
    return buckets.get(n);
  };

  // Seed from patient rows
  const patientRows = Array.isArray(data.patient)
    ? data.patient
    : (data.patient && typeof data.patient === 'object' ? [data.patient] : []);
  for (const p of patientRows) {
    const id = p.id != null ? Number(p.id) : fb;
    ensure(id).patient.push(p);
  }

  for (const t of PER_PATIENT_IMPORT_TABLES) {
    if (!Array.isArray(data[t])) continue;
    for (const row of data[t]) {
      const id = row?.patient_id != null ? Number(row.patient_id) : fb;
      ensure(id)[t].push(row);
    }
  }

  if (buckets.size === 0) ensure(fb);

  // Attach global tables to the first bucket only (restored once)
  const first = buckets.values().next().value;
  first.known_devices = data.known_devices;
  first.webauthn_credentials = data.webauthn_credentials;
  first.app_settings = data.app_settings;

  return buckets;
}

/**
 * Shared import/restore application (used by POST /import and restore-from-backup).
 * Multi-patient wipe restores preserve each row's patient_id (family mode).
 * @returns {{ ok: true, version, changes, patients? } | throws }
 */
export async function applyImport(db, rawBody, pid) {
  const data = unwrapBackupState(rawBody) || {};
  const wipe = data.wipe === true;

  // Guard: wipe without any medical arrays would destroy data for nothing
  if (wipe) {
    const hasAny = PER_PATIENT_IMPORT_TABLES.some(
      (k) => Array.isArray(data[k]) && data[k].length > 0
    );
    if (!hasAny) {
      const err = new Error('Refusing wipe: import payload has no table arrays (check backup unwrap)');
      err.status = 400;
      throw err;
    }
  }

  // Full backup / multi-chart: restore each patient separately with correct patient_id
  if (wipe) {
    const buckets = partitionImportByPatient(data, pid);
    if (buckets.size > 1
      || data.scope === 'all_patients'
      || data._backup_meta?.scope === 'all_patients') {
      const allChanges = [];
      let lastVer = null;
      const patients = [];
      for (const [pId, subset] of buckets) {
        const r = await applyImportSingle(db, subset, pId);
        allChanges.push(...r.changes.map((c) => `[patient ${pId}] ${c}`));
        lastVer = r.version;
        patients.push(pId);
      }
      return {
        ok: true,
        version: lastVer,
        changes: allChanges,
        patients,
        multi_patient: true,
      };
    }
  }

  return applyImportSingle(db, data, pid);
}

async function applyImportSingle(db, data, pid) {
  const wipe = data.wipe === true;
  const changeLog = [];
  const batch = [];

  if (wipe) {
    // visit_diagnoses first (FK-ish), then dependents
    const tablesToWipe = [
      'visit_diagnoses', 'prescriptions', 'comments', 'documents',
      'timeline', 'diagnoses', 'medications',
      'specialists', 'lab_results', 'vaccinations', 'growth_log',
      'plan', 'medical_errors', 'reminders',
      'ai_requests',
    ];
    for (const t of tablesToWipe) {
      batch.push(db.prepare(`DELETE FROM ${t} WHERE patient_id = ?`).bind(pid));
    }
    changeLog.push(`Wiped existing patient-scoped data for patient_id=${pid}`);
  }

  // 0. Patient profile (upsert active chart)
  const patientRows = Array.isArray(data.patient)
    ? data.patient
    : (data.patient && typeof data.patient === 'object' ? [data.patient] : []);
  for (const p of patientRows) {
    const id = p.id || pid;
    if (Number(id) !== Number(pid) && !wipe) continue;
    const fullName = p.full_name || p.name;
    const dob = p.date_of_birth || p.birth_date;
    if (!fullName) continue;
    batch.push(db.prepare(`
      INSERT INTO patient (id, name, full_name, birth_date, date_of_birth, gender, city, allergies,
        current_height_cm, current_weight_kg, birth_weight_g, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        full_name = excluded.full_name,
        birth_date = excluded.birth_date,
        date_of_birth = excluded.date_of_birth,
        gender = excluded.gender,
        city = excluded.city,
        allergies = excluded.allergies,
        current_height_cm = excluded.current_height_cm,
        current_weight_kg = excluded.current_weight_kg,
        birth_weight_g = excluded.birth_weight_g,
        notes = excluded.notes,
        updated_at = datetime('now')
    `).bind(
      id,
      fullName, fullName,
      dob || null, dob || null,
      p.gender || null, p.city || null, p.allergies || null,
      p.current_height_cm ?? null, p.current_weight_kg ?? null, p.birth_weight_g ?? null,
      p.notes || null
    ));
    changeLog.push(`Upserted patient #${id}: ${fullName}`);
  }

  // 1. Timeline
  if (Array.isArray(data.timeline)) {
    for (const event of data.timeline) {
      if (wantsUpdate(event, wipe)) {
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
      } else if (wantsDelete(event, wipe)) {
        batch.push(db.prepare('DELETE FROM timeline WHERE id = ? AND patient_id = ?').bind(event.id, pid));
        changeLog.push(`Deleted event: ${event.title || event.id}`);
      } else if (wantsInsert(event, wipe)) {
        if (event.id && wipe) {
          batch.push(db.prepare(
            `INSERT INTO timeline (id, title, description, category, event_date, notes, patient_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(event.id, event.title, event.description || null, event.category || null, event.event_date, event.notes || null, pid));
        } else {
          batch.push(db.prepare(
            `INSERT INTO timeline (title, description, category, event_date, notes, patient_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(event.title, event.description || null, event.category || null, event.event_date, event.notes || null, pid));
        }
        changeLog.push(`Added event: ${event.title}`);
      }
    }
  }

  // 2. Diagnoses
  if (Array.isArray(data.diagnoses)) {
    for (const diag of data.diagnoses) {
      if (wantsUpdate(diag, wipe)) {
        batch.push(db.prepare('UPDATE diagnoses SET name = ?, icd_code = ?, status = ?, detail = ? WHERE id = ? AND patient_id = ?')
          .bind(diag.name, diag.icd_code || null, diag.status || 'active', diag.detail || null, diag.id, pid));
        changeLog.push(`Updated diagnosis: ${diag.name}`);
      } else if (wantsDelete(diag, wipe)) {
        batch.push(db.prepare('DELETE FROM diagnoses WHERE id = ? AND patient_id = ?').bind(diag.id, pid));
        changeLog.push(`Deleted diagnosis: ${diag.name}`);
      } else if (wantsInsert(diag, wipe)) {
        if (diag.id && wipe) {
          batch.push(db.prepare('INSERT INTO diagnoses (id, name, icd_code, status, detail, patient_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(diag.id, diag.name, diag.icd_code || null, diag.status || 'active', diag.detail || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO diagnoses (name, icd_code, status, detail, patient_id) VALUES (?, ?, ?, ?, ?)')
            .bind(diag.name, diag.icd_code || null, diag.status || 'active', diag.detail || null, pid));
        }
        changeLog.push(`Added diagnosis: ${diag.name}`);
      }
    }
  }

  // 3. Medications
  if (Array.isArray(data.medications)) {
    for (const med of data.medications) {
      if (wantsUpdate(med, wipe)) {
        batch.push(db.prepare('UPDATE medications SET name = ?, dosage = ?, frequency = ?, status = ?, detail = ? WHERE id = ? AND patient_id = ?')
          .bind(med.name, med.dosage || null, med.frequency || null, med.status || 'active', med.detail || null, med.id, pid));
        changeLog.push(`Updated medication: ${med.name}`);
      } else if (wantsDelete(med, wipe)) {
        batch.push(db.prepare('DELETE FROM medications WHERE id = ? AND patient_id = ?').bind(med.id, pid));
        changeLog.push(`Deleted medication: ${med.name}`);
      } else if (wantsInsert(med, wipe)) {
        if (med.id && wipe) {
          batch.push(db.prepare('INSERT INTO medications (id, name, dosage, frequency, status, detail, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(med.id, med.name, med.dosage || null, med.frequency || null, med.status || 'active', med.detail || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO medications (name, dosage, frequency, status, detail, patient_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(med.name, med.dosage || null, med.frequency || null, med.status || 'active', med.detail || null, pid));
        }
        changeLog.push(`Added medication: ${med.name}`);
      }
    }
  }

  // 4. Specialists
  if (Array.isArray(data.specialists)) {
    for (const spec of data.specialists) {
      if (wantsUpdate(spec, wipe)) {
        batch.push(db.prepare('UPDATE specialists SET full_name = ?, specialization = ?, clinic = ?, notes = ? WHERE id = ? AND patient_id = ?')
          .bind(spec.full_name, spec.specialization || null, spec.clinic || null, spec.notes || null, spec.id, pid));
        changeLog.push(`Updated specialist: ${spec.full_name}`);
      } else if (wantsDelete(spec, wipe)) {
        batch.push(db.prepare('DELETE FROM specialists WHERE id = ? AND patient_id = ?').bind(spec.id, pid));
        changeLog.push(`Deleted specialist: ${spec.full_name}`);
      } else if (wantsInsert(spec, wipe)) {
        if (spec.id && wipe) {
          batch.push(db.prepare('INSERT INTO specialists (id, full_name, specialization, clinic, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(spec.id, spec.full_name, spec.specialization || null, spec.clinic || null, spec.notes || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO specialists (full_name, specialization, clinic, notes, patient_id) VALUES (?, ?, ?, ?, ?)')
            .bind(spec.full_name, spec.specialization || null, spec.clinic || null, spec.notes || null, pid));
        }
        changeLog.push(`Added specialist: ${spec.full_name}`);
      }
    }
  }

  // 5. Lab Results
  if (Array.isArray(data.lab_results)) {
    for (const lab of data.lab_results) {
      if (wantsUpdate(lab, wipe)) {
        batch.push(db.prepare('UPDATE lab_results SET test_date = ?, test_name = ?, parameter = ?, value = ?, unit = ?, ref_min = ?, ref_max = ?, status = ?, notes = ? WHERE id = ? AND patient_id = ?')
          .bind(lab.test_date, lab.test_name, lab.parameter, lab.value, lab.unit, lab.ref_min, lab.ref_max, lab.status || 'normal', lab.notes || null, lab.id, pid));
        changeLog.push(`Updated lab result: ${lab.test_name} - ${lab.parameter}`);
      } else if (wantsDelete(lab, wipe)) {
        batch.push(db.prepare('DELETE FROM lab_results WHERE id = ? AND patient_id = ?').bind(lab.id, pid));
        changeLog.push(`Deleted lab result: ${lab.id}`);
      } else if (wantsInsert(lab, wipe)) {
        if (lab.id && wipe) {
          batch.push(db.prepare('INSERT INTO lab_results (id, test_date, test_name, parameter, value, unit, ref_min, ref_max, status, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(lab.id, lab.test_date, lab.test_name, lab.parameter, lab.value, lab.unit, lab.ref_min, lab.ref_max, lab.status || 'normal', lab.notes || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO lab_results (test_date, test_name, parameter, value, unit, ref_min, ref_max, status, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(lab.test_date, lab.test_name, lab.parameter, lab.value, lab.unit, lab.ref_min, lab.ref_max, lab.status || 'normal', lab.notes || null, pid));
        }
        changeLog.push(`Added lab result: ${lab.test_name} - ${lab.parameter}`);
      }
    }
  }

  // 6. Vaccinations
  if (Array.isArray(data.vaccinations)) {
    for (const vac of data.vaccinations) {
      if (wantsUpdate(vac, wipe)) {
        batch.push(db.prepare('UPDATE vaccinations SET name = ?, vaccine_name = ?, dose_number = ?, scheduled_date = ?, actual_date = ?, status = ?, reaction = ?, notes = ? WHERE id = ? AND patient_id = ?')
          .bind(vac.name, vac.vaccine_name || null, vac.dose_number || 1, vac.scheduled_date || null, vac.actual_date || null, vac.status || 'scheduled', vac.reaction || null, vac.notes || null, vac.id, pid));
        changeLog.push(`Updated vaccination: ${vac.name}`);
      } else if (wantsDelete(vac, wipe)) {
        batch.push(db.prepare('DELETE FROM vaccinations WHERE id = ? AND patient_id = ?').bind(vac.id, pid));
        changeLog.push(`Deleted vaccination: ${vac.name}`);
      } else if (wantsInsert(vac, wipe)) {
        if (vac.id && wipe) {
          batch.push(db.prepare('INSERT INTO vaccinations (id, name, vaccine_name, dose_number, scheduled_date, actual_date, status, reaction, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(vac.id, vac.name, vac.vaccine_name || null, vac.dose_number || 1, vac.scheduled_date || null, vac.actual_date || null, vac.status || 'scheduled', vac.reaction || null, vac.notes || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO vaccinations (name, vaccine_name, dose_number, scheduled_date, actual_date, status, reaction, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(vac.name, vac.vaccine_name || null, vac.dose_number || 1, vac.scheduled_date || null, vac.actual_date || null, vac.status || 'scheduled', vac.reaction || null, vac.notes || null, pid));
        }
        changeLog.push(`Added vaccination: ${vac.name}`);
      }
    }
  }

  // 7. Growth
  if (Array.isArray(data.growth_log)) {
    for (const g of data.growth_log) {
      if (wantsUpdate(g, wipe)) {
        batch.push(db.prepare('UPDATE growth_log SET measured_at = ?, height_cm = ?, weight_kg = ?, head_circumference_cm = ?, notes = ? WHERE id = ? AND patient_id = ?')
          .bind(g.measured_at, g.height_cm, g.weight_kg, g.head_circumference_cm || null, g.notes || null, g.id, pid));
        changeLog.push(`Updated growth record: ${g.measured_at}`);
      } else if (wantsDelete(g, wipe)) {
        batch.push(db.prepare('DELETE FROM growth_log WHERE id = ? AND patient_id = ?').bind(g.id, pid));
        changeLog.push(`Deleted growth record: ${g.id}`);
      } else if (wantsInsert(g, wipe)) {
        if (g.id && wipe) {
          batch.push(db.prepare('INSERT INTO growth_log (id, measured_at, height_cm, weight_kg, head_circumference_cm, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(g.id, g.measured_at, g.height_cm, g.weight_kg, g.head_circumference_cm || null, g.notes || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO growth_log (measured_at, height_cm, weight_kg, head_circumference_cm, notes, patient_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(g.measured_at, g.height_cm, g.weight_kg, g.head_circumference_cm || null, g.notes || null, pid));
        }
        changeLog.push(`Added growth record: ${g.measured_at}`);
      }
    }
  }

  // 8. Plan
  if (Array.isArray(data.plan)) {
    for (const p of data.plan) {
      if (wantsUpdate(p, wipe)) {
        batch.push(db.prepare('UPDATE plan SET title = ?, detail = ?, advice = ?, status = ?, priority = ?, due_date = ?, outcome = ? WHERE id = ? AND patient_id = ?')
          .bind(p.title, p.detail || null, p.advice || null, p.status || 'pending', p.priority || 'medium', p.due_date || null, p.outcome || null, p.id, pid));
        changeLog.push(`Updated plan task: ${p.title}`);
      } else if (wantsDelete(p, wipe)) {
        batch.push(db.prepare('DELETE FROM plan WHERE id = ? AND patient_id = ?').bind(p.id, pid));
        changeLog.push(`Deleted plan task: ${p.title}`);
      } else if (wantsInsert(p, wipe)) {
        if (p.id && wipe) {
          batch.push(db.prepare('INSERT INTO plan (id, title, detail, advice, status, priority, due_date, outcome, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(p.id, p.title, p.detail || null, p.advice || null, p.status || 'pending', p.priority || 'medium', p.due_date || null, p.outcome || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO plan (title, detail, advice, status, priority, due_date, outcome, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(p.title, p.detail || null, p.advice || null, p.status || 'pending', p.priority || 'medium', p.due_date || null, p.outcome || null, pid));
        }
        changeLog.push(`Added plan task: ${p.title}`);
      }
    }
  }

  // 9. Medical errors
  if (Array.isArray(data.medical_errors)) {
    for (const e of data.medical_errors) {
      if (wantsUpdate(e, wipe)) {
        batch.push(db.prepare('UPDATE medical_errors SET title = ?, detail = ?, advice = ?, severity = ?, status = ?, resolution = ? WHERE id = ? AND patient_id = ?')
          .bind(e.title, e.detail || null, e.advice || null, e.severity || 'medium', e.status || 'open', e.resolution || null, e.id, pid));
        changeLog.push(`Updated anomaly/error: ${e.title}`);
      } else if (wantsDelete(e, wipe)) {
        batch.push(db.prepare('DELETE FROM medical_errors WHERE id = ? AND patient_id = ?').bind(e.id, pid));
        changeLog.push(`Deleted anomaly/error: ${e.title}`);
      } else if (wantsInsert(e, wipe)) {
        if (e.id && wipe) {
          batch.push(db.prepare('INSERT INTO medical_errors (id, title, detail, advice, severity, status, resolution, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(e.id, e.title, e.detail || null, e.advice || null, e.severity || 'medium', e.status || 'open', e.resolution || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO medical_errors (title, detail, advice, severity, status, resolution, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(e.title, e.detail || null, e.advice || null, e.severity || 'medium', e.status || 'open', e.resolution || null, pid));
        }
        changeLog.push(`Added anomaly/error: ${e.title}`);
      }
    }
  }

  // 10. Reminders
  if (Array.isArray(data.reminders)) {
    for (const r of data.reminders) {
      if (wantsUpdate(r, wipe)) {
        batch.push(db.prepare('UPDATE reminders SET title = ?, remind_at = ?, status = ? WHERE id = ? AND patient_id = ?')
          .bind(r.title, r.remind_at, r.status || 'pending', r.id, pid));
        changeLog.push(`Updated reminder: ${r.title}`);
      } else if (wantsDelete(r, wipe)) {
        batch.push(db.prepare('DELETE FROM reminders WHERE id = ? AND patient_id = ?').bind(r.id, pid));
        changeLog.push(`Deleted reminder: ${r.title}`);
      } else if (wantsInsert(r, wipe)) {
        if (r.id && wipe) {
          batch.push(db.prepare('INSERT INTO reminders (id, title, remind_at, status, patient_id) VALUES (?, ?, ?, ?, ?)')
            .bind(r.id, r.title, r.remind_at, r.status || 'pending', pid));
        } else {
          batch.push(db.prepare('INSERT INTO reminders (title, remind_at, status, patient_id) VALUES (?, ?, ?, ?)')
            .bind(r.title, r.remind_at, r.status || 'pending', pid));
        }
        changeLog.push(`Added reminder: ${r.title}`);
      }
    }
  }

  // 11. Prescriptions
  if (Array.isArray(data.prescriptions)) {
    for (const pr of data.prescriptions) {
      if (wantsUpdate(pr, wipe)) {
        batch.push(db.prepare('UPDATE prescriptions SET medication_id = ?, diagnosis_id = ?, specialist_id = ?, timeline_id = ?, dosage = ?, frequency = ?, start_date = ?, end_date = ?, course_status = ?, stop_reason = ?, duration_text = ?, rationale = ? WHERE id = ? AND patient_id = ?')
          .bind(pr.medication_id, pr.diagnosis_id || null, pr.specialist_id || null, pr.timeline_id || null, pr.dosage || null, pr.frequency || null, pr.start_date || null, pr.end_date || null, pr.course_status || 'active', pr.stop_reason || null, pr.duration_text || null, pr.rationale || null, pr.id, pid));
        changeLog.push(`Updated prescription #${pr.id}`);
      } else if (wantsDelete(pr, wipe)) {
        batch.push(db.prepare('DELETE FROM prescriptions WHERE id = ? AND patient_id = ?').bind(pr.id, pid));
        changeLog.push(`Deleted prescription #${pr.id}`);
      } else if (wantsInsert(pr, wipe)) {
        if (pr.id && wipe) {
          batch.push(db.prepare('INSERT INTO prescriptions (id, medication_id, diagnosis_id, specialist_id, timeline_id, dosage, frequency, start_date, end_date, course_status, stop_reason, duration_text, rationale, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(pr.id, pr.medication_id, pr.diagnosis_id || null, pr.specialist_id || null, pr.timeline_id || null, pr.dosage || null, pr.frequency || null, pr.start_date || null, pr.end_date || null, pr.course_status || 'active', pr.stop_reason || null, pr.duration_text || null, pr.rationale || null, pid));
        } else {
          batch.push(db.prepare('INSERT INTO prescriptions (medication_id, diagnosis_id, specialist_id, timeline_id, dosage, frequency, start_date, end_date, course_status, stop_reason, duration_text, rationale, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(pr.medication_id, pr.diagnosis_id || null, pr.specialist_id || null, pr.timeline_id || null, pr.dosage || null, pr.frequency || null, pr.start_date || null, pr.end_date || null, pr.course_status || 'active', pr.stop_reason || null, pr.duration_text || null, pr.rationale || null, pid));
        }
        changeLog.push(`Added prescription for medication #${pr.medication_id}`);
      }
    }
  }

  // 12. Visit diagnoses
  if (Array.isArray(data.visit_diagnoses)) {
    for (const vd of data.visit_diagnoses) {
      if (vd._action === 'delete' && !wipe) {
        batch.push(db.prepare('DELETE FROM visit_diagnoses WHERE visit_id = ? AND diagnosis_id = ? AND patient_id = ?').bind(vd.visit_id, vd.diagnosis_id, pid));
        changeLog.push(`Removed diagnosis #${vd.diagnosis_id} from visit #${vd.visit_id}`);
      } else {
        batch.push(db.prepare('INSERT OR REPLACE INTO visit_diagnoses (visit_id, diagnosis_id, relation, patient_id) VALUES (?, ?, ?, ?)')
          .bind(vd.visit_id, vd.diagnosis_id, vd.relation || 'discussed', pid));
        changeLog.push(`Linked diagnosis #${vd.diagnosis_id} to visit #${vd.visit_id}`);
      }
    }
  }

  // 13. Documents (metadata only — B2 blobs not in JSON backup yet)
  if (Array.isArray(data.documents)) {
    for (const doc of data.documents) {
      if (wantsDelete(doc, wipe)) {
        batch.push(db.prepare('DELETE FROM documents WHERE id = ? AND patient_id = ?').bind(doc.id, pid));
        changeLog.push(`Deleted document: ${doc.title || doc.id}`);
      } else if (wantsInsert(doc, wipe)) {
        if (doc.id && wipe) {
          batch.push(db.prepare(
            `INSERT INTO documents (id, title, category, file_path, mime_type, notes, timeline_id, patient_id, original_name, file_size, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            doc.id, doc.title, doc.category || 'report', doc.file_path, doc.mime_type || null,
            doc.notes || null, doc.timeline_id || null, pid,
            doc.original_name || null, doc.file_size ?? null, doc.description || null
          ));
        } else if (!doc.id) {
          batch.push(db.prepare(
            `INSERT INTO documents (title, category, file_path, mime_type, notes, timeline_id, patient_id, original_name, file_size, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            doc.title, doc.category || 'report', doc.file_path, doc.mime_type || null,
            doc.notes || null, doc.timeline_id || null, pid,
            doc.original_name || null, doc.file_size ?? null, doc.description || null
          ));
        }
        changeLog.push(`Added document meta: ${doc.title}`);
      }
    }
  }

  // 14. Comments
  if (Array.isArray(data.comments)) {
    for (const cm of data.comments) {
      if (wantsDelete(cm, wipe)) {
        batch.push(db.prepare('DELETE FROM comments WHERE id = ? AND patient_id = ?').bind(cm.id, pid));
      } else if (wantsInsert(cm, wipe)) {
        if (cm.id && wipe) {
          batch.push(db.prepare(
            `INSERT INTO comments (id, entity_type, entity_id, text, author, patient_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(cm.id, cm.entity_type, cm.entity_id, cm.text, cm.author || 'user', pid));
        } else if (!cm.id) {
          batch.push(db.prepare(
            `INSERT INTO comments (entity_type, entity_id, text, author, patient_id)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(cm.entity_type, cm.entity_id, cm.text, cm.author || 'user', pid));
        }
        changeLog.push(`Added comment on ${cm.entity_type}#${cm.entity_id}`);
      }
    }
  }

  // 15. AI requests
  if (Array.isArray(data.ai_requests)) {
    for (const ar of data.ai_requests) {
      if (wantsDelete(ar, wipe)) {
        batch.push(db.prepare('DELETE FROM ai_requests WHERE id = ? AND patient_id = ?').bind(ar.id, pid));
      } else if (wantsInsert(ar, wipe)) {
        if (ar.id && wipe) {
          batch.push(db.prepare(
            `INSERT INTO ai_requests (id, entity_type, entity_id, status, patient_id, completed_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(ar.id, ar.entity_type, ar.entity_id, ar.status || 'pending', pid, ar.completed_at || null));
        } else if (!ar.id) {
          batch.push(db.prepare(
            `INSERT INTO ai_requests (entity_type, entity_id, status, patient_id)
             VALUES (?, ?, ?, ?)`
          ).bind(ar.entity_type, ar.entity_id, ar.status || 'pending', pid));
        }
        changeLog.push(`Added ai_request ${ar.entity_type}#${ar.entity_id}`);
      }
    }
  }

  // 16. Known devices (global family trust list — restore only on wipe)
  if (wipe && Array.isArray(data.known_devices)) {
    for (const d of data.known_devices) {
      if (!d.device_id) continue;
      const devicePatient = d.patient_id ?? pid;
      batch.push(db.prepare(`
        INSERT INTO known_devices (device_id, patient_id, label, first_seen_at, last_seen_at, last_ip, user_agent, revoked)
        VALUES (?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?, ?, ?)
        ON CONFLICT(device_id, patient_id) DO UPDATE SET
          label = COALESCE(excluded.label, known_devices.label),
          last_seen_at = excluded.last_seen_at,
          last_ip = excluded.last_ip,
          user_agent = excluded.user_agent,
          revoked = excluded.revoked
      `).bind(
        d.device_id,
        devicePatient,
        d.label || null,
        d.first_seen_at || null,
        d.last_seen_at || null,
        d.last_ip || null,
        d.user_agent || null,
        d.revoked ? 1 : 0
      ));
    }
    changeLog.push(`Restored ${data.known_devices.length} known_devices`);
  }

  // 17. WebAuthn credentials (public keys only; private keys stay on authenticators)
  if (wipe && Array.isArray(data.webauthn_credentials)) {
    for (const w of data.webauthn_credentials) {
      if (!w.credential_id || !w.public_key) continue;
      const wp = w.patient_id ?? pid;
      batch.push(db.prepare(`
        INSERT INTO webauthn_credentials (
          patient_id, device_id, credential_id, public_key, counter, transports,
          backed_up, device_type, nickname, created_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
        ON CONFLICT(credential_id) DO UPDATE SET
          counter = excluded.counter,
          last_used_at = excluded.last_used_at,
          nickname = COALESCE(excluded.nickname, webauthn_credentials.nickname)
      `).bind(
        wp,
        w.device_id || 'unknown',
        w.credential_id,
        w.public_key,
        w.counter || 0,
        w.transports || null,
        w.backed_up ? 1 : 0,
        w.device_type || null,
        w.nickname || null,
        w.created_at || null,
        w.last_used_at || null
      ));
    }
    changeLog.push(`Restored ${data.webauthn_credentials.length} webauthn_credentials`);
  }

  // 18. app_settings (skip volatile keys)
  if (wipe && Array.isArray(data.app_settings)) {
    let n = 0;
    for (const s of data.app_settings) {
      if (!s.key || /^last_backup_|^last_ai_review_at_|^auth_challenge_/.test(s.key)) continue;
      batch.push(db.prepare(
        'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)'
      ).bind(s.key, s.value));
      n++;
    }
    if (n) changeLog.push(`Restored ${n} app_settings`);
  }

  if (batch.length > 0) {
    await db.batch(batch);
  }

  const currentVer = await getCurrentVersion(db, pid);
  const newVer = incrementVersion(currentVer);
  await saveVersion(db, newVer, changeLog, wipe ? 'Backup restore' : 'AI Import', pid);

  return { ok: true, version: newVer, changes: changeLog };
}

admin.post('/import', async (c) => {
  const pid = c.get('patientId') || 1;
  const db = c.env.DB;
  const data = await c.req.json();

  try {
    const result = await applyImport(db, data, pid);

    const summary = result.changes.length > 5
      ? `${result.changes.slice(0, 5).join('\n')}... (+${result.changes.length - 5})`
      : result.changes.join('\n');
    telegram.sendMessage(c.env,
      `<b>[AI IMPORT SUCCESS]</b>\n\n` +
      `Данные успешно импортированы ИИ-координатором.\n\n` +
      `• Версия: <b>${result.version}</b>\n` +
      `• Пациент ID: ${pid}\n` +
      `• Изменений: ${result.changes.length}\n\n` +
      `<code>${summary}</code>`
    ).catch(() => {});

    return c.json(result);
  } catch (err) {
    console.error('Import error:', err);
    const status = err.status || 500;
    return c.json({ error: 'Import failed: ' + err.message }, status);
  }
});

function incrementVersion(version) {
  const parts = version.split('.').map(Number);
  if (parts.length < 3) return '1.0.1';
  parts[2] += 1;
  return parts.join('.');
}

export default admin;
