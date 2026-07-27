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
      // 2. Отправляем уведомление в Telegram
      const text = `🔔 <b>Напоминание</b>\n\n${reminder.title}`;
      
      // Мы предполагаем, что бот настроен на владельца. 
      // В будущем можно добавить поиск TELEGRAM_CHAT_ID для конкретного patient_id в таблице настроек.
      const res = await telegram.sendMessage(env, text);

      if (res.ok) {
        // 3. Помечаем как выполненное
        await db.prepare(
          "UPDATE reminders SET status = 'done' WHERE id = ?"
        ).bind(reminder.id).run();
        
        console.log(`[Scheduler] Напоминание #${reminder.id} успешно отправлено`);
      } else {
        console.error(`[Scheduler] Ошибка отправки напоминания #${reminder.id}:`, res.reason);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Ошибка в работе планировщика:', err);
  }
}
