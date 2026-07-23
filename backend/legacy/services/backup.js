// Автоматическая система бэкапов — три уровня:
//
// 1. LOCAL HOT BACKUP (SQLite `.backup` API)
//    Каждые BACKUP_INTERVAL_HOURS часов консистентный снимок БД в
//    backend/data/backups/. Ротация: держим последние BACKUP_KEEP_COUNT
//    локальных копий. Это защищает от логических ошибок и случайных
//    DELETE/UPDATE. НЕ защищает от потери VPS.
//
// 2. LOCAL ARCHIVE (сжатый tar.gz с БД + uploads)
//    Раз в сутки (02:00) собираем полный архив: БД + uploads + .env
//    (без секретов), шифруем AES-256-CBC с BACKUP_ENCRYPTION_KEY,
//    кладём в backend/data/backups/archives/. Держим 14 последних.
//    Нужен для DR-восстановления всего сервиса.
//
// 3. OFFSITE TELEGRAM (шифрованный архив в Telegram бот)
//    Тот же ежедневный архив отправляется в Telegram через бот
//    в личный чат владельца (TELEGRAM_CHAT_ID). Это географически
//    избыточная копия — переживает потерю VPS, локального компа,
//    GitHub аккаунта. Telegram хранит всю историю, можно скачать
//    архив любой давности с любого устройства. Файл зашифрован
//    AES-256, поэтому даже если Telegram аккаунт взломают —
//    данные нечитаемы без BACKUP_ENCRYPTION_KEY.
//
// Схема хранения:
//   data/backups/                           ← hot snapshots (6h)
//     danil-2026-04-11T02-00-00.db
//     danil-2026-04-11T08-00-00.db
//     ...
//   data/backups/archives/                  ← ежедневные полные архивы (24h)
//     danil-full-2026-04-11.tar.gz.enc
//     ...
//
// При каждом успешном архиве — уведомление в Telegram с хешем.
// При каждой ошибке — тревожное уведомление в Telegram.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const cron = require('node-cron');
const config = require('../config');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');
const ARCHIVE_DIR = path.join(BACKUP_DIR, 'archives');
const UPLOAD_DIR = config.UPLOAD_DIR;
const DB_PATH = config.DATABASE_URL || path.join(__dirname, '..', '..', 'data', 'anamnesis.db');

// ─── УТИЛИТЫ ─────────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

async function telegramSend(text) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    if (!resp.ok) {
      console.error('Telegram sendMessage failed:', resp.status, await resp.text());
    }
  } catch (e) {
    console.error('Telegram send error:', e.message);
  }
}

async function telegramSendDocument(filePath, caption) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.log('Telegram offsite backup skipped — bot not configured');
    return false;
  }
  try {
    // FormData в Node.js 18+ через встроенный fetch.
    const form = new FormData();
    form.append('chat_id', config.TELEGRAM_CHAT_ID);
    form.append('caption', caption.slice(0, 1024)); // лимит Telegram
    form.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));

    const resp = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendDocument`,
      { method: 'POST', body: form }
    );
    if (!resp.ok) {
      const err = await resp.text();
      console.error('Telegram sendDocument failed:', resp.status, err);
      return false;
    }
    const data = await resp.json();
    return data.ok === true;
  } catch (e) {
    console.error('Telegram sendDocument error:', e.message);
    return false;
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

// AES-256-CBC с PBKDF2 — совместимо с openssl enc для ручной расшифровки.
function encryptFile(inputPath, outputPath, passphrase) {
  // Используем openssl CLI — он уже есть на любом Linux и
  // гарантированно совместим с `openssl enc -d -aes-256-cbc -pbkdf2`.
  // Альтернатива — Node crypto, но тогда ручная расшифровка сложнее.
  execSync(
    `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -in "${inputPath}" -out "${outputPath}" -pass env:BACKUP_ENC_PASS`,
    {
      env: { ...process.env, BACKUP_ENC_PASS: passphrase },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
}

// ─── 1. LOCAL HOT BACKUP — SQLite .backup API ────────────────────

async function createHotBackup() {
  try {
    const { rawDb } = require('../db');
    ensureDir(BACKUP_DIR);
    const backupPath = path.join(BACKUP_DIR, `danil-${timestamp()}.db`);
    await rawDb.backup(backupPath);
    fs.chmodSync(backupPath, 0o600);
    console.log(`[backup] Hot snapshot: ${path.basename(backupPath)}`);
    rotateHotBackups();
    return backupPath;
  } catch (err) {
    console.error('[backup] Hot backup error:', err.message);
    await telegramSend(`<b>[WARNING] Ошибка hot-бэкапа</b>\n\n<code>${err.message}</code>`);
    return null;
  }
}

function rotateHotBackups() {
  try {
    const keepCount = config.BACKUP_KEEP_COUNT || 14;
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('danil-') && f.endsWith('.db'))
      .sort()
      .reverse();
    for (let i = keepCount; i < files.length; i++) {
      fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
      console.log(`[backup] Rotated out: ${files[i]}`);
    }
  } catch (err) {
    console.error('[backup] Rotation error:', err.message);
  }
}

// ─── 2. DAILY FULL ARCHIVE — DB + uploads + зашифровано ──────────

async function createDailyArchive() {
  const startedAt = Date.now();
  try {
    ensureDir(ARCHIVE_DIR);
    const date = dateStr();

    // 1. Hot snapshot в tmp (консистентная БД для архива)
    const tmpDbPath = path.join(ARCHIVE_DIR, `.tmp-danil-${date}.db`);
    const { rawDb } = require('../db');
    await rawDb.backup(tmpDbPath);

    // 2. tar.gz архив: снимок БД + uploads
    // --exclude previews — PNG-превью регенерируются из PDF, их не храним
    // --exclude-vcs — на всякий случай
    const archivePath = path.join(ARCHIVE_DIR, `danil-full-${date}.tar.gz`);
    const relBase = path.relative(process.cwd(), path.dirname(UPLOAD_DIR));
    execSync(
      `tar -czf "${archivePath}" \
        --exclude='backups' \
        --exclude='previews' \
        --exclude='*.db-wal' \
        --exclude='*.db-shm' \
        -C "${path.dirname(tmpDbPath)}" "${path.basename(tmpDbPath)}" \
        -C "${path.resolve(UPLOAD_DIR, '..')}" "${path.basename(UPLOAD_DIR)}"`,
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );

    // 3. Удаляем временную копию БД
    fs.unlinkSync(tmpDbPath);

    // 4. Шифруем архив (если есть ключ)
    let finalPath = archivePath;
    let encrypted = false;
    if (config.BACKUP_ENCRYPTION_KEY) {
      const encPath = `${archivePath}.enc`;
      encryptFile(archivePath, encPath, config.BACKUP_ENCRYPTION_KEY);
      fs.unlinkSync(archivePath); // удаляем незашифрованный
      finalPath = encPath;
      encrypted = true;
    }

    fs.chmodSync(finalPath, 0o600);
    const sizeMb = (fs.statSync(finalPath).size / 1024 / 1024).toFixed(2);
    const hash = sha256File(finalPath).slice(0, 16);
    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);

    console.log(
      `[backup] Daily archive: ${path.basename(finalPath)} (${sizeMb} MB, ${durationSec}s, sha256:${hash}${encrypted ? ', encrypted' : ''})`
    );

    rotateArchives();

    // 5. Offsite: отправляем в Telegram
    let offsiteOk = false;
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
      const caption =
        `<b>[DAILY BACKUP]</b>\n\n` +
        `• Дата: ${date}\n` +
        `• Размер: ${sizeMb} MB\n` +
        `• SHA-256: <code>${hash}...</code>\n` +
        `• Шифрование: ${encrypted ? 'AES-256-CBC/PBKDF2' : 'нет'}\n` +
        `• Время: ${durationSec}s\n\n` +
        `Для восстановления:\n` +
        (encrypted
          ? `<code>openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in FILE.enc -out FILE.tar.gz -pass pass:BACKUP_ENCRYPTION_KEY</code>\n`
          : '') +
        `<code>tar -xzf FILE.tar.gz</code>`;

      offsiteOk = await telegramSendDocument(finalPath, caption);
      if (offsiteOk) {
        console.log('[backup] Offsite Telegram backup sent');
      } else {
        await telegramSend(`<b>[WARNING] Offsite backup failed</b>\nЛокальный бэкап создан, но в Telegram не ушёл`);
      }
    }

    return { path: finalPath, size: sizeMb, hash, encrypted, offsite: offsiteOk };
  } catch (err) {
    console.error('[backup] Daily archive error:', err.message);
    await telegramSend(
      `<b>[CRITICAL] Daily backup failed</b>\n\n<code>${err.message}</code>\n\nCheck anamnesis service logs on the server.`
    );
    return null;
  }
}

function rotateArchives() {
  try {
    const keepCount = 14; // две недели ежедневных архивов
    const files = fs
      .readdirSync(ARCHIVE_DIR)
      .filter(f => f.startsWith('danil-full-') && (f.endsWith('.tar.gz') || f.endsWith('.tar.gz.enc')))
      .sort()
      .reverse();
    for (let i = keepCount; i < files.length; i++) {
      fs.unlinkSync(path.join(ARCHIVE_DIR, files[i]));
      console.log(`[backup] Archive rotated out: ${files[i]}`);
    }
  } catch (err) {
    console.error('[backup] Archive rotation error:', err.message);
  }
}

// ─── ПУБЛИЧНЫЕ ФУНКЦИИ ───────────────────────────────────────────

/**
 * Ручной вызов из admin-tools — делает оба типа бэкапа сразу.
 * Возвращает результат для показа пользователю.
 */
async function createBackupNow() {
  const hotPath = await createHotBackup();
  const archive = await createDailyArchive();
  return { hot: hotPath, archive };
}

// Экспортируем createBackup как alias для совместимости со старым API.
async function createBackup() {
  return createHotBackup();
}

function initBackupScheduler() {
  if (!config.BACKUP_ENABLED) {
    console.log('[backup] Disabled (BACKUP_ENABLED=false)');
    return;
  }

  // Hot backups каждые N часов
  const hours = config.BACKUP_INTERVAL_HOURS || 6;
  const hotCron = `0 */${hours} * * *`;
  cron.schedule(hotCron, createHotBackup);
  console.log(`[backup] Hot scheduled: каждые ${hours}ч (${hotCron})`);

  // Daily archive в 02:00 по серверному времени
  cron.schedule('0 2 * * *', createDailyArchive);
  console.log('[backup] Daily archive scheduled: 02:00');

  // Initial backups при старте — через 30 секунд чтобы сервис успел запуститься
  setTimeout(() => {
    createHotBackup();
  }, 30_000);

  // Первый daily archive — через 2 минуты после старта, но только если сегодня ещё не было
  setTimeout(async () => {
    const today = dateStr();
    try {
      if (fs.existsSync(ARCHIVE_DIR)) {
        const hasToday = fs
          .readdirSync(ARCHIVE_DIR)
          .some(f => f.includes(`danil-full-${today}`));
        if (!hasToday) await createDailyArchive();
      } else {
        await createDailyArchive();
      }
    } catch (e) {
      console.error('[backup] initial archive check error:', e.message);
    }
  }, 120_000);
}

module.exports = {
  initBackupScheduler,
  createBackup,          // legacy alias
  createBackupNow,       // новая функция для /api/admin/tools/backup-now
  createHotBackup,
  createDailyArchive,
  telegramSend,          // для deploy notifications
};
