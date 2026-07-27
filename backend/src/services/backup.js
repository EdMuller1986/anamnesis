import * as telegram from './telegram';

/**
 * Система бэкапа для Serverless:
 * 1. Собирает полный стейт всех таблиц в JSON.
 * 2. Сжимает JSON через Gzip (CompressionStream).
 * 3. Шифрует результат через AES-GCM с паролем BACKUP_ENCRYPTION_KEY.
 * 4. Отправляет зашифрованный файл в Telegram.
 */

/**
 * Главная функция бэкапа.
 */
export async function runBackup(env) {
  const startedAt = Date.now();
  const password = env.BACKUP_ENCRYPTION_KEY;
  const patientId = 1; // По умолчанию для автоматики

  if (!password) {
    console.error('[Backup] BACKUP_ENCRYPTION_KEY not set');
    await telegram.sendMessage(env, '<b>[CRITICAL] Ошибка бэкапа</b>\n\nНе задан <code>BACKUP_ENCRYPTION_KEY</code> в переменных окружения.');
    return;
  }

  try {
    // 1. Получаем данные (используем внутренний вызов логики из admin.js, но здесь имитируем сбор)
    const data = await getFullState(env.DB, patientId);
    const json = JSON.stringify(data);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `anamnesis-backup-${dateStr}.json.gz.enc`;

    // 2. Сжимаем
    const compressed = await compressData(json);

    // 3. Шифруем
    const encrypted = await encryptData(compressed, password);

    // 4. Отправляем в Telegram
    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    const sizeMb = (encrypted.byteLength / 1024 / 1024).toFixed(3);
    
    const caption = 
      `<b>[DAILY BACKUP SUCCESS]</b>\n\n` +
      `• Дата: <code>${dateStr}</code>\n` +
      `• Размер: <code>${sizeMb} MB</code>\n` +
      `• Время: <code>${duration}s</code>\n` +
      `• Шифрование: <code>AES-GCM</code>\n\n` +
      `Данные зашифрованы ключом <code>BACKUP_ENCRYPTION_KEY</code>.`;

    const res = await telegram.sendDocument(env, encrypted, fileName, caption);
    
    if (res.ok) {
      console.log(`[Backup] Sent to Telegram: ${fileName} (${sizeMb} MB)`);
    } else {
      throw new Error(`Telegram upload failed: ${res.reason}`);
    }

  } catch (err) {
    console.error('[Backup] Error:', err);
    await telegram.sendMessage(env, `<b>[CRITICAL] Daily backup failed</b>\n\n<code>${err.message}</code>`);
  }
}

/**
 * Собирает все данные из D1.
 */
async function getFullState(db, pid) {
  const tables = [
    'patient', 'diagnoses', 'medications', 'specialists', 
    'medical_errors', 'plan', 'timeline', 'documents',
    'reminders', 'comments', 'vaccinations', 'growth_log', 
    'lab_results', 'prescriptions', 'app_settings'
  ];

  const results = {};
  const queries = tables.map(t => db.prepare(`SELECT * FROM ${t} WHERE patient_id = ? OR patient_id IS NULL`).bind(pid).all());
  const rows = await Promise.all(queries);
  
  tables.forEach((t, i) => {
    results[t] = rows[i].results;
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
