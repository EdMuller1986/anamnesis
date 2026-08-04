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
export function stableBackupPayload(state) {
  // Drop volatile fields so unchanged medical data keeps the same hash
  if (!state || typeof state !== 'object') return state;
  const { exported_at, backup_errors, notes, ...rest } = state;
  if (rest.data && typeof rest.data === 'object') {
    const { b2_file_manifest, ...dataRest } = rest.data;
    // Keep manifest structure but sort keys for stable hash
    const manifest = b2_file_manifest
      ? {
          count: b2_file_manifest.count,
          files: [...(b2_file_manifest.files || [])].sort((a, b) =>
            String(a.key).localeCompare(String(b.key))
          ),
        }
      : undefined;
    return { ...rest, data: { ...dataRest, b2_file_manifest: manifest } };
  }
  return rest;
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
        _backup_meta: {
          version: raw.version,
          exported_at: raw.exported_at,
        },
      };
    }
  }
  return raw;
}

/**
 * Главная функция бэкапа — all patients + global tables.
 */
export async function runBackup(env) {
  const password = env.BACKUP_ENCRYPTION_KEY;

  if (!password) {
    console.error('[Backup] BACKUP_ENCRYPTION_KEY not set');
    await telegram.sendMessage(env, '<b>[CRITICAL] Ошибка бэкапа</b>\n\nНе задан <code>BACKUP_ENCRYPTION_KEY</code>.');
    return;
  }

try {
    const data = await getFullState(env.DB);
    if (data.backup_errors?.length) {
      console.warn('[Backup] partial table errors:', data.backup_errors);
    }

    // Dedup must ignore volatile fields (exported_at) and transient error notes
    const stableJson = JSON.stringify(stableBackupPayload(data));
    const fullJson = JSON.stringify(data);

    const newHash = await computeHash(stableJson);
    let lastHash = null;
    try {
      lastHash = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_backup_hash'").first();
    } catch (e) {
      console.warn('[Backup] could not read last_backup_hash:', e.message);
    }

    if (lastHash && lastHash.value === newHash) {
      console.log('[Backup] No changes detected, skipping backup');
      return { ok: true, skipped: true, reason: 'unchanged' };
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `backups/anamnesis-backup-${dateStr}.json.gz.enc`;

    const compressed = await compressData(fullJson);
    const encrypted = await encryptData(compressed, password);

    // B2 first (primary disaster recovery), then Telegram notification
    await b2.uploadFile(env, 'system/latest-backup.json.gz.enc', encrypted, 'application/octet-stream');
    await b2.uploadFile(env, fileName, encrypted, 'application/octet-stream');

    const sizeMb = (encrypted.byteLength / 1024 / 1024).toFixed(3);
    const warn = data.backup_errors?.length
      ? `\n⚠️ partial: ${data.backup_errors.length} table error(s)`
      : '';
    const caption = `<b>[DAILY BACKUP]</b> ${dateStr} (${sizeMb} MB)${warn}`;

    try {
      const tg = await telegram.sendDocument(env, encrypted, `anamnesis-backup-${dateStr}.json.gz.enc`, caption);
      if (!tg.ok) {
        console.error('[Backup] Telegram sendDocument failed (B2 already saved):', tg);
        await telegram.sendMessage(
          env,
          `<b>[BACKUP]</b> Saved to B2 but Telegram document failed: <code>${tg.reason || 'unknown'}</code>`
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

    await rotateBackups(env);

    console.log(`[Backup] Successfully saved to B2: ${fileName}`);
    return { ok: true, fileName, partial_errors: data.backup_errors || [] };
  } catch (err) {
    console.error('[Backup] Error:', err);
    await telegram.sendMessage(env, `<b>[CRITICAL] Daily backup failed</b>\n\n<code>${err.message}</code>`);
    return { ok: false, error: err.message };
  }
}

async function rotateBackups(env) {
  try {
    const files = await b2.listFiles(env, 'backups/');
    if (files.length <= 5) return;

    const sorted = files.sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
    const toDelete = sorted.slice(0, sorted.length - 5);

    for (const file of toDelete) {
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
 * Восстановление из последнего бэкапа в B2.
 */
export async function restoreFromLatest(env) {
  const password = env.BACKUP_ENCRYPTION_KEY;
  const storagePath = 'system/latest-backup.json.gz.enc';

  try {
    const url = await b2.getDownloadUrl(env, storagePath);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download backup: ${res.statusText}`);
    const encrypted = await res.arrayBuffer();

    const decrypted = await decryptData(encrypted, password);
    const json = await decompressData(decrypted);
    const state = JSON.parse(json);
    return state;
  } catch (err) {
    console.error('[Restore] Error:', err);
    throw err;
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

  // B2 object manifest (keys only — bytes stay in bucket; full DR needs bucket intact)
  results.b2_file_manifest = buildB2FileManifest(results);

  return {
    version: '2.2.1',
    exported_at: new Date().toISOString(),
    scope: 'all_patients',
    data: results,
    backup_errors: errors.length ? errors : undefined,
    notes: {
      b2_files: 'manifest lists object keys from documents/vaccinations; file bytes are NOT embedded. Keep B2 bucket or copy keys separately.',
    },
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
