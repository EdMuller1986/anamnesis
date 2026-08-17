#!/usr/bin/env node
/**
 * Orchestrated migration from legacy SQLite → D1 + B2.
 *
 * Steps:
 *  1) export-sqlite-for-import.mjs → JSON
 *  2) optional upload-uploads-to-b2.mjs
 *  3) POST /api/admin/import
 *  4) optional verify via GET counts /admin/tools/schema-info + import response
 *
 * Env:
 *   WORKER_URL   e.g. https://xxx.workers.dev
 *   ADMIN_TOKEN
 *   B2_*         only if uploading files
 *
 * Usage:
 *   node scripts/migrate-from-sqlite.mjs ./old.db --patient 1 --uploads ./uploads --basename-only
 *   node scripts/migrate-from-sqlite.mjs ./old.db --all-patients --uploads ./uploads --wipe
 *   node scripts/migrate-from-sqlite.mjs ./old.db --patient 1 --skip-upload --dry-run
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function flag(name) {
  return args.includes(name);
}
function opt(name, def = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

const dbPath = args.find((a) => !a.startsWith('--'));
const patient = opt('--patient', null);
const allPatients = flag('--all-patients');
const uploads = opt('--uploads');
const skipUpload = flag('--skip-upload');
const dryRun = flag('--dry-run');
const basenameOnly = flag('--basename-only');
const wipe = flag('--wipe');
const skipVerify = flag('--skip-verify');

if (!dbPath) {
  console.error(`Usage:
  node migrate-from-sqlite.mjs <old.db> [--patient N | --all-patients]
    [--uploads ./uploads] [--basename-only] [--wipe] [--dry-run] [--skip-upload] [--skip-verify]

Env: WORKER_URL, ADMIN_TOKEN, and B2_* if uploading.`);
  process.exit(1);
}

if (!patient && !allPatients) {
  console.error('Specify --patient N or --all-patients');
  process.exit(1);
}

const worker = (process.env.WORKER_URL || '').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;
if (!worker || !token) {
  console.error('WORKER_URL and ADMIN_TOKEN are required');
  process.exit(1);
}

const tag = allPatients ? 'all' : String(patient);
const outJson = resolve(process.cwd(), `migrate-patient-${tag}.json`);
const exportScript = join(__dirname, 'export-sqlite-for-import.mjs');
const uploadScript = join(__dirname, 'upload-uploads-to-b2.mjs');

console.log('== 1) Export SQLite → JSON');
const expArgs = [exportScript, resolve(dbPath)];
if (allPatients) expArgs.push('--all-patients');
else expArgs.push('--patient', String(patient));

const exp = spawnSync(process.execPath, expArgs, {
  encoding: 'utf8',
  maxBuffer: 100 * 1024 * 1024,
});
if (exp.status !== 0) {
  console.error(exp.stderr || exp.stdout);
  process.exit(exp.status || 1);
}
writeFileSync(outJson, exp.stdout);
const payload = JSON.parse(exp.stdout);
const counts = payload.counts || {};
console.log(`Wrote ${outJson} (${exp.stdout.length} bytes)`);
console.log('Export counts:', JSON.stringify(counts));
if (payload.data?.b2_file_manifest?.count) {
  console.log(`File keys to upload: ${payload.data.b2_file_manifest.count}`);
}

if (uploads && !skipUpload) {
  console.log('== 2) Upload files to B2');
  if (!existsSync(uploads)) {
    console.error('Uploads dir not found:', uploads);
    process.exit(1);
  }
  const upArgs = [uploadScript, resolve(uploads)];
  if (basenameOnly) upArgs.push('--basename-only');
  if (dryRun) upArgs.push('--dry-run');
  const up = spawnSync(process.execPath, upArgs, {
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  });
  if (up.status !== 0) process.exit(up.status || 1);
} else {
  console.log('== 2) Skip file upload');
}

console.log('== 3) Import to Worker');
if (wipe) payload.wipe = true;

const importPid = allPatients
  ? String(payload.data?.patient?.[0]?.id || patient || 1)
  : String(patient);

if (dryRun) {
  console.log('[dry-run] would POST import to', `${worker}/api/admin/import`);
  console.log('[dry-run] X-Patient-Id:', importPid);
  console.log('[dry-run] wipe:', !!payload.wipe);
  console.log('[dry-run] scope:', payload.scope);
  console.log(
    '[dry-run] tables:',
    Object.keys(payload.data || {}).filter((k) => Array.isArray((payload.data || {})[k]))
  );
  process.exit(0);
}

const res = await fetch(`${worker}/api/admin/import`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Token': token,
    'X-Patient-Id': importPid,
  },
  body: JSON.stringify(payload),
});
const text = await res.text();
console.log('HTTP', res.status, text.slice(0, 3000));
if (!res.ok) process.exit(1);

let importBody = null;
try {
  importBody = JSON.parse(text);
} catch { /* ignore */ }

if (!skipVerify) {
  console.log('== 4) Verify (schema-info + sample counts)');
  try {
    const schemaRes = await fetch(`${worker}/api/admin/tools/schema-info`, {
      headers: { 'X-Admin-Token': token, 'X-Patient-Id': importPid },
    });
    const schema = await schemaRes.json();
    console.log('schema ok:', schema.ok, 'tables:', schema.table_count,
      'audit_triggers:', schema.audit_trigger_count);
    if (schema.audit_ok === false) {
      console.warn('WARN: audit triggers incomplete — deploy migration 0011');
    }
  } catch (e) {
    console.warn('schema-info failed:', e.message);
  }

  // Lightweight SQL counts for key tables (read-only admin SQL)
  const checkTables = ['diagnoses', 'timeline', 'documents', 'medications'];
  for (const t of checkTables) {
    const expected = counts[t];
    if (expected == null) continue;
    try {
      const sqlRes = await fetch(`${worker}/api/admin/tools/sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
          'X-Patient-Id': importPid,
        },
        body: JSON.stringify({
          sql: allPatients
            ? `SELECT COUNT(*) AS c FROM ${t}`
            : `SELECT COUNT(*) AS c FROM ${t} WHERE patient_id = ?`,
          params: allPatients ? [] : [Number(patient)],
        }),
      });
      const body = await sqlRes.json();
      const got = body.rows?.[0]?.c ?? body.rows?.[0]?.['COUNT(*)'];
      const mark = Number(got) >= Number(expected) ? 'OK' : 'MISMATCH';
      console.log(`  ${t}: live=${got} export=${expected} [${mark}]`);
    } catch (e) {
      console.warn(`  ${t}: verify failed`, e.message);
    }
  }
}

console.log('Done.', importBody?.version ? `import version ${importBody.version}` : '');
if (importBody?.patients) {
  console.log('Restored patients:', importBody.patients);
}
