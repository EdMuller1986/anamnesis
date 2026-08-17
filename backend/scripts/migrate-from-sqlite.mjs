#!/usr/bin/env node
/**
 * Orchestrated partial migration from legacy SQLite → D1 + B2.
 *
 * Steps:
 *  1) export-sqlite-for-import.mjs → import.json
 *  2) optional upload-uploads-to-b2.mjs
 *  3) POST /api/admin/import
 *
 * Env:
 *   WORKER_URL   e.g. https://xxx.workers.dev
 *   ADMIN_TOKEN
 *   B2_*         only if uploading files
 *
 * Usage:
 *   node scripts/migrate-from-sqlite.mjs ./old.db --patient 1 --uploads ./uploads --basename-only
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
const patient = opt('--patient', '1');
const uploads = opt('--uploads');
const skipUpload = flag('--skip-upload');
const dryRun = flag('--dry-run');
const basenameOnly = flag('--basename-only');
const wipe = flag('--wipe');

if (!dbPath) {
  console.error(`Usage:
  node migrate-from-sqlite.mjs <old.db> --patient 1 [--uploads ./uploads] [--basename-only] [--wipe] [--dry-run] [--skip-upload]

Env: WORKER_URL, ADMIN_TOKEN, and B2_* if uploading.`);
  process.exit(1);
}

const worker = (process.env.WORKER_URL || '').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;
if (!worker || !token) {
  console.error('WORKER_URL and ADMIN_TOKEN are required');
  process.exit(1);
}

const outJson = resolve(process.cwd(), `migrate-patient-${patient}.json`);
const exportScript = join(__dirname, 'export-sqlite-for-import.mjs');
const uploadScript = join(__dirname, 'upload-uploads-to-b2.mjs');

console.log('== 1) Export SQLite → JSON');
const exp = spawnSync(
  process.execPath,
  [exportScript, resolve(dbPath), '--patient', String(patient)],
  { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 }
);
if (exp.status !== 0) {
  console.error(exp.stderr || exp.stdout);
  process.exit(exp.status || 1);
}
writeFileSync(outJson, exp.stdout);
console.log(`Wrote ${outJson} (${exp.stdout.length} bytes)`);

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
const payload = JSON.parse(readFileSync(outJson, 'utf8'));
if (wipe) payload.wipe = true;

if (dryRun) {
  console.log('[dry-run] would POST import to', `${worker}/api/admin/import`);
  console.log('[dry-run] tables:', Object.keys(payload.data || payload).filter((k) => Array.isArray((payload.data || payload)[k])));
  process.exit(0);
}

const res = await fetch(`${worker}/api/admin/import`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Token': token,
    'X-Patient-Id': String(patient),
  },
  body: JSON.stringify(payload),
});
const text = await res.text();
console.log('HTTP', res.status, text.slice(0, 2000));
if (!res.ok) process.exit(1);
console.log('Done.');
