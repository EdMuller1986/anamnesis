import * as telegram from './telegram';
import * as b2 from './b2-storage';

const PER_PATIENT_TABLES = [
  'diagnoses', 'medications', 'specialists',
  'medical_errors', 'plan', 'timeline', 'documents',
  'reminders', 'comments', 'vaccinations', 'growth_log',
  'lab_results', 'prescriptions', 'ai_requests', 'visit_diagnoses',
];

/**
 * Canonical payload for hashing / restore (no volatile exported_at).
 */
export function stableBackupPayload(state) {
  const { exported_at, ...rest } = state || {};
  return rest;
}

/**
 * Unwrap backup envelope { version, patient_id, data: {...} } or pass-through import body.
 */
export function unwrapBackupState(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
    const nested = raw.data;
    const looksLikeTables = PER_PATIENT_TABLES.some((t) => Array.isArray(nested[t]))
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
    const stableJson = JSON.stringify(stableBackupPayload(data));
    const fullJson = JSON.stringify(data);

    // Dedup on stable payload (ignores exported_at)
    const newHash = await computeHash(stableJson);
    const lastHash = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_backup_hash'").first();

    if (lastHash && lastHash.value === newHash) {
      console.log('[Backup] No changes detected, skipping backup');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `backups/anamnesis-backup-${dateStr}.json.gz.enc`;

    const compressed = await compressData(fullJson);
    const encrypted = await encryptData(compressed, password);

    // B2 first (primary disaster recovery), then Telegram notification
    await b2.uploadFile(env, 'system/latest-backup.json.gz.enc', encrypted, 'application/octet-stream');
    await b2.uploadFile(env, fileName, encrypted, 'application/octet-stream');

    try {
      const sizeMb = (encrypted.byteLength / 1024 / 1024).toFixed(3);
      const caption = `<b>[DAILY BACKUP]</b> ${dateStr} (${sizeMb} MB)`;
      await telegram.sendDocument(env, encrypted, `anamnesis-backup-${dateStr}.json.gz.enc`, caption);
    } catch (tgErr) {
      console.error('[Backup] Telegram send failed (B2 already saved):', tgErr);
    }

    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_backup_hash', ?)")
      .bind(newHash).run();

    await rotateBackups(env);

    console.log(`[Backup] Successfully saved to B2: ${fileName}`);
  } catch (err) {
    console.error('[Backup] Error:', err);
    await telegram.sendMessage(env, `<b>[CRITICAL] Daily backup failed</b>\n\n<code>${err.message}</code>`);
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
 * Собирает данные всех пациентов + глобальные таблицы.
 */
export async function getFullState(db) {
  const results = {};

  const patients = (await db.prepare('SELECT * FROM patient ORDER BY id').all()).results || [];
  results.patient = patients;

  const perPatientQueries = PER_PATIENT_TABLES.map((t) =>
    db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()
  );
  const perPatientRows = await Promise.all(perPatientQueries);
  PER_PATIENT_TABLES.forEach((t, i) => {
    results[t] = perPatientRows[i].results || [];
  });

  for (const t of ['app_settings', 'app_versions']) {
    results[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results || [];
  }

  return {
    version: '2.1.0',
    exported_at: new Date().toISOString(),
    scope: 'all_patients',
    data: results,
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
