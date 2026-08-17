#!/usr/bin/env node
/**
 * Export a legacy/local SQLite DB into JSON suitable for POST /api/admin/import
 * (or restore path after unwrap).
 *
 * Usage:
 *   node scripts/export-sqlite-for-import.mjs ./path/to/old.db > export.json
 *   node scripts/export-sqlite-for-import.mjs ./old.db --patient 1 > p1.json
 *   node scripts/export-sqlite-for-import.mjs ./old.db --all-patients > all.json
 *
 * Does NOT upload files to B2 — only embeds file_path metadata.
 * For full migration: upload backend/uploads/* to B2 with the same keys, then import JSON.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith('--'));
const patientIdx = args.indexOf('--patient');
const patientFilter = patientIdx >= 0 ? parseInt(args[patientIdx + 1], 10) : null;
const allPatients = args.includes('--all-patients');

if (!dbPath) {
  console.error('Usage: node export-sqlite-for-import.mjs <database.sqlite> [--patient N | --all-patients]');
  process.exit(1);
}

const db = new DatabaseSync(resolve(dbPath), { readOnly: true });

// visit_diagnoses has no `id` column
const TABLES = [
  { name: 'diagnoses', orderBy: 'id' },
  { name: 'medications', orderBy: 'id' },
  { name: 'specialists', orderBy: 'id' },
  { name: 'medical_errors', orderBy: 'id' },
  { name: 'plan', orderBy: 'id' },
  { name: 'timeline', orderBy: 'id' },
  { name: 'documents', orderBy: 'id' },
  { name: 'reminders', orderBy: 'id' },
  { name: 'comments', orderBy: 'id' },
  { name: 'vaccinations', orderBy: 'id' },
  { name: 'growth_log', orderBy: 'id' },
  { name: 'lab_results', orderBy: 'id' },
  { name: 'prescriptions', orderBy: 'id' },
  { name: 'ai_requests', orderBy: 'id' },
  { name: 'visit_diagnoses', orderBy: 'visit_id, diagnosis_id' },
];

function all(sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

const data = {};
const multi = allPatients || patientFilter == null;

if (patientFilter != null && !allPatients) {
  data.patient = all('SELECT * FROM patient WHERE id = ?', [patientFilter]);
  for (const { name } of TABLES) {
    data[name] = all(`SELECT * FROM ${name} WHERE patient_id = ?`, [patientFilter]);
  }
} else {
  data.patient = all('SELECT * FROM patient ORDER BY id');
  for (const { name, orderBy } of TABLES) {
    data[name] = all(`SELECT * FROM ${name} ORDER BY ${orderBy}`);
  }
}

try {
  data.app_settings = all('SELECT * FROM app_settings ORDER BY key');
} catch {
  data.app_settings = [];
}

// Optional auth state (if tables exist in legacy DB)
try {
  data.known_devices = all('SELECT * FROM known_devices ORDER BY id');
} catch {
  data.known_devices = [];
}
try {
  data.webauthn_credentials = all(
    `SELECT id, patient_id, device_id, credential_id, public_key, counter, transports,
            backed_up, device_type, nickname, created_at, last_used_at
     FROM webauthn_credentials ORDER BY id`
  );
} catch {
  data.webauthn_credentials = [];
}

// File path checklist for B2 upload
const fileKeys = [];
const seen = new Set();
for (const doc of data.documents || []) {
  if (doc.file_path && !seen.has(doc.file_path)) {
    seen.add(doc.file_path);
    fileKeys.push({ key: doc.file_path, source: 'documents', id: doc.id });
  }
}
for (const vac of data.vaccinations || []) {
  try {
    const photos = JSON.parse(vac.photos || '[]');
    if (Array.isArray(photos)) {
      for (const p of photos) {
        if (p && !seen.has(p)) {
          seen.add(p);
          fileKeys.push({ key: p, source: 'vaccinations', id: vac.id });
        }
      }
    }
  } catch { /* skip */ }
}
data.b2_file_manifest = { count: fileKeys.length, files: fileKeys };

const counts = {};
for (const [k, v] of Object.entries(data)) {
  if (Array.isArray(v)) counts[k] = v.length;
  else if (k === 'b2_file_manifest') counts[k] = v.count;
}

const payload = {
  version: '2.4.0-export',
  exported_at: new Date().toISOString(),
  source: resolve(dbPath),
  scope: multi ? 'all_patients' : 'single_patient',
  patient_id: patientFilter || null,
  wipe: false,
  data,
  counts,
  notes: {
    import: 'POST /api/admin/import with X-Admin-Token. Set wipe:true only for full replace.',
    files: `Upload ${fileKeys.length} file key(s) to B2 (see data.b2_file_manifest) before downloads work.`,
    multi: multi
      ? 'All patients exported — wipe import partitions by patient_id (family mode).'
      : `Single patient ${patientFilter} exported.`,
  },
};

process.stdout.write(JSON.stringify(payload, null, 2));
