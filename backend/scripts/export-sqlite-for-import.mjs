#!/usr/bin/env node
/**
 * Export a legacy/local SQLite DB into JSON suitable for POST /api/admin/import
 * (or restore path after unwrap).
 *
 * Usage:
 *   node scripts/export-sqlite-for-import.mjs ./path/to/old.db > export.json
 *   node scripts/export-sqlite-for-import.mjs ./old.db --patient 1 > p1.json
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

if (!dbPath) {
  console.error('Usage: node export-sqlite-for-import.mjs <database.sqlite> [--patient N]');
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

if (patientFilter) {
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
  data.app_settings = all('SELECT * FROM app_settings');
} catch {
  data.app_settings = [];
}

const payload = {
  version: '2.2.0-export',
  exported_at: new Date().toISOString(),
  source: resolve(dbPath),
  patient_id: patientFilter || null,
  wipe: false,
  data,
  notes: {
    import: 'POST /api/admin/import with X-Admin-Token. Set wipe:true only for full replace of one patient scope.',
    files: 'Upload local uploads/ to B2 using file_path values before expecting document downloads to work.',
  },
};

process.stdout.write(JSON.stringify(payload, null, 2));
