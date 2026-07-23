// Native Telegram client for Cloudflare Workers (using fetch)

const TG_BASE = 'https://api.telegram.org';

/**
 * Отправить текстовое сообщение в Telegram-чат владельца.
 */
export async function sendMessage(env, text, options = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('[Telegram] Бот не настроен. Сообщение:', text);
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const resp = await fetch(
      `${TG_BASE}/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
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
 * Отправить файл как документ (Buffer/ArrayBuffer).
 */
export async function sendDocument(env, fileBuffer, fileName, caption = '', options = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return { ok: false, reason: 'not_configured' };

  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', options.parse_mode || 'HTML');
    form.append('document', new Blob([fileBuffer]), fileName);

    const resp = await fetch(
      `${TG_BASE}/bot${token}/sendDocument`,
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
