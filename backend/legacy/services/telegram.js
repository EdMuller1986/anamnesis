// Native Telegram client — без зависимости на node-telegram-bot-api.
//
// Почему native: пакет node-telegram-bot-api тянет старый request/form-data/tough-cookie
// с 2 critical + 3 moderate CVE которые не фиксятся без breaking change.
// Нам нужен только sendMessage/sendDocument — это один POST, проще сделать
// через встроенный fetch (Node 18+). Безопаснее, меньше deps.

const config = require('../config');

const TG_BASE = 'https://api.telegram.org';

/**
 * Отправить текстовое сообщение в Telegram-чат владельца.
 * Если TOKEN/CHAT_ID не заданы — молча логируем и выходим.
 */
async function sendMessage(text, options = {}) {
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.log('[Telegram] Бот не настроен. Сообщение:', text);
    return { ok: false, reason: 'no_token' };
  }
  if (!config.TELEGRAM_CHAT_ID) {
    console.log('[Telegram] TELEGRAM_CHAT_ID не задан. Сообщение:', text);
    return { ok: false, reason: 'no_chat_id' };
  }

  try {
    const resp = await fetch(
      `${TG_BASE}/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text,
          parse_mode: options.parse_mode || 'HTML',
          disable_web_page_preview: options.disable_preview !== false,
          disable_notification: options.silent || false,
        }),
      }
    );
    if (!resp.ok) {
      const err = await resp.text();
      console.error('[Telegram] sendMessage failed:', resp.status, err);
      return { ok: false, reason: 'api_error', status: resp.status };
    }
    return { ok: true };
  } catch (err) {
    console.error('[Telegram] sendMessage error:', err.message);
    return { ok: false, reason: 'network_error', error: err.message };
  }
}

/**
 * Отправить файл как документ. Используется системой бэкапов для offsite копий.
 */
async function sendDocument(filePath, caption = '', options = {}) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const buf = fs.readFileSync(filePath);

    const form = new FormData();
    form.append('chat_id', config.TELEGRAM_CHAT_ID);
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', options.parse_mode || 'HTML');
    form.append('document', new Blob([buf]), options.filename || path.basename(filePath));

    const resp = await fetch(
      `${TG_BASE}/bot${config.TELEGRAM_BOT_TOKEN}/sendDocument`,
      { method: 'POST', body: form }
    );
    if (!resp.ok) {
      const err = await resp.text();
      console.error('[Telegram] sendDocument failed:', resp.status, err);
      return { ok: false, reason: 'api_error', status: resp.status };
    }
    const data = await resp.json();
    return { ok: data.ok === true, message_id: data.result?.message_id };
  } catch (err) {
    console.error('[Telegram] sendDocument error:', err.message);
    return { ok: false, reason: 'network_error', error: err.message };
  }
}

module.exports = { sendMessage, sendDocument };
