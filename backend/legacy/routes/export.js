const { Router } = require('express');
const pool = require('../db');
const { rawDb } = require('../db');

const router = Router();

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
const reminderStatus = { pending: 'Ожидает', sent: 'Отправлено' };

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
router.get('/pdf', async (req, res) => {
  try {
    const pid = req.patientId;
    // Fetch all data
    const [patientRes, diagnosesRes, medicationsRes, timelineRes, planRes, errorsRes, specialistsRes, remindersRes] = await Promise.all([
      pool.query('SELECT * FROM patient WHERE id = $1', [pid]),
      pool.query('SELECT * FROM diagnoses WHERE patient_id = $1 ORDER BY status ASC, created_at DESC', [pid]),
      pool.query('SELECT * FROM medications WHERE patient_id = $1 ORDER BY status ASC, created_at DESC', [pid]),
      pool.query('SELECT * FROM timeline WHERE patient_id = $1 ORDER BY event_date DESC', [pid]),
      pool.query('SELECT * FROM plan WHERE patient_id = $1 ORDER BY CASE priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END, sort_order ASC', [pid]),
      pool.query('SELECT * FROM medical_errors WHERE patient_id = $1 ORDER BY CASE severity WHEN \'critical\' THEN 1 WHEN \'warning\' THEN 2 ELSE 3 END, created_at DESC', [pid]),
      pool.query('SELECT * FROM specialists WHERE patient_id = $1 ORDER BY specialization ASC', [pid]),
      pool.query('SELECT * FROM reminders WHERE patient_id = $1 ORDER BY remind_at ASC', [pid]),
    ]);

    const patient = patientRes.rows[0] || {};
    const diagnoses = diagnosesRes.rows;
    const medications = medicationsRes.rows;
    const timeline = timelineRes.rows;
    const plan = planRes.rows;
    const errors = errorsRes.rows;
    const specialists = specialistsRes.rows;
    const reminders = remindersRes.rows;

    let vaccinations = [];
    let growth = [];
    let labResults = [];
    let comments = [];
    try { vaccinations = rawDb.prepare('SELECT * FROM vaccinations WHERE patient_id = ? ORDER BY scheduled_date ASC').all(pid); } catch {}
    try { growth = rawDb.prepare('SELECT * FROM growth_log WHERE patient_id = ? ORDER BY measured_at DESC').all(pid); } catch {}
    try { labResults = rawDb.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_date DESC').all(pid); } catch {}
    try { comments = rawDb.prepare('SELECT * FROM comments WHERE patient_id = ? ORDER BY created_at DESC').all(pid); } catch {}

    const age = calcAge(patient.date_of_birth);
    const reportDate = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Медицинский отчёт — ${esc(patient.full_name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1a1a1a; font-size: 13px; line-height: 1.5; }
  h1 { color: #1a1a1a; border-bottom: 3px solid #007AFF; padding-bottom: 12px; font-size: 22px; margin-bottom: 8px; }
  h2 { color: #007AFF; margin-top: 28px; font-size: 16px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  h3 { color: #333; margin-top: 16px; font-size: 14px; }
  .report-meta { color: #666; font-size: 13px; margin-bottom: 20px; }
  .report-meta strong { color: #333; }
  .patient-block { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
  .patient-block .name { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
  .patient-block .info { font-size: 13px; color: #555; line-height: 1.8; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f4f8; font-weight: 600; color: #333; white-space: nowrap; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .b-red { background: #FFE5E5; color: #C00; }
  .b-orange { background: #FFF3E0; color: #E65100; }
  .b-green { background: #E8F5E9; color: #2E7D32; }
  .b-blue { background: #E3F2FD; color: #1565C0; }
  .b-gray { background: #F5F5F5; color: #666; }
  .b-purple { background: #F3E5F5; color: #7B1FA2; }
  .section-empty { color: #999; font-style: italic; padding: 8px 0; }
  .notes-block { background: #FFFDE7; border-left: 3px solid #FFC107; padding: 8px 12px; margin: 4px 0 8px; font-size: 12px; color: #555; white-space: pre-line; }
  .ai-block { background: #F3E5F5; border-left: 3px solid #9C27B0; padding: 8px 12px; margin: 4px 0 8px; font-size: 12px; color: #333; white-space: pre-line; }
  .error-card { border-left: 3px solid #C00; background: #FFF5F5; padding: 10px 14px; margin: 6px 0; border-radius: 4px; }
  .error-card.warning { border-left-color: #E65100; background: #FFF8F0; }
  .error-card.info { border-left-color: #1565C0; background: #F0F7FF; }
  .comment-item { background: #f0f4f8; padding: 6px 10px; margin: 3px 0; border-radius: 4px; font-size: 12px; }
  .comment-date { color: #999; font-size: 11px; }
  .print-break { page-break-before: always; }
  @media print {
    body { padding: 0; font-size: 11px; }
    h2 { font-size: 14px; }
    .print-break { page-break-before: always; }
  }
  .footer { margin-top: 40px; padding-top: 12px; border-top: 2px solid #e0e0e0; text-align: center; color: #999; font-size: 11px; }
</style></head>
<body>

<h1>Медицинский отчёт</h1>

<div class="patient-block">
  <div class="name">${esc(patient.full_name) || 'Пациент'}</div>
  <div class="info">
    ${patient.date_of_birth ? `<strong>Дата рождения:</strong> ${formatDate(patient.date_of_birth)}${age ? ` (${age})` : ''}<br>` : ''}
    ${patient.gender ? `<strong>Пол:</strong> ${esc(patient.gender)}<br>` : ''}
    ${patient.current_height_cm ? `<strong>Рост:</strong> ${esc(patient.current_height_cm)} см &nbsp; ` : ''}
    ${patient.current_weight_kg ? `<strong>Вес:</strong> ${esc(patient.current_weight_kg)} кг<br>` : ''}
    ${patient.blood_type ? `<strong>Группа крови:</strong> ${esc(patient.blood_type)}<br>` : ''}
    ${patient.allergies ? `<strong>Аллергии:</strong> ${esc(patient.allergies)}<br>` : ''}
    ${patient.notes ? `<strong>Примечания:</strong> ${esc(patient.notes)}` : ''}
  </div>
</div>

<p class="report-meta">Дата формирования отчёта: <strong>${reportDate}</strong></p>

<!-- ═══ ДИАГНОЗЫ ═══ -->
<h2>Диагнозы (${diagnoses.length})</h2>
${diagnoses.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Диагноз</th><th>Код МКБ</th><th>Статус</th><th>Дата постановки</th><th>Примечания</th></tr>
${diagnoses.map(d => {
  const st = tr(diagnosisStatus, d.status);
  const cls = d.status === 'active' ? 'b-red' : 'b-gray';
  return `<tr>
    <td><strong>${esc(d.name)}</strong>${d.detail ? `<div style="font-size:11px;color:#666;margin-top:2px">${esc(d.detail)}</div>` : ''}</td>
    <td>${esc(d.icd_code)}</td>
    <td><span class="badge ${cls}">${st}</span></td>
    <td>${formatDate(d.diagnosed_date)}</td>
    <td>${esc(d.notes)}</td>
  </tr>`;
}).join('\n')}
</table>`}

<!-- ═══ СПЕЦИАЛИСТЫ ═══ -->
<h2>Специалисты (${specialists.length})</h2>
${specialists.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Специализация</th><th>ФИО</th><th>Клиника</th><th>Телефон</th><th>Заметки</th></tr>
${specialists.map(s => `<tr>
  <td><strong>${esc(s.specialization)}</strong></td>
  <td>${esc(s.full_name)}</td>
  <td>${esc(s.clinic)}</td>
  <td>${esc(s.phone)}</td>
  <td>${esc(s.notes)}</td>
</tr>`).join('\n')}
</table>`}

<!-- ═══ ПРЕПАРАТЫ ═══ -->
<h2>Препараты (${medications.length})</h2>
${medications.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Название</th><th>Дозировка</th><th>Приём</th><th>Статус</th><th>Период</th><th>Назначил</th></tr>
${medications.map(m => {
  const st = tr(medStatus, m.status);
  const cls = m.status === 'active' ? 'b-green' : 'b-gray';
  const period = m.start_date ? `${formatDate(m.start_date)}${m.end_date ? ' — ' + formatDate(m.end_date) : ' — ...'}` : '';
  return `<tr>
    <td><strong>${esc(m.name)}</strong>${m.detail ? `<div style="font-size:11px;color:#666;margin-top:2px">${esc(m.detail)}</div>` : ''}</td>
    <td>${esc(m.dosage)}</td>
    <td>${esc(m.frequency)}</td>
    <td><span class="badge ${cls}">${st}</span></td>
    <td>${period}</td>
    <td>${esc(m.prescribed_by)}</td>
  </tr>`;
}).join('\n')}
</table>`}

<!-- ═══ ПРИВИВКИ ═══ -->
<h2>Прививки (${vaccinations.length})</h2>
${vaccinations.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Название</th><th>Вакцина</th><th>Доза</th><th>Статус</th><th>Запланировано</th><th>Выполнено</th><th>Реакция</th></tr>
${vaccinations.map(v => {
  const st = tr(vacStatus, v.status);
  const cls = v.status === 'done' ? 'b-green' : v.status === 'skipped' ? 'b-red' : v.status === 'postponed' ? 'b-gray' : 'b-orange';
  return `<tr>
    <td><strong>${esc(v.name)}</strong></td>
    <td>${esc(v.vaccine_name)}</td>
    <td>${v.dose_number || 1}</td>
    <td><span class="badge ${cls}">${st}</span></td>
    <td>${formatDate(v.scheduled_date)}</td>
    <td>${formatDate(v.actual_date)}</td>
    <td>${esc(v.reaction)}</td>
  </tr>`;
}).join('\n')}
</table>`}

<!-- ═══ РОСТ И ВЕС ═══ -->
<h2>Рост и вес (${growth.length})</h2>
${growth.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Дата</th><th>Рост (см)</th><th>Вес (кг)</th><th>Окружность головы (см)</th><th>Примечания</th></tr>
${growth.map(g => `<tr>
  <td>${formatDate(g.measured_at)}</td>
  <td>${g.height_cm || ''}</td>
  <td>${g.weight_kg || ''}</td>
  <td>${g.head_circumference_cm || ''}</td>
  <td>${esc(g.notes)}</td>
</tr>`).join('\n')}
</table>`}

<!-- ═══ РЕЗУЛЬТАТЫ АНАЛИЗОВ ═══ -->
<h2>Результаты анализов (${labResults.length})</h2>
${labResults.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Дата</th><th>Анализ</th><th>Показатель</th><th>Значение</th><th>Ед.</th><th>Референс</th><th>Статус</th></tr>
${labResults.map(l => {
  const st = tr(labStatus, l.status);
  const cls = l.status === 'critical' ? 'b-red' : l.status === 'high' || l.status === 'low' ? 'b-orange' : 'b-green';
  return `<tr>
    <td>${formatDate(l.test_date)}</td>
    <td>${esc(l.test_name)}</td>
    <td>${esc(l.parameter)}</td>
    <td><strong>${l.value != null ? esc(l.value) : ''}</strong></td>
    <td>${esc(l.unit)}</td>
    <td>${l.ref_min != null ? esc(l.ref_min) + '–' + esc(l.ref_max) : ''}</td>
    <td><span class="badge ${cls}">${st}</span></td>
  </tr>`;
}).join('\n')}
</table>`}

<div class="print-break"></div>

<!-- ═══ ХРОНОЛОГИЯ ПРИЁМОВ ═══ -->
<h2>Хронология (${timeline.length})</h2>
${timeline.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Дата</th><th>Тип</th><th>Событие</th><th>Специалист</th><th>Описание</th></tr>
${timeline.map(t => {
  const cat = tr(timelineCategory, t.category);
  return `<tr>
    <td style="white-space:nowrap">${formatDate(t.event_date)}</td>
    <td><span class="badge b-blue">${cat}</span></td>
    <td><strong>${esc(t.title)}</strong></td>
    <td>${t.specialist_name ? esc(t.specialist_name) + (t.specialist_type ? ` (${esc(t.specialist_type)})` : '') : ''}</td>
    <td>${esc(t.description)}</td>
  </tr>`;
}).join('\n')}
</table>`}

${timeline.filter(t => t.ai_assessment).length > 0 ? `
<h3>AI-оценки приёмов</h3>
${timeline.filter(t => t.ai_assessment).map(t => `
  <div style="margin-bottom:12px">
    <strong>${formatDate(t.event_date)} — ${esc(t.title)}</strong>
    <div class="ai-block">${esc(t.ai_assessment)}</div>
  </div>
`).join('')}
` : ''}

<!-- ═══ ВЫЯВЛЕННЫЕ ПРОБЛЕМЫ ═══ -->
<h2>Выявленные проблемы и ошибки (${errors.length})</h2>
${errors.length === 0 ? '<p class="section-empty">Нет данных</p>' : errors.map(e => {
  const sev = tr(errorSeverity, e.severity);
  const st = tr(errorStatus, e.status);
  const sevClass = e.severity === 'critical' ? '' : e.severity;
  return `<div class="error-card ${sevClass}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <strong>${esc(e.title)}</strong>
      <span><span class="badge ${e.severity === 'critical' ? 'b-red' : e.severity === 'warning' ? 'b-orange' : 'b-blue'}">${sev}</span>
      <span class="badge ${e.status === 'resolved' ? 'b-green' : e.status === 'open' ? 'b-red' : 'b-orange'}">${st}</span></span>
    </div>
    <div style="font-size:12px;color:#555">${esc(e.description)}</div>
    ${e.detail ? `<div style="font-size:11px;color:#777;margin-top:4px">${esc(e.detail)}</div>` : ''}
    ${e.advice ? `<div style="font-size:11px;color:#1565C0;margin-top:4px"><strong>Рекомендация:</strong> ${esc(e.advice)}</div>` : ''}
  </div>`;
}).join('\n')}

<!-- ═══ ПЛАН ЛЕЧЕНИЯ ═══ -->
<h2>План лечения (${plan.length})</h2>
${plan.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Задача</th><th>Приоритет</th><th>Статус</th><th>Срок</th><th>Описание</th></tr>
${plan.map(p => {
  const pri = tr(planPriority, p.priority);
  const st = tr(planStatus, p.status);
  const priCls = p.priority === 'urgent' ? 'b-red' : p.priority === 'high' ? 'b-orange' : 'b-blue';
  const stCls = p.status === 'done' ? 'b-green' : p.status === 'in_progress' ? 'b-blue' : 'b-gray';
  return `<tr>
    <td><strong>${esc(p.title)}</strong></td>
    <td><span class="badge ${priCls}">${pri}</span></td>
    <td><span class="badge ${stCls}">${st}</span></td>
    <td>${formatDate(p.due_date)}</td>
    <td>${esc(p.description)}${p.detail ? `<div style="font-size:11px;color:#666;margin-top:2px">${esc(p.detail)}</div>` : ''}${p.notes ? `<div style="font-size:11px;color:#888;margin-top:2px">${esc(p.notes)}</div>` : ''}</td>
  </tr>`;
}).join('\n')}
</table>`}

<!-- ═══ НАПОМИНАНИЯ ═══ -->
<h2>Напоминания (${reminders.length})</h2>
${reminders.length === 0 ? '<p class="section-empty">Нет данных</p>' : `
<table>
<tr><th>Название</th><th>Дата</th><th>Статус</th><th>Сообщение</th></tr>
${reminders.map(r => {
  const st = tr(reminderStatus, r.status);
  return `<tr>
    <td><strong>${esc(r.title)}</strong></td>
    <td>${formatDateTime(r.remind_at)}</td>
    <td><span class="badge ${r.status === 'sent' ? 'b-green' : 'b-orange'}">${st}</span></td>
    <td>${esc(r.message)}</td>
  </tr>`;
}).join('\n')}
</table>`}

<!-- ═══ КОММЕНТАРИИ ═══ -->
${comments.length > 0 ? `
<h2>Комментарии (${comments.length})</h2>
${comments.map(c => `<div class="comment-item">
  <span class="comment-date">${formatDateTime(c.created_at)}</span> [${esc(c.entity_type)} #${c.entity_id}]: ${esc(c.text)}
</div>`).join('\n')}
` : ''}

<div class="footer">
  Медицинский трекер здоровья — отчёт сформирован автоматически ${reportDate}
</div>

</body></html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Ошибка генерации отчёта:', err);
    res.status(500).json({ error: 'Ошибка генерации отчёта' });
  }
});

module.exports = router;
