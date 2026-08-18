import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  IconHistory,
  IconStethoscope,
  IconFileText,
  IconClipboardList,
  IconPill,
  IconPillFilled,
  IconListCheck,
  IconAlertTriangle,
  IconFlask,
  IconUserHeart,
  IconMessage,
  IconVaccine,
  IconRuler2,
  IconBell,
  IconBrain,
  IconCheck,
  IconArrowsExchange,
} from '@tabler/icons-react';
import { Modal, EmptyState, SkeletonList } from '@/shared/ui';
import { api } from '@/shared/api/client';
import { EP } from '@/shared/api/endpoints';
import { haptic } from '@/shared/lib/haptic';

/**
 * Автоматическая история изменений per-patient.
 *
 * Читает из /api/history который агрегирует audit_log через changelog.js
 * renderer. Каждая запись имеет icon (имя Tabler-иконки) + color + title +
 * опциональный subtitle. При тапе на карточку — drill-down в сущность.
 *
 * Группировка:
 *   1. Близкие по времени правки одной сущности → одна строка (backend)
 *   2. По датам → блоки (Сегодня / Вчера / N дн назад / дата)
 *
 * Без эмоджи: везде Tabler icons + семантические цвета через var(--*).
 */

interface HistoryEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  action: 'insert' | 'update' | 'delete';
  icon: string;
  color: 'green' | 'blue' | 'red' | 'orange' | 'purple' | 'gray';
  title: string;
  subtitle: string | null;
  at: string;
  ref_kind: string | null;
  ref_id: number | null;
  grouped_ids: number[];
}

interface HistoryGroup {
  date: string;
  label: string;
  entries: HistoryEntry[];
}

interface HistoryResponse {
  groups: HistoryGroup[];
  total: number;
  has_more: boolean;
}

// Мапа имён иконок из бэкенда → React-компоненты
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>> = {
  IconStethoscope,
  IconFileText,
  IconClipboardList,
  IconPill,
  IconPillFilled,
  IconListCheck,
  IconAlertTriangle,
  IconFlask,
  IconUserHeart,
  IconMessage,
  IconVaccine,
  IconRuler2,
  IconBell,
  IconBrain,
  IconCheck,
  IconArrowsExchange,
  IconHistory,
};

const COLOR_MAP: Record<HistoryEntry['color'], { fg: string; bg: string }> = {
  green: { fg: '#fff', bg: 'var(--green)' },
  blue: { fg: '#fff', bg: 'var(--blue)' },
  red: { fg: '#fff', bg: 'var(--red)' },
  orange: { fg: '#fff', bg: 'var(--orange)' },
  purple: { fg: '#fff', bg: 'var(--purple)' },
  gray: { fg: 'var(--text)', bg: 'var(--border)' },
};

function formatTime(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('T') ? '' : 'Z'));
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function HistoryModal() {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(100);

  const { data, isLoading } = useQuery({
    queryKey: ['history', limit],
    queryFn: () => api.get<HistoryResponse>(`${EP.history}?limit=${limit}`),
    retry: false,
  });

  const handleClick = (entry: HistoryEntry) => {
    if (!entry.ref_kind || !entry.ref_id) return;
    haptic('light');
    const { ref_kind, ref_id } = entry;
    switch (ref_kind) {
      case 'timeline':
        navigate(`/documents/visit/${ref_id}`);
        break;
      case 'document':
        navigate(`/documents/doc/${ref_id}`);
        break;
      case 'plan':
        navigate(`/plan/${ref_id}`);
        break;
      case 'error':
        navigate(`/errors/${ref_id}`);
        break;
      case 'diagnoses':
        navigate(`/diagnoses/${ref_id}`);
        break;
      case 'medication':
        navigate('/more/medications');
        break;
      case 'specialist':
      case 'specialists':
        navigate('/more/specialists');
        break;
      case 'lab':
      case 'lab_result':
        navigate('/more/labs');
        break;
      case 'vaccination':
      case 'vaccinations':
        navigate('/more/vaccinations');
        break;
      case 'growth':
        navigate('/more/growth');
        break;
      case 'reminder':
      case 'reminders':
        navigate('/more/reminders');
        break;
      case 'ai-chat':
        navigate('/more/ai-chat');
        break;
      default:
        break;
    }
  };

  const groups = data?.groups ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.has_more ?? false;

  return (
    <Modal title="История изменений" desktopStyle="page">
      <div style={{ padding: '0 16px', paddingBottom: 40 }}>
        {isLoading && <SkeletonList count={4} height={72} />}

        {!isLoading && groups.length === 0 && (
          <EmptyState
            icon={<IconHistory size={48} color="var(--text-secondary)" />}
            text="Пока нет изменений по этому пациенту"
          />
        )}

        {!isLoading && groups.length > 0 && (
          <>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                marginBottom: 12,
              }}
            >
              Всего изменений: {total}
            </div>

            {groups.map((group) => (
              <div key={group.date} style={{ marginBottom: 20 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    padding: '8px 4px',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--bg)',
                    zIndex: 1,
                  }}
                >
                  {group.label}
                </div>

                <div className="list-group">
                  {group.entries.map((entry, idx) => {
                    const Icon = ICON_MAP[entry.icon] || IconHistory;
                    const colors = COLOR_MAP[entry.color] || COLOR_MAP.gray;
                    const clickable = entry.ref_kind !== null && entry.ref_id !== null;

                    return (
                      <div
                        key={entry.id}
                        onClick={() => clickable && handleClick(entry)}
                        style={{
                          background: 'var(--card)',
                          padding: '14px 16px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12,
                          cursor: clickable ? 'pointer' : 'default',
                          borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                          transition: 'background 0.1s',
                        }}
                        onMouseDown={(e) => {
                          if (clickable) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)';
                        }}
                        onMouseUp={(e) => {
                          (e.currentTarget as HTMLDivElement).style.background = 'var(--card)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLDivElement).style.background = 'var(--card)';
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: colors.bg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={20} color={colors.fg} />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: 'var(--text)',
                              lineHeight: 1.3,
                              wordBreak: 'break-word',
                            }}
                          >
                            {entry.title}
                          </div>
                          {entry.subtitle && (
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                                marginTop: 3,
                                lineHeight: 1.3,
                                wordBreak: 'break-word',
                              }}
                            >
                              {entry.subtitle}
                            </div>
                          )}
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--text-secondary)',
                              marginTop: 4,
                            }}
                          >
                            {formatTime(entry.at)}
                            {entry.grouped_ids && entry.grouped_ids.length > 1 && (
                              <span style={{ marginLeft: 6 }}>
                                • объединено {entry.grouped_ids.length} правок
                              </span>
                            )}
                          </div>
                        </div>

                        {clickable && (
                          <div style={{ fontSize: 18, color: 'var(--text-secondary)' }}>›</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                type="button"
                onClick={() => setLimit(limit + 100)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '12px 16px',
                  marginTop: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  background: 'var(--card)',
                  color: 'var(--text)',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Показать ещё
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
