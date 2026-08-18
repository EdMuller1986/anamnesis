// Changelog renderer for Cloudflare Workers (D1)
// Transforms audit_log rows into human-readable entries for the frontend HistoryModal.

function safeParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function formatDate(ymd) {
  if (!ymd) return '';
  const months = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd));
  if (!m) return String(ymd);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  return `${day} ${months[month] || ''} ${year}`;
}

/** YYYY-MM-DD from created_at (supports " " or "T" separators). */
function dateKey(at) {
  if (!at) return 'unknown';
  const s = String(at);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s.slice(0, 10);
}

function actionVerb(action, insertWord, updateWord, deleteWord) {
  if (action === 'insert') return insertWord;
  if (action === 'delete') return deleteWord;
  return updateWord;
}

function actionColor(action) {
  if (action === 'insert') return 'green';
  if (action === 'delete') return 'red';
  return 'blue';
}

// ─── Rendering Logic ───────────────────────────────────────
// entity_type must match audit_log.entity_type from SQL triggers (0011).
// ref_kind must match HistoryModal switch cases.

const renderers = {
  timeline: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Визит';
    const eventDate = nv?.event_date || ov?.event_date;
    const specName = nv?.specialist_name || ov?.specialist_name;
    return {
      icon: 'IconStethoscope',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлен', 'Обновлён', 'Удалён')} визит «${title}»`,
      subtitle: [specName, eventDate && formatDate(eventDate)].filter(Boolean).join(' • ') || null,
      ref_kind: row.action === 'delete' ? null : 'timeline',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  document: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Документ';
    return {
      icon: 'IconFileText',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлен', 'Обновлён', 'Удалён')} документ «${title}»`,
      subtitle: null,
      ref_kind: row.action === 'delete' ? null : 'document',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  diagnosis: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.name || ov?.name || 'Диагноз';
    return {
      icon: 'IconClipboardList',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Новый', 'Обновлён', 'Удалён')} диагноз «${name}»`,
      subtitle: nv?.status || ov?.status || null,
      ref_kind: row.action === 'delete' ? null : 'diagnoses',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  medication: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.name || ov?.name || 'Препарат';
    return {
      icon: 'IconPill',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Новый', 'Обновлён', 'Удалён')} препарат «${name}»`,
      subtitle: nv?.status || ov?.status || null,
      ref_kind: row.action === 'delete' ? null : 'medication',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  prescription: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const medId = nv?.medication_id || ov?.medication_id;
    return {
      icon: 'IconPillFilled',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлено', 'Обновлено', 'Удалено')} назначение` + (medId ? ` (мед. #${medId})` : ''),
      subtitle: nv?.course_status || ov?.course_status || nv?.dosage || ov?.dosage || null,
      ref_kind: row.action === 'delete' ? null : 'medication',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  plan: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Пункт плана';
    return {
      icon: 'IconListCheck',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлен', 'Обновлён', 'Удалён')} план: «${title}»`,
      subtitle: nv?.status || ov?.status || null,
      ref_kind: row.action === 'delete' ? null : 'plan',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  error: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Замечание';
    return {
      icon: 'IconAlertTriangle',
      color: row.action === 'delete' ? 'red' : (nv?.severity === 'critical' || ov?.severity === 'critical' ? 'orange' : actionColor(row.action)),
      title: `${actionVerb(row.action, 'Новое', 'Обновлено', 'Удалено')} мед. замечание: «${title}»`,
      subtitle: nv?.status || ov?.status || null,
      ref_kind: row.action === 'delete' ? null : 'error',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  lab_result: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const param = nv?.parameter || ov?.parameter || nv?.test_name || ov?.test_name || 'Анализ';
    return {
      icon: 'IconFlask',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлен', 'Обновлён', 'Удалён')} анализ «${param}»`,
      subtitle: [nv?.value ?? ov?.value, nv?.unit || ov?.unit, nv?.status || ov?.status].filter((x) => x != null && x !== '').join(' ') || null,
      ref_kind: row.action === 'delete' ? null : 'lab',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  specialist: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.full_name || ov?.full_name || 'Специалист';
    return {
      icon: 'IconUserHeart',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлен', 'Обновлён', 'Удалён')} специалист: ${name}`,
      subtitle: nv?.specialization || ov?.specialization || null,
      // HistoryModal expects plural "specialists"
      ref_kind: row.action === 'delete' ? null : 'specialists',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  comment: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const text = nv?.text || ov?.text || '';
    const entity = nv?.entity_type || ov?.entity_type;
    const entityId = nv?.entity_id || ov?.entity_id;
    return {
      icon: 'IconMessage',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлен', 'Изменён', 'Удалён')} комментарий`,
      subtitle: [entity && entityId != null ? `${entity} #${entityId}` : null, text].filter(Boolean).join(' — ') || null,
      ref_kind: null,
      ref_id: null,
    };
  },

  vaccination: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.name || ov?.name || nv?.vaccine_name || ov?.vaccine_name || 'Прививка';
    return {
      icon: 'IconVaccine',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлена', 'Обновлена', 'Удалена')} прививка «${name}»`,
      subtitle: nv?.status || ov?.status || null,
      ref_kind: row.action === 'delete' ? null : 'vaccinations',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  growth: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const when = nv?.measured_at || ov?.measured_at;
    const h = nv?.height_cm ?? ov?.height_cm;
    const w = nv?.weight_kg ?? ov?.weight_kg;
    return {
      icon: 'IconRuler2',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлено', 'Обновлено', 'Удалено')} измерение роста/веса`,
      subtitle: [when && formatDate(when), h != null ? `${h} см` : null, w != null ? `${w} кг` : null].filter(Boolean).join(' • ') || null,
      ref_kind: row.action === 'delete' ? null : 'growth',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },

  reminder: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Напоминание';
    return {
      icon: 'IconBell',
      color: actionColor(row.action),
      title: `${actionVerb(row.action, 'Добавлено', 'Обновлено', 'Удалено')} напоминание «${title}»`,
      subtitle: nv?.remind_at || ov?.remind_at || nv?.status || ov?.status || null,
      ref_kind: row.action === 'delete' ? null : 'reminders',
      ref_id: row.action === 'delete' ? null : row.entity_id,
    };
  },
};

/**
 * Рендерит список строк audit_log в формат для HistoryModal.
 * @param {Array} rows
 * @param {{ limit?: number, offset?: number }} [opts] — for has_more
 */
export async function renderHistory(rows, opts = {}) {
  const limit = opts.limit;
  const entries = (rows || []).map((row) => {
    const renderer = renderers[row.entity_type];
    if (!renderer) {
      // Unknown type — still show something so audit isn't silent
      return {
        id: row.id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        action: row.action,
        at: row.created_at,
        grouped_ids: [row.id],
        icon: 'IconHistory',
        color: actionColor(row.action),
        title: `${row.action} ${row.entity_type} #${row.entity_id}`,
        subtitle: null,
        ref_kind: null,
        ref_id: null,
      };
    }

    const rendered = renderer(row);
    return {
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      action: row.action,
      at: row.created_at,
      grouped_ids: [row.id],
      ...rendered,
    };
  });

  const groups = [];
  for (const entry of entries) {
    const date = dateKey(entry.at);
    let group = groups.find((g) => g.date === date);
    if (!group) {
      group = {
        date,
        label: getFriendlyDateLabel(date),
        entries: [],
      };
      groups.push(group);
    }
    group.entries.push(entry);
  }

  return {
    groups,
    total: entries.length,
    has_more: typeof limit === 'number' ? (rows || []).length >= limit : false,
  };
}

function getFriendlyDateLabel(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (dateStr === today) return 'Сегодня';
  if (dateStr === yesterday) return 'Вчера';

  return formatDate(dateStr);
}

/** Exported for tests */
export const _changelogTest = { renderers, dateKey, actionColor };
