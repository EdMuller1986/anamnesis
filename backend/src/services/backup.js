import * as telegram from './telegram';
import * as b2 from './b2-storage';

// Table → ORDER BY clause (visit_diagnoses has no id — composite PK)
const PER_PATIENT_TABLES = [
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

const PER_PATIENT_TABLE_NAMES = PER_PATIENT_TABLES.map((t) => t.name);

/**
 * Canonical payload for hashing / restore (no volatile exported_at).
 */
const VOLATILE_SETTING_KEYS = /^(last_backup_|last_ai_review_at_|auth_challenge_)/;

function filterAppSettings(rows) {
  return (rows || [])
    .filter((r) => r?.key && !VOLATILE_SETTING_KEYS.test(r.key))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

export function stableBackupPayload(state) {
  // Drop volatile fields so unchanged medical data keeps the same hash
  if (!state || typeof state !== 'object') return state;
  const { exported_at, backup_errors, notes, ...rest } = state;
  if (rest.data && typeof rest.data === 'object') {
    // Strip base64 blobs; keep digests so file content still affects dedup hash
    const { b2_file_manifest, b2_file_blobs, b2_file_pack_meta, app_settings, ...dataRest } = rest.data;
    const manifest = b2_file_manifest
      ? {
          count: b2_file_manifest.count,
          files: [...(b2_file_manifest.files || [])].sort((a, b) =>
            String(a.key).localeCompare(String(b.key))
          ),
        }
      : undefined;
    const blobDigests = Array.isArray(b2_file_blobs)
      ? [...b2_file_blobs]
          .map((b) => ({
            key: b.key,
            sha256: b.sha256 || null,
            size: b.size ?? null,
          }))
          .sort((a, b) => String(a.key).localeCompare(String(b.key)))
      : undefined;
    return {
      ...rest,
      data: {
        ...dataRest,
        app_settings: filterAppSettings(app_settings),
        b2_file_manifest: manifest,
        b2_file_blob_digests: blobDigests,
      },
    };
  }
  return rest;
}

/** Default limits for embedding file bytes (Worker memory / Telegram size). */
export const DEFAULT_FILE_PACK_LIMITS = {
  maxFiles: 40,
  maxBytesPerFile: 5 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
};

export function bufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Download referenced B2 objects and embed as base64 (size-capped).
 * @returns {{ blobs: Array, meta: object }}
 */
export async function packFileBytes(env, manifest, limits = {}) {
  const opts = { ...DEFAULT_FILE_PACK_LIMITS, ...limits };
  const files = [...(manifest?.files || [])];
  const blobs = [];
  const skipped = [];
  let totalBytes = 0;

  for (const entry of files) {
    if (blobs.length >= opts.maxFiles) {
      skipped.push({ key: entry.key, reason: 'max_files' });
      continue;
    }
    if (!entry?.key) continue;
    try {
      const { buffer, contentType, size } = await b2.downloadFileBytes(env, entry.key);
      if (size > opts.maxBytesPerFile) {
        skipped.push({ key: entry.key, reason: 'too_large', size });
        continue;
      }
      if (totalBytes + size > opts.maxTotalBytes) {
        skipped.push({ key: entry.key, reason: 'total_budget', size });
        continue;
      }
      const sha256 = await sha256Hex(buffer);
      blobs.push({
        key: entry.key,
        source: entry.source || null,
        id: entry.id ?? null,
        content_type: contentType,
        size,
        sha256,
        base64: bufferToBase64(buffer),
      });
      totalBytes += size;
    } catch (e) {
      skipped.push({ key: entry.key, reason: 'download_failed', error: e.message });
    }
  }

  return {
    blobs,
    meta: {
      packed: blobs.length,
      skipped: skipped.length,
      skipped_details: skipped.slice(0, 50),
      total_bytes: totalBytes,
      limits: opts,
    },
  };
}

/**
 * Re-upload embedded base64 blobs from a backup into B2.
 */
export async function restoreEmbeddedFiles(env, rawState) {
  const data = unwrapBackupState(rawState) || {};
  // Blobs may sit on unwrapped data or still under .data if pass-through
  const blobs = Array.isArray(data.b2_file_blobs)
    ? data.b2_file_blobs
    : (Array.isArray(rawState?.data?.b2_file_blobs) ? rawState.data.b2_file_blobs : []);

  const result = {
    restored: 0,
    failed: [],
    total_bytes: 0,
    available: blobs.length,
  };

  for (const blob of blobs) {
    if (!blob?.key || !blob?.base64) {
      result.failed.push({ key: blob?.key || '?', error: 'missing key/base64' });
      continue;
    }
    try {
      const buffer = base64ToBuffer(blob.base64);
      if (blob.sha256) {
        const got = await sha256Hex(buffer);
        if (got !== blob.sha256) {
          result.failed.push({ key: blob.key, error: 'sha256 mismatch' });
          continue;
        }
      }
      await b2.uploadFile(
        env,
        blob.key,
        buffer,
        blob.content_type || 'application/octet-stream'
      );
      result.restored += 1;
      result.total_bytes += buffer.byteLength;
    } catch (e) {
      result.failed.push({ key: blob.key, error: e.message });
    }
  }

  return result;
}

/**
 * Unwrap backup envelope { version, patient_id, data: {...} } or pass-through import body.
 */
export function unwrapBackupState(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
    const nested = raw.data;
    const looksLikeTables = PER_PATIENT_TABLE_NAMES.some((t) => Array.isArray(nested[t]))
      || Array.isArray(nested.patient)
      || Array.isArray(nested.app_settings);
    if (looksLikeTables) {
      return {
        ...nested,
        wipe: raw.wipe,
        patient_id: raw.patient_id ?? nested.patient_id,
        scope: raw.scope || nested.scope,
        _backup_meta: {
          version: raw.version,
          exported_at: raw.exported_at,
          scope: raw.scope || nested.scope,
        },
      };
    }
  }
  return raw;
}

/**
 * Главная функция бэкапа — all patients + global tables.
 * @param {object} env
 * @param {{ includeFiles?: boolean, filePackLimits?: object, force?: boolean }} [options]
 *   includeFiles — embed B2 object bytes (base64) under size limits
 *   force — skip content-hash dedup (always write a new object)
 */
export async function runBackup(env, options = {}) {
  const password = env.BACKUP_ENCRYPTION_KEY;
  const includeFiles = options.includeFiles === true;

  if (!password) {
    console.error('[Backup] BACKUP_ENCRYPTION_KEY not set');
    await telegram.sendMessage(env, '<b>[CRITICAL] Ошибка бэкапа</b>\n\nНе задан <code>BACKUP_ENCRYPTION_KEY</code>.');
    return { ok: false, error: 'BACKUP_ENCRYPTION_KEY not set' };
  }

  try {
    const data = await getFullState(env.DB);
    if (data.backup_errors?.length) {
      console.warn('[Backup] partial table errors:', data.backup_errors);
    }

    let filePackMeta = null;
    if (includeFiles) {
      const packed = await packFileBytes(
        env,
        data.data?.b2_file_manifest,
        options.filePackLimits || {}
      );
      data.data.b2_file_blobs = packed.blobs;
      data.data.b2_file_pack_meta = packed.meta;
      filePackMeta = packed.meta;
      data.notes = {
        ...(data.notes || {}),
        b2_files: packed.blobs.length
          ? `Embedded ${packed.blobs.length} file(s) (${packed.meta.total_bytes} bytes); ${packed.meta.skipped} skipped`
          : 'include_files requested but no files packed (empty manifest or all skipped)',
      };
    }

    // Dedup must ignore volatile fields (exported_at) and base64 blob bodies
    const stableJson = JSON.stringify(stableBackupPayload(data));
    const fullJson = JSON.stringify(data);

    const newHash = await computeHash(stableJson);
    let lastHash = null;
    try {
      lastHash = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_backup_hash'").first();
    } catch (e) {
      console.warn('[Backup] could not read last_backup_hash:', e.message);
    }

    if (!options.force && lastHash && lastHash.value === newHash) {
      console.log('[Backup] No changes detected, skipping backup');
      const skipped = {
        ok: true,
        skipped: true,
        reason: 'unchanged',
        at: new Date().toISOString(),
        include_files: includeFiles,
      };
      try {
        await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_backup_status', ?)")
          .bind(JSON.stringify(skipped)).run();
      } catch { /* ignore */ }
      return skipped;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = includeFiles ? '-with-files' : '';
    const fileName = `backups/anamnesis-backup-${dateStr}${suffix}.json.gz.enc`;

    const compressed = await compressData(fullJson);
    const encrypted = await encryptData(compressed, password);

    // B2 first (primary disaster recovery), then Telegram notification
    await b2.uploadFile(env, 'system/latest-backup.json.gz.enc', encrypted, 'application/octet-stream');
    await b2.uploadFile(env, fileName, encrypted, 'application/octet-stream');

    const sizeMb = (encrypted.byteLength / 1024 / 1024).toFixed(3);
    const warn = data.backup_errors?.length
      ? `\n⚠️ partial: ${data.backup_errors.length} table error(s)`
      : '';
    const filesNote = includeFiles
      ? `\n📎 files: ${filePackMeta?.packed ?? 0} packed / ${filePackMeta?.skipped ?? 0} skipped`
      : '';
    const caption = `<b>[DAILY BACKUP]</b> ${dateStr} (${sizeMb} MB)${warn}${filesNote}`;

    // Telegram Bot API document limit ~50 MB; skip attach if too large
    const TG_DOC_LIMIT = 48 * 1024 * 1024;
    try {
      if (encrypted.byteLength <= TG_DOC_LIMIT) {
        const tg = await telegram.sendDocument(env, encrypted, `anamnesis-backup-${dateStr}${suffix}.json.gz.enc`, caption);
        if (!tg.ok) {
          console.error('[Backup] Telegram sendDocument failed (B2 already saved):', tg);
          await telegram.sendMessage(
            env,
            `<b>[BACKUP]</b> Saved to B2 but Telegram document failed: <code>${tg.reason || 'unknown'}</code>`
          );
        }
      } else {
        await telegram.sendMessage(
          env,
          `${caption}\n\nFile too large for Telegram document (${sizeMb} MB) — stored on B2 only: <code>${fileName}</code>`
        );
      }
    } catch (tgErr) {
      console.error('[Backup] Telegram send failed (B2 already saved):', tgErr);
    }

    try {
      await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_backup_hash', ?)")
        .bind(newHash).run();
    } catch (e) {
      console.warn('[Backup] could not store last_backup_hash:', e.message);
    }

    const status = {
      ok: true,
      at: new Date().toISOString(),
      fileName,
      size_bytes: encrypted.byteLength,
      partial_errors: data.backup_errors || [],
      patient_count: data.data?.patient?.length ?? null,
      manifest_files: data.data?.b2_file_manifest?.count ?? null,
      include_files: includeFiles,
      file_pack: filePackMeta,
    };
    try {
      await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_backup_status', ?)")
        .bind(JSON.stringify(status)).run();
    } catch (e) {
      console.warn('[Backup] could not store last_backup_status:', e.message);
    }

    await rotateBackups(env);

    console.log(`[Backup] Successfully saved to B2: ${fileName}`);
    return status;
  } catch (err) {
    console.error('[Backup] Error:', err);
    try {
      await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_backup_status', ?)")
        .bind(JSON.stringify({
          ok: false,
          at: new Date().toISOString(),
          error: err.message,
        })).run();
    } catch { /* ignore */ }
    await telegram.sendMessage(env, `<b>[CRITICAL] Daily backup failed</b>\n\n<code>${err.message}</code>`);
    return { ok: false, error: err.message };
  }
}

async function rotateBackups(env) {
  try {
    // Keep daily backups + pre-restore snapshots; rotate oldest beyond keepN
    const keepN = 10;
    const files = await b2.listAllFiles(env, 'backups/');
    if (files.length <= keepN) return;

    const sorted = files.sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
    const toDelete = sorted.slice(0, sorted.length - keepN);

    for (const file of toDelete) {
      // Prefer deleting old daily backups before pre-restore snapshots when equal age
      console.log(`[Backup] Rotating (deleting) old backup: ${file.Key}`);
      await b2.deleteFile(env, file.Key);
    }
  } catch (err) {
    console.error('[Backup] Rotation failed:', err);
  }
}

async function computeHash(text) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download + decrypt a backup object from B2.
 * @param {string} [storagePath] default system/latest-backup.json.gz.enc
 */
export async function restoreFromKey(env, storagePath = 'system/latest-backup.json.gz.enc') {
  const password = env.BACKUP_ENCRYPTION_KEY;
  if (!password) throw new Error('BACKUP_ENCRYPTION_KEY not set');

  // Prevent path traversal / arbitrary object reads outside backups/system
  const key = String(storagePath || '').replace(/^\/+/, '');
  if (!key || key.includes('..') || (!key.startsWith('backups/') && key !== 'system/latest-backup.json.gz.enc')) {
    const err = new Error('Invalid backup key (must be system/latest-backup.json.gz.enc or backups/*)');
    err.status = 400;
    throw err;
  }

  try {
    const url = await b2.getDownloadUrl(env, key);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download backup ${key}: ${res.status} ${res.statusText}`);
    const encrypted = await res.arrayBuffer();

    const decrypted = await decryptData(encrypted, password);
    const json = await decompressData(decrypted);
    const state = JSON.parse(json);
    return { state, key };
  } catch (err) {
    console.error('[Restore] Error:', err);
    throw err;
  }
}

/** @deprecated use restoreFromKey */
export async function restoreFromLatest(env) {
  const { state } = await restoreFromKey(env, 'system/latest-backup.json.gz.enc');
  return state;
}

/**
 * Snapshot current D1 state to B2 before destructive restore.
 * @returns {{ key: string } | { skipped: true, reason: string }}
 */
export async function snapshotBeforeRestore(env) {
  const password = env.BACKUP_ENCRYPTION_KEY;
  if (!password) return { skipped: true, reason: 'no encryption key' };

  try {
    const data = await getFullState(env.DB);
    const json = JSON.stringify(data);
    const compressed = await compressData(json);
    const encrypted = await encryptData(compressed, password);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `backups/pre-restore-${ts}.json.gz.enc`;
    await b2.uploadFile(env, key, encrypted, 'application/octet-stream');
    await b2.uploadFile(env, 'system/latest-backup.json.gz.enc', encrypted, 'application/octet-stream');
    console.log('[Backup] pre-restore snapshot:', key);
    return { key, size_bytes: encrypted.byteLength };
  } catch (e) {
    console.error('[Backup] pre-restore snapshot failed:', e);
    return { skipped: true, reason: e.message };
  }
}

async function decryptData(data, password) {
  const enc = new TextEncoder();
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const encrypted = data.slice(28);

  const passwordKey = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    { name: 'PBKDF2' },
    false, ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false, ['decrypt']
  );

  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
}

async function decompressData(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/**
 * Safe SELECT for backup: never throws for missing table/column — logs and returns [].
 */
async function selectAll(db, sql, tableLabel) {
  try {
    const res = await db.prepare(sql).all();
    return { rows: res?.results || [], error: null };
  } catch (e) {
    console.error(`[Backup] skip table ${tableLabel}:`, e.message);
    return { rows: [], error: `${tableLabel}: ${e.message}` };
  }
}

/**
 * Собирает данные всех пациентов + глобальные таблицы.
 * Per-table isolation: one bad table must not abort the whole nightly backup.
 */
export async function getFullState(db) {
  const results = {};
  const errors = [];

  {
    const { rows, error } = await selectAll(db, 'SELECT * FROM patient ORDER BY id', 'patient');
    results.patient = rows;
    if (error) errors.push(error);
  }

  // Sequential is fine for nightly cron; avoids D1 batch storms and surfaces which table fails
  for (const { name, orderBy } of PER_PATIENT_TABLES) {
    const { rows, error } = await selectAll(
      db,
      `SELECT * FROM ${name} ORDER BY ${orderBy}`,
      name
    );
    results[name] = rows;
    if (error) errors.push(error);
  }

  // app_settings PK is `key`, not id
  {
    const { rows, error } = await selectAll(db, 'SELECT * FROM app_settings ORDER BY key', 'app_settings');
    results.app_settings = rows;
    if (error) errors.push(error);
  }
  {
    const { rows, error } = await selectAll(db, 'SELECT * FROM app_versions ORDER BY id', 'app_versions');
    results.app_versions = rows;
    if (error) errors.push(error);
  }

  // Device trust (needed for restore of known devices; no private keys here)
  {
    const { rows, error } = await selectAll(
      db,
      'SELECT * FROM known_devices ORDER BY id',
      'known_devices'
    );
    results.known_devices = rows;
    if (error) errors.push(error);
  }

  // WebAuthn public credentials (private key stays on authenticator)
  {
    const { rows, error } = await selectAll(
      db,
      `SELECT id, patient_id, device_id, credential_id, public_key, counter, transports,
              backed_up, device_type, nickname, created_at, last_used_at
       FROM webauthn_credentials ORDER BY id`,
      'webauthn_credentials'
    );
    results.webauthn_credentials = rows;
    if (error) errors.push(error);
  }

  // Recent audit sample (not full history — keep backup size sane)
  {
    const { rows, error } = await selectAll(
      db,
      'SELECT * FROM audit_log ORDER BY id DESC LIMIT 500',
      'audit_log'
    );
    results.audit_log_recent = rows;
    if (error) errors.push(error);
  }

  // B2 object manifest (keys only by default; use runBackup({ includeFiles: true }) to embed)
  results.b2_file_manifest = buildB2FileManifest(results);

  return {
    version: '2.4.0',
    exported_at: new Date().toISOString(),
    scope: 'all_patients',
    data: results,
    backup_errors: errors.length ? errors : undefined,
    notes: {
      b2_files: 'manifest lists object keys from documents/vaccinations. File bytes are NOT embedded unless backup-now?include_files=1.',
      auth: 'known_devices + webauthn public credentials included; sessions/tokens are not.',
    },
  };
}

/**
 * Summarize backup payload without applying (for dry-run restore).
 */
export function summarizeBackupState(raw) {
  const data = unwrapBackupState(raw) || {};
  // When raw still has nested data, also look for pack meta there
  const nested = raw?.data && typeof raw.data === 'object' ? raw.data : {};
  const tables = {};
  let total = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k === 'wipe' || k === '_backup_meta' || k === 'patient_id') continue;
    if (k === 'b2_file_blobs') {
      tables.b2_file_blobs = Array.isArray(v) ? v.length : 0;
      continue;
    }
    if (Array.isArray(v)) {
      tables[k] = v.length;
      total += v.length;
    } else if (v && typeof v === 'object' && k === 'b2_file_manifest') {
      tables[k] = v.count ?? (v.files?.length ?? 0);
    }
  }
  const packMeta = data.b2_file_pack_meta || nested.b2_file_pack_meta || null;
  const blobCount = tables.b2_file_blobs
    ?? (Array.isArray(nested.b2_file_blobs) ? nested.b2_file_blobs.length : 0);
  return {
    version: raw?.version || data._backup_meta?.version || null,
    exported_at: raw?.exported_at || data._backup_meta?.exported_at || null,
    patient_id: raw?.patient_id ?? data.patient_id ?? null,
    tables,
    total_rows: total,
    has_wipe_flag: data.wipe === true,
    b2_manifest_count: data.b2_file_manifest?.count ?? tables.b2_file_manifest ?? null,
    b2_embedded_files: blobCount || 0,
    b2_file_pack_meta: packMeta,
  };
}

const STAGING_COUNT_TABLES = [
  'timeline', 'documents', 'diagnoses', 'medications', 'specialists',
  'vaccinations', 'prescriptions', 'comments', 'plan', 'reminders',
  'medical_errors', 'lab_results', 'growth_log', 'ai_requests',
];

/**
 * Non-destructive "staging" check: compare backup payload to live D1 counts.
 * Does not write. Use before wipe restore.
 */
export async function validateRestoreAgainstLive(db, rawState, sessionPid = 1) {
  const data = unwrapBackupState(rawState) || {};
  const summary = summarizeBackupState(rawState);
  const warnings = [];
  const errors = [];

  // Patients referenced in backup
  const patientIds = new Set();
  if (Array.isArray(data.patient)) {
    for (const p of data.patient) if (p?.id != null) patientIds.add(Number(p.id));
  }
  for (const t of STAGING_COUNT_TABLES) {
    if (!Array.isArray(data[t])) continue;
    for (const row of data[t]) {
      if (row?.patient_id != null) patientIds.add(Number(row.patient_id));
    }
  }
  if (patientIds.size === 0) patientIds.add(Number(sessionPid));

  // Backup row counts (by table)
  const backup_counts = {};
  for (const t of STAGING_COUNT_TABLES) {
    backup_counts[t] = Array.isArray(data[t]) ? data[t].length : 0;
  }
  backup_counts.patient = Array.isArray(data.patient) ? data.patient.length : 0;

  // Live counts for affected patients
  const live_by_patient = {};
  for (const pid of patientIds) {
    const counts = {};
    for (const t of STAGING_COUNT_TABLES) {
      try {
        const row = await db.prepare(
          `SELECT COUNT(*) AS c FROM ${t} WHERE patient_id = ?`
        ).bind(pid).first();
        counts[t] = Number(row?.c ?? row?.['COUNT(*)'] ?? 0);
      } catch (e) {
        counts[t] = null;
        warnings.push(`live count failed for ${t}@${pid}: ${e.message}`);
      }
    }
    try {
      const prow = await db.prepare('SELECT COUNT(*) AS c FROM patient WHERE id = ?').bind(pid).first();
      counts.patient = Number(prow?.c ?? 0);
    } catch {
      counts.patient = 0;
    }
    live_by_patient[pid] = counts;
  }

  // Aggregate live for comparison
  const live_totals = {};
  for (const t of [...STAGING_COUNT_TABLES, 'patient']) {
    live_totals[t] = Object.values(live_by_patient).reduce(
      (sum, c) => sum + (Number(c[t]) || 0),
      0
    );
  }

  const delta = {};
  for (const t of Object.keys(backup_counts)) {
    delta[t] = {
      backup: backup_counts[t],
      live: live_totals[t] ?? 0,
      would_replace: true,
    };
  }

  // Structural checks
  const totalBackupRows = STAGING_COUNT_TABLES.reduce((s, t) => s + (backup_counts[t] || 0), 0);
  if (totalBackupRows === 0) {
    errors.push('Backup has no medical table rows — wipe restore would be refused');
  }

  // Sample required fields for common tables
  const fieldChecks = [];
  if (Array.isArray(data.diagnoses)) {
    const bad = data.diagnoses.filter((d) => !d.name).length;
    if (bad) fieldChecks.push({ table: 'diagnoses', missing_name: bad });
  }
  if (Array.isArray(data.timeline)) {
    const bad = data.timeline.filter((e) => !e.title).length;
    if (bad) fieldChecks.push({ table: 'timeline', missing_title: bad });
  }
  if (Array.isArray(data.documents)) {
    const noPath = data.documents.filter((d) => !d.file_path).length;
    if (noPath) warnings.push(`${noPath} document(s) missing file_path`);
  }

  if (summary.b2_embedded_files > 0) {
    warnings.push(`Backup embeds ${summary.b2_embedded_files} file(s) — use restore_files=1 to re-upload`);
  } else if ((summary.b2_manifest_count || 0) > 0) {
    warnings.push(
      `Backup lists ${summary.b2_manifest_count} B2 key(s) but no embedded bytes — files must already exist in bucket`
    );
  }

  if (patientIds.size > 1 || data.scope === 'all_patients' || data._backup_meta?.scope === 'all_patients') {
    warnings.push(`Multi-patient restore: patients [${[...patientIds].join(', ')}] will each be wiped & restored`);
  }

  const ready = errors.length === 0 && totalBackupRows > 0;

  return {
    ready,
    staging: true,
    writes: false,
    summary,
    patient_ids: [...patientIds],
    backup_counts,
    live_by_patient,
    live_totals,
    delta,
    field_checks: fieldChecks,
    warnings,
    errors,
    message: ready
      ? 'Staging validation OK — nothing written. Apply with confirm WIPE when ready.'
      : 'Staging validation found blocking issues — do not wipe-restore yet.',
  };
}

/**
 * Build list of B2 keys referenced by DB rows (for backup integrity / restore checklist).
 */
export function buildB2FileManifest(tables) {
  const keys = [];
  const seen = new Set();

  const add = (key, source, id) => {
    if (!key || typeof key !== 'string') return;
    const k = key.replace(/^\/api\/vaccinations\/photos\//, '');
    if (seen.has(k)) return;
    seen.add(k);
    keys.push({ key: k, source, id: id ?? null });
  };

  for (const doc of tables.documents || []) {
    add(doc.file_path, 'documents', doc.id);
  }
  for (const vac of tables.vaccinations || []) {
    try {
      const photos = JSON.parse(vac.photos || '[]');
      if (Array.isArray(photos)) {
        for (const p of photos) add(p, 'vaccinations', vac.id);
      }
    } catch { /* skip */ }
  }

  return {
    count: keys.length,
    files: keys,
  };
}

async function compressData(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

async function encryptData(data, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const passwordKey = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    { name: 'PBKDF2' },
    false, ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  const result = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.byteLength);
  result.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);

  return result.buffer;
}
