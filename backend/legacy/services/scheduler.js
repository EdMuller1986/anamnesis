const cron = require('node-cron');
const pool = require('../db');
const { sendMessage } = require('./telegram');

/**
 * Проверяет напоминания каждые 15 минут.
 * Если remind_at <= NOW() и status = 'pending', отправляет в Telegram и помечает как sent.
 */
function initScheduler() {
  // Каждые 15 минут: */15 * * * *
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= NOW()"
      );

      for (const reminder of rows) {
        const text = `🔔 <b>${reminder.title}</b>\n${reminder.message || ''}`;

        await sendMessage(text);

        await pool.query(
          "UPDATE reminders SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1",
          [reminder.id]
        );

        console.log(`[Scheduler] Напоминание #${reminder.id} отправлено`);
      }

      if (rows.length > 0) {
        console.log(`[Scheduler] Обработано напоминаний: ${rows.length}`);
      }
    } catch (err) {
      console.error('[Scheduler] Ошибка проверки напоминаний:', err);
    }
  });

  console.log('[Scheduler] Планировщик напоминаний запущен (каждые 15 мин)');
}

module.exports = { initScheduler };
