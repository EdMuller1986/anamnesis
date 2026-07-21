// Changelog renderer for Cloudflare Workers (D1)
// Transforms audit_log rows into human-readable entries for the frontend.

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

function diffKeys(oldObj, newObj) {
  const oldo = oldObj || {};
  const newo = newObj || {};
  const keys = new Set([...Object.keys(oldo), ...Object.keys(newo)]);
  const changed = [];
  for (const k of keys) {
    const a = oldo[k];
    const b = newo[k];
    if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) changed.push(k);
  }
  return changed;
}

// ─── Rendering Logic ───────────────────────────────────────

const renderers = {
  timeline: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Визит';
    const eventDate = nv?.event_date || ov?.event_date;
    const specName = nv?.specialist_name || ov?.specialist_name;

    if (row.action === 'insert') {
      return {
        icon: 'IconStethoscope',
        color: 'green',
        title: `Добавлен визит «${title}»`,
        subtitle: [specName, eventDate && formatDate(eventDate)].filter(Boolean).join(' • '),
        ref_kind: 'timeline',
        ref_id: row.entity_id,
      };
    }
    if (row.action === 'delete') {
      return {
        icon: 'IconStethoscope',
        color: 'red',
        title: `Удалён визит «${title}»`,
        subtitle: eventDate && formatDate(eventDate),
        ref_kind: null,
        ref_id: null,
      };
    }
    const changed = diffKeys(ov, nv);
    return {
      icon: changed.includes('ai_assessment') ? 'IconBrain' : 'IconStethoscope',
      color: changed.includes('ai_assessment') ? 'purple' : 'blue',
      title: `${changed.includes('ai_assessment') ? 'AI-оценка' : 'Обновлён'} визит «${title}»`,
      subtitle: [specName, eventDate && formatDate(eventDate)].filter(Boolean).join(' • '),
      ref_kind: 'timeline',
      ref_id: row.entity_id,
    };
  },

  document: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Документ';
    const timelineId = nv?.timeline_id || ov?.timeline_id;

    if (row.action === 'insert') {
      return {
        icon: 'IconFileText',
        color: 'green',
        title: `Добавлен документ «${title}»`,
        subtitle: nv?.category,
        ref_kind: timelineId ? 'timeline' : 'document',
        ref_id: timelineId || row.entity_id,
      };
    }
    if (row.action === 'delete') {
      return {
        icon: 'IconFileText',
        color: 'red',
        title: `Удалён документ «${title}»`,
        ref_kind: null,
      };
    }
    return {
      icon: 'IconFileText',
      color: 'blue',
      title: `Обновлён документ «${title}»`,
      ref_kind: 'timeline',
      ref_id: timelineId || row.entity_id,
    };
  },

  diagnosis: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.name || ov?.name || 'Диагноз';

    if (row.action === 'insert') {
      return {
        icon: 'IconClipboardList',
        color: 'green',
        title: `Новый диагноз «${name}»`,
        subtitle: nv?.icd_code ? `Код: ${nv.icd_code}` : '',
        ref_kind: 'diagnoses',
        ref_id: row.entity_id,
      };
    }
    const changed = diffKeys(ov, nv);
    return {
      icon: 'IconClipboardList',
      color: 'blue',
      title: `Обновлён диагноз «${name}»`,
      ref_kind: 'diagnoses',
      ref_id: row.entity_id,
    };
  },

  medication: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.name || ov?.name || 'Препарат';

    if (row.action === 'insert') {
      return {
        icon: 'IconPill',
        color: 'green',
        title: `Новый препарат «${name}»`,
        ref_kind: 'medication',
        ref_id: row.entity_id,
      };
    }
    return {
      icon: 'IconPill',
      color: 'blue',
      title: `Обновлён препарат «${name}»`,
      ref_kind: 'medication',
      ref_id: row.entity_id,
    };
  },

  plan: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Пункт плана';

    if (row.action === 'insert') {
      return {
        icon: 'IconListCheck',
        color: 'green',
        title: `План: «${title}»`,
        ref_kind: 'plan',
        ref_id: row.entity_id,
      };
    }
    if (nv?.status === 'done' && ov?.status !== 'done') {
      return {
        icon: 'IconCheck',
        color: 'green',
        title: `Выполнено: «${title}»`,
        ref_kind: 'plan',
        ref_id: row.entity_id,
      };
    }
    return {
      icon: 'IconListCheck',
      color: 'blue',
      title: `Обновлён план: «${title}»`,
      ref_kind: 'plan',
      ref_id: row.entity_id,
    };
  },

  lab_result: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const parameter = nv?.parameter || ov?.parameter || 'Анализ';
    const value = nv?.value ?? ov?.value;

    if (row.action === 'insert') {
      return {
        icon: 'IconFlask',
        color: 'green',
        title: `Анализ: ${parameter} ${value ?? ''}`,
        ref_kind: 'lab',
        ref_id: row.entity_id,
      };
    }
    return {
      icon: 'IconFlask',
      color: 'blue',
      title: `Обновлён анализ: ${parameter}`,
      ref_kind: 'lab',
      ref_id: row.entity_id,
    };
  }
};

/**
 * Рендерит список строк audit_log в формат для HistoryModal.
 */
export async function renderHistory(rows) {
  const entries = rows.map(row => {
    const renderer = renderers[row.entity_type];
    if (!renderer) return null;

    const rendered = renderer(row);
    return {
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      action: row.action,
      at: row.created_at,
      grouped_ids: [row.id],
      ...rendered
    };
  }).filter(Boolean);

  // Группировка по датам
  const groups = [];
  entries.forEach(entry => {
    const date = entry.at.split(' ')[0];
    let group = groups.find(g => g.date === date);
    if (!group) {
      group = {
        date,
        label: getFriendlyDateLabel(date),
        entries: []
      };
      groups.push(group);
    }
    group.entries.push(entry);
  });

  return {
    groups,
    total: entries.length,
    has_more: false
  };
}

function getFriendlyDateLabel(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  if (dateStr === today) return 'Сегодня';
  if (dateStr === yesterday) return 'Вчера';
  
  return formatDate(dateStr);
}
