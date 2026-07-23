import { Hono } from 'hono';

const exportRoute = new Hono();

function esc(text) {
  if (!text && text !== 0) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Translation maps
const diagnosisStatus = { active: 'Активный', resolved: 'Разрешён', monitoring: 'Наблюдение', inactive: 'Неактивный' };
const medStatus = { active: 'Принимает', completed: 'Завершён', cancelled: 'Отменён', paused: 'Приостановлен' };
const planStatus = { pending: 'Ожидает', in_progress: 'В работе', done: 'Выполнено', cancelled: 'Отменено' };
const planPriority = { urgent: 'Срочно', high: 'Высокий', medium: 'Средний', low: 'Низкий' };
const errorSeverity = { critical: 'Критично', warning: 'Внимание', info: 'Информация' };
const errorStatus = { open: 'Открыто', in_progress: 'В работе', resolved: 'Решено', monitoring: 'Мониторинг' };
const vacStatus = { scheduled: 'Запланирована', done: 'Выполнена', skipped: 'Пропущена', postponed: 'Отложена' };
const labStatus = { normal: 'Норма', low: 'Ниже нормы', high: 'Выше нормы', critical: 'Критично' };
const timelineCategory = {
  visit: 'Приём врача', test: 'Обследование', diagnosis: 'Диагностика', milestone: 'Веха развития',
  procedure: 'Процедура', hospitalization: 'Госпитализация', vaccination: 'Вакцинация', other: 'Другое'
};

function tr(map, val) {
  if (!val) return '';
  return map[val] || val;
}

function calcAge(dob) {
  if (!dob) return '';
  const birth = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (months < 0) { years--; months += 12; }
  if (now.getDate() < birth.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  const yWord = years === 1 ? 'год' : (years < 5 ? 'года' : 'лет');
  const mWord = months === 1 ? 'месяц' : (months < 5 ? 'месяца' : 'месяцев');
  return `${years} ${yWord} ${months} ${mWord}`;
}

// GET /api/export/pdf
exportRoute.get('/pdf', async (c) => {
  const pid = parseInt(c.req.query('patient_id') || '1', 10);
  const db = c.env.DB;

  try {
    const [
      patient, diagnoses, medications, timeline, plan, 
      errors, specialists, vaccinations, growth, labResults
    ] = await Promise.all([
      db.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).first(),
      db.prepare('SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY status ASC, created_at DESC').bind(pid).all(),
      db.prepare('SELECT * FROM medications WHERE patient_id = ? ORDER BY status ASC, created_at DESC').bind(pid).all(),
      db.prepare('SELECT * FROM timeline WHERE patient_id = ? ORDER BY event_date DESC').bind(pid).all(),
      db.prepare("SELECT * FROM plan WHERE patient_id = ? ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, id ASC").bind(pid).all(),
      db.prepare("SELECT * FROM medical_errors WHERE patient_id = ? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC").bind(pid).all(),
      db.prepare('SELECT * FROM specialists WHERE patient_id = ? ORDER BY specialization ASC').bind(pid).all(),
      db.prepare('SELECT * FROM vaccinations WHERE patient_id = ? ORDER BY scheduled_date ASC').bind(pid).all(),
      db.prepare('SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC').bind(pid).all(),
      db.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_date DESC').bind(pid).all()
    ]);

    if (!patient) return c.text('Patient not found', 404);

    const age = calcAge(patient.date_of_birth);
    const reportDate = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    let html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Медицинский отчёт: ${esc(patient.full_name)}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.4; color: #333; max-width: 900px; margin: 0 auto; padding: 40px; }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-bottom: 5px; }
        h2 { color: #2980b9; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 30px; }
        .patient-info { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; flex-wrap: wrap; }
        .patient-info div { margin-right: 30px; margin-bottom: 10px; }
        .label { font-weight: bold; color: #7f8c8d; font-size: 0.9em; text-transform: uppercase; display: block; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { text-align: left; background: #f2f2f2; padding: 10px; border-bottom: 2px solid #ddd; }
        td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: top; }
        .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; }
        .status-active { background: #e8f5e9; color: #2e7d32; }
        .status-urgent { background: #ffebee; color: #c62828; }
        .footer { margin-top: 50px; text-align: center; color: #95a5a6; font-size: 0.8em; border-top: 1px solid #eee; padding-top: 20px; }
    </style>
</head>
<body>
    <h1>Медицинский отчёт</h1>
    <div class="patient-info">
        <div><span class="label">Пациент</span><strong>${esc(patient.full_name)}</strong></div>
        <div><span class="label">Дата рождения</span>${formatDate(patient.date_of_birth)} (${age})</div>
        <div><span class="label">Пол</span>${esc(patient.gender)}</div>
        <div><span class="label">Город</span>${esc(patient.city)}</div>
        <div><span class="label">Вес/Рост</span>${patient.current_weight_kg || '—'} кг / ${patient.current_height_cm || '—'} см</div>
        <div><span class="label">Аллергии</span>${esc(patient.allergies) || 'Не указаны'}</div>
    </div>
    
    <p style="text-align: right; color: #7f8c8d;">Дата формирования: ${reportDate}</p>

    <h2>Активные диагнозы</h2>
    <table>
        <tr><th>Диагноз</th><th>МКБ</th><th>Статус</th><th>Описание</th></tr>
        ${diagnoses.results.filter(d => d.status === 'active').map(d => `
            <tr>
                <td><strong>${esc(d.name)}</strong></td>
                <td><code>${esc(d.icd_code)}</code></td>
                <td><span class="status-badge status-active">${tr(diagnosisStatus, d.status)}</span></td>
                <td>${esc(d.detail)}</td>
            </tr>
        `).join('')}
    </table>

    <h2>Текущие назначения</h2>
    <table>
        <tr><th>Препарат</th><th>Дозировка</th><th>Схема</th><th>Статус</th></tr>
        ${medications.results.filter(m => m.status === 'active').map(m => `
            <tr>
                <td><strong>${esc(m.name)}</strong></td>
                <td>${esc(m.dosage)}</td>
                <td>${esc(m.frequency)}</td>
                <td><span class="status-badge status-active">${tr(medStatus, m.status)}</span></td>
            </tr>
        `).join('')}
    </table>

    <h2>История событий (последние 20)</h2>
    <table>
        <tr><th>Дата</th><th>Событие</th><th>Специалист</th><th>Описание</th></tr>
        ${timeline.results.slice(0, 20).map(t => `
            <tr>
                <td style="white-space: nowrap;">${formatDate(t.event_date)}</td>
                <td><strong>${esc(t.title)}</strong><br><small>${tr(timelineCategory, t.category)}</small></td>
                <td>${esc(t.specialist_name)}</td>
                <td>${esc(t.description)}</td>
            </tr>
        `).join('')}
    </table>

    <div class="footer">
        Сгенерировано системой Anamnesis Serverless. Не является медицинским заключением.
    </div>
</body>
</html>`;

    return c.html(html);
  } catch (err) {
    console.error('Export error:', err);
    return c.json({ error: 'Export failed: ' + err.message }, 500);
  }
});

export default exportRoute;
