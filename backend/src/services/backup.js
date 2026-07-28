import * as telegram from './telegram';
import * as b2 from './b2-storage';

/**
 * Главная функция бэкапа.
 */
export async function runBackup(env) {
  const startedAt = Date.now();
  const password = env.BACKUP_ENCRYPTION_KEY;
  const patientId = 1;

  if (!password) {
    console.error('[Backup] BACKUP_ENCRYPTION_KEY not set');
    await telegram.sendMessage(env, '<b>[CRITICAL] Ошибка бэкапа</b>\n\nНе задан <code>BACKUP_ENCRYPTION_KEY</code>.');
    return;
  }

  try {
    const data = await getFullState(env.DB, patientId);
    const json = JSON.stringify(data);
    
    // 0. Дедупликация (проверка хеша)
    const newHash = await computeHash(json);
    const lastHash = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_backup_hash'").first();
    
    if (lastHash && lastHash.value === newHash) {
      console.log('[Backup] No changes detected, skipping backup');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `backups/anamnesis-backup-${dateStr}.json.gz.enc`;

    const compressed = await compressData(json);
    const encrypted = await encryptData(compressed, password);

    // 1. Отправляем в Telegram (для уведомления)
    const sizeMb = (encrypted.byteLength / 1024 / 1024).toFixed(3);
    const caption = `<b>[DAILY BACKUP]</b> ${dateStr} (${sizeMb} MB)`;
    await telegram.sendDocument(env, encrypted, `anamnesis-backup-${dateStr}.json.gz.enc`, caption);

    // 2. Сохраняем в B2 как "последний актуальный" (для авто-восстановления)
    await b2.uploadFile(env, 'system/latest-backup.json.gz.enc', encrypted, 'application/octet-stream');
    
    // 3. Сохраняем в архивную папку B2
    await b2.uploadFile(env, fileName, encrypted, 'application/octet-stream');

    // 4. Сохраняем новый хеш
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_backup_hash', ?)")
      .bind(newHash).run();

    // 5. Ротация (оставляем только 5 последних в папке backups/)
    await rotateBackups(env);

    console.log(`[Backup] Successfully saved to Telegram and B2: ${fileName}`);

  } catch (err) {
    console.error('[Backup] Error:', err);
    await telegram.sendMessage(env, `<b>[CRITICAL] Daily backup failed</b>\n\n<code>${err.message}</code>`);
  }
}

/**
 * Ротация бэкапов в B2: оставляем только 5 последних файлов в папке backups/
 */
async function rotateBackups(env) {
  try {
    const files = await b2.listFiles(env, 'backups/');
    if (files.length <= 5) return;

    // Сортируем по дате изменения (старые в начале)
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

/**
 * Вычисление хеша SHA-256
 */
async function computeHash(text) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Восстановление из последнего бэкапа в B2.
 */
export async function restoreFromLatest(env) {
  const password = env.BACKUP_ENCRYPTION_KEY;
  const storagePath = 'system/latest-backup.json.gz.enc';

  try {
    // 1. Скачиваем из B2 (через прямой запрос или прокси)
    // Так как у нас нет метода download в b2-storage.js, реализуем здесь через fetch
    const url = await b2.getDownloadUrl(env, storagePath);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download backup: ${res.statusText}`);
    const encrypted = await res.arrayBuffer();

    // 2. Расшифровываем
    const decrypted = await decryptData(encrypted, password);

    // 3. Распаковываем
    const json = await decompressData(decrypted);
    const state = JSON.parse(json);

    // 4. Импортируем (через внутренний вызов, но для простоты вернем данные для роута)
    return state;
  } catch (err) {
    console.error('[Restore] Error:', err);
    throw err;
  }
}

/**
 * Расшифровка AES-GCM.
 */
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

/**
 * Распаковка Gzip.
 */
async function decompressData(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/**
 * Собирает все данные из D1.
 */
async function getFullState(db, pid) {
  // Таблицы, где есть patient_id
  const perPatientTables = [
    'diagnoses', 'medications', 'specialists', 
    'medical_errors', 'plan', 'timeline', 'documents',
    'reminders', 'comments', 'vaccinations', 'growth_log', 
    'lab_results', 'prescriptions', 'ai_requests'
  ];

  // Глобальные или специфичные таблицы
  const globalTables = ['app_settings', 'app_versions'];

  const results = {};
  
  // 1. Данные пациента
  results['patient'] = (await db.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).all()).results;

  // 2. Таблицы с фильтром по patient_id
  const perPatientQueries = perPatientTables.map(t => 
    db.prepare(`SELECT * FROM ${t} WHERE patient_id = ?`).bind(pid).all()
  );
  const perPatientRows = await Promise.all(perPatientQueries);
  perPatientTables.forEach((t, i) => {
    results[t] = perPatientRows[i].results;
  });

  // 3. Глобальные таблицы
  const globalQueries = globalTables.map(t => db.prepare(`SELECT * FROM ${t}`).all());
  const globalRows = await Promise.all(globalQueries);
  globalTables.forEach((t, i) => {
    results[t] = globalRows[i].results;
  });

  return {
    version: '2.0.0',
    exported_at: new Date().toISOString(),
    patient_id: pid,
    data: results
  };
}

/**
 * Сжатие через встроенный CompressionStream (Gzip).
 */
async function compressData(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

/**
 * Шифрование AES-GCM через Web Crypto API.
 */
async function encryptData(data, password) {
  const enc = new TextEncoder();
  
  // 1. Создаем соль и IV
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 2. Деривация ключа из пароля (PBKDF2)
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

  // 3. Шифруем
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // 4. Склеиваем всё в один буфер: SALT (16) + IV (12) + DATA
  const result = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.byteLength);
  result.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);

  return result.buffer;
}
