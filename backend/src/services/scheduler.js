import * as telegram from './telegram';

/**
 * Планировщик напоминаний для Cloudflare Workers.
 */
export async function checkReminders(env) {
  const db = env.DB;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
    // 1. Ищем все активные напоминания, время которых пришло
    const { results } = await db.prepare(
      "SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ?"
    ).bind(now).all();

    if (!results || results.length === 0) return;

    console.log(`[Scheduler] Найдено напоминаний: ${results.length}`);

    for (const reminder of results) {
      const body = reminder.message
        ? `${reminder.title}\n\n${reminder.message}`
        : reminder.title;
      const text = `🔔 <b>Напоминание</b>\n\n${body}`;

      const res = await telegram.sendMessage(env, text);

      if (res.ok) {
        try {
          await db.prepare(
            "UPDATE reminders SET status = 'done', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
          ).bind(reminder.id).run();
        } catch {
          // sent_at/updated_at may be missing on older DBs
          await db.prepare(
            "UPDATE reminders SET status = 'done' WHERE id = ?"
          ).bind(reminder.id).run();
        }
        console.log(`[Scheduler] Напоминание #${reminder.id} успешно отправлено`);
      } else {
        console.error(`[Scheduler] Ошибка отправки напоминания #${reminder.id}:`, res.reason);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Ошибка в работе планировщика:', err);
  }
}
