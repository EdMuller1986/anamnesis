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
    return {
      icon: 'IconStethoscope',
      color: 'blue',
      title: `Обновлён визит «${title}»`,
      subtitle: [specName, eventDate && formatDate(eventDate)].filter(Boolean).join(' • '),
      ref_kind: 'timeline',
      ref_id: row.entity_id,
    };
  },

  document: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Документ';
    return {
      icon: 'IconFileText',
      color: row.action === 'insert' ? 'green' : 'blue',
      title: `${row.action === 'insert' ? 'Добавлен' : 'Обновлён'} документ «${title}»`,
      ref_kind: 'document',
      ref_id: row.entity_id,
    };
  },

  diagnosis: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.name || ov?.name || 'Диагноз';
    return {
      icon: 'IconClipboardList',
      color: row.action === 'insert' ? 'green' : 'blue',
      title: `${row.action === 'insert' ? 'Новый' : 'Обновлён'} диагноз «${name}»`,
      ref_kind: 'diagnoses',
      ref_id: row.entity_id,
    };
  },

  medication: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.name || ov?.name || 'Препарат';
    return {
      icon: 'IconPill',
      color: row.action === 'insert' ? 'green' : 'blue',
      title: `${row.action === 'insert' ? 'Новый' : 'Обновлён'} препарат «${name}»`,
      ref_kind: 'medication',
      ref_id: row.entity_id,
    };
  },

  plan: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const title = nv?.title || ov?.title || 'Пункт плана';
    return {
      icon: 'IconListCheck',
      color: row.action === 'insert' ? 'green' : 'blue',
      title: `${row.action === 'insert' ? 'Добавлен план' : 'Обновлён план'}: «${title}»`,
      ref_kind: 'plan',
      ref_id: row.entity_id,
    };
  },

  specialist: (row) => {
    const nv = safeParseJson(row.new_value);
    const ov = safeParseJson(row.old_value);
    const name = nv?.full_name || ov?.full_name || 'Специалист';
    return {
      icon: 'IconUserHeart',
      color: row.action === 'insert' ? 'green' : 'blue',
      title: `${row.action === 'insert' ? 'Добавлен' : 'Обновлён'} специалист: ${name}`,
      ref_kind: 'specialist',
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

  // Группировка по датам (как ждет HistoryModal)
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
