import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconSearch, IconChevronRight } from '@tabler/icons-react';
import { Modal, Input, EmptyState, Spinner } from '@/shared/ui';
import { qk } from '@/shared/api/keys';
import { search } from '../api';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { haptic } from '@/shared/lib/haptic';
import { useNavigate } from 'react-router';
import type { SearchHit } from '../api';

const ENTITY_ROUTES: Record<string, (id: number) => string> = {
  diagnosis: (id) => `/diagnoses/${id}`,
  medication: () => `/more/medications`,
  plan: (id) => `/plan/${id}`,
  error: (id) => `/errors/${id}`,
  timeline: (id) => `/documents/visit/${id}`,
  visit: (id) => `/documents/visit/${id}`,
  specialist: () => `/more/specialists`,
  document: (id) => `/documents/doc/${id}`,
  vaccination: () => `/more/vaccinations`,
  reminder: () => `/more/reminders`,
  lab_result: () => `/more/labs`,
  growth: () => `/more/growth`,
};

const ENTITY_LABELS: Record<string, string> = {
  diagnosis: 'Диагноз',
  medication: 'Препарат',
  plan: 'План',
  error: 'Ошибка',
  timeline: 'Визит',
  visit: 'Визит',
  specialist: 'Специалист',
  document: 'Документ',
  vaccination: 'Прививка',
  reminder: 'Напоминание',
  lab_result: 'Анализ',
  growth: 'Рост/вес',
};

export default function SearchModal() {
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 300);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: qk.search(debounced),
    queryFn: () => search(debounced),
    enabled: debounced.length >= 2,
  });

  const handleClick = (hit: SearchHit) => {
    const route = ENTITY_ROUTES[hit._type]?.(hit.id);
    if (route) {
      haptic('light');
      navigate(route);
    }
  };

  return (
    <Modal title="Поиск" desktopStyle="page">
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <IconSearch
          size={18}
          style={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-secondary)',
            pointerEvents: 'none',
          }}
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Начните вводить..."
          autoFocus
          style={{ paddingLeft: 42 }}
        />
      </div>

      {debounced.length < 2 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: 20 }}>
          Введите минимум 2 символа для поиска
        </p>
      )}

      {debounced.length >= 2 && isLoading && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spinner size={20} />
        </div>
      )}

      {debounced.length >= 2 && !isLoading && (data ?? []).length === 0 && (
        <EmptyState icon={<IconSearch size={48} color="var(--text-secondary)" />} text="Ничего не найдено" />
      )}

      {(data ?? []).map((hit) => {
        const displayName = hit.name ?? hit.title ?? '(без названия)';
        return (
          <div
            key={`${hit._type}-${hit.id}`}
            className="card"
            style={{
              cursor: 'pointer',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
            onClick={() => handleClick(hit)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                }}
              >
                {ENTITY_LABELS[hit._type] ?? hit._type}
                {hit.status && ` · ${hit.status}`}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                {displayName}
              </div>
              {hit.description && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {hit.description}
                </div>
              )}
            </div>
            <IconChevronRight size={16} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
          </div>
        );
      })}
    </Modal>
  );
}
