import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router';
import {
  IconLayoutDashboard,
  IconListCheck,
  IconAlertTriangle,
  IconStethoscope,
  IconClipboardList,
  IconUserHeart,
  IconPill,
  IconVaccine,
  IconRuler2,
  IconTestPipe,
  IconBell,
  IconMessageChatbot,
  IconSearch,
  IconTopologyStar3,
  IconHistory,
  IconFileExport,
  IconShieldLock,
  type Icon,
} from '@tabler/icons-react';
import clsx from 'clsx';
import { qk } from '@/shared/api/keys';
import { fetchDashboard } from '@/features/dashboard/api';
import { haptic } from '@/shared/lib/haptic';
import { getSession } from '@/shared/auth/session';
import { PatientSwitcher } from './PatientSwitcher';

/**
 * Боковая панель для десктопа. Содержит ВСЁ: разделы из «Основного», из «Ещё»
 * и инструменты — одним списком с группировкой.
 *
 * На мобиле Sidebar скрыт через CSS (`display: none`), вместо него TabBar снизу.
 *
 * Бейджи с количеством (План/Ошибки/Диагнозы/Приёмы/Препараты) берутся из
 * `useDashboard()` — кэш разделяется с самой страницей Dashboard, повторный
 * запрос не делается.
 */

interface NavItemDef {
  to: string;
  label: string;
  icon: Icon;
  /** Ключ в dashboard.stats для badge-цифры. Берутся реальные поля бэкенда. */
  badgeKey?: 'plan_total' | 'errors_open' | 'diagnoses' | 'specialists' | 'documents' | 'reminders';
  badgeColor?: 'red' | 'orange' | 'green' | 'purple' | 'default';
  /** Если true — активна когда pathname начинается с to (а не совпадает точно) */
  prefix?: boolean;
  /** Для export — не роут, а action */
  action?: 'export-pdf';
}

// Фиксированные навигационные элементы — разбитые по группам.
const MAIN_GROUP: NavItemDef[] = [
  { to: '/dashboard', label: 'Сводка', icon: IconLayoutDashboard, prefix: true },
  { to: '/plan', label: 'План', icon: IconListCheck, badgeKey: 'plan_total', badgeColor: 'orange', prefix: true },
  { to: '/errors', label: 'Ошибки', icon: IconAlertTriangle, badgeKey: 'errors_open', badgeColor: 'red', prefix: true },
  { to: '/documents', label: 'Приёмы', icon: IconStethoscope, badgeKey: 'documents', prefix: true },
  { to: '/diagnoses', label: 'Диагнозы', icon: IconClipboardList, badgeKey: 'diagnoses', badgeColor: 'purple', prefix: true },
];

const CATALOG_GROUP: NavItemDef[] = [
  { to: '/more/specialists', label: 'Специалисты', icon: IconUserHeart, badgeKey: 'specialists' },
  { to: '/more/medications', label: 'Препараты', icon: IconPill, badgeColor: 'green' },
  { to: '/more/vaccinations', label: 'Прививки', icon: IconVaccine },
  { to: '/more/growth', label: 'Рост и вес', icon: IconRuler2 },
  { to: '/more/labs', label: 'Анализы', icon: IconTestPipe },
  { to: '/more/reminders', label: 'Напоминания', icon: IconBell },
];

const TOOLS_GROUP: NavItemDef[] = [
  { to: '/more/ai-chat', label: 'AI чат', icon: IconMessageChatbot },
  { to: '/more/search', label: 'Поиск', icon: IconSearch },
  { to: '/graph', label: 'Карта здоровья', icon: IconTopologyStar3, prefix: true },
  { to: '/more/history', label: 'История изменений', icon: IconHistory },
  { to: '/more/security', label: 'Безопасность', icon: IconShieldLock },
  { to: '/more/export', label: 'Экспорт PDF', icon: IconFileExport, action: 'export-pdf' },
];

export function Sidebar() {
  const { data: dashboard } = useQuery({
    queryKey: qk.dashboard,
    queryFn: fetchDashboard,
    retry: false,
  });
  const location = useLocation();
  const stats = dashboard?.stats;

  // Вычисляем badge для каждого пункта
  const getBadge = (key?: NavItemDef['badgeKey']) => {
    if (!key || !stats) return null;
    const raw = stats[key];
    const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
    if (n == null || n === 0 || Number.isNaN(n)) return null;
    return n;
  };

  const isActive = (item: NavItemDef): boolean => {
    if (item.prefix) {
      return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
    }
    return location.pathname === item.to;
  };

  const handleExportClick = (e: React.MouseEvent) => {
    e.preventDefault();
    haptic('light');
    const session = getSession();
    const token = session.sessionToken ?? '';
    const pid = session.patientId ?? 1;
    // Relative /api works via Pages _redirects; patient_id required (window.open cannot send X-Patient-Id).
    window.open(
      `/api/export/pdf?token=${encodeURIComponent(token)}&patient_id=${pid}`,
      '_blank'
    );
  };

  return (
    <aside className="ds-sidebar">
      {/* Header: brand + PatientSwitcher */}
      <div className="ds-sidebar-header">
        <div className="ds-brand">
          <img src="/icons/icon.svg" alt="Anamnesis" className="ds-brand-logo" />
          <div style={{ minWidth: 0 }}>
            <div className="ds-brand-title">Anamnesis</div>
            <div className="ds-brand-subtitle">Медицинский трекер</div>
          </div>
        </div>

        {/* Кликабельная плашка — та же что в мобильном хедере */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <PatientSwitcher />
        </div>
      </div>

      {/* Nav */}
      <nav className="ds-nav">
        <div className="ds-nav-section-title">Основное</div>
        {MAIN_GROUP.map((item) => (
          <NavItem key={item.to} item={item} active={isActive(item)} badge={getBadge(item.badgeKey)} />
        ))}

        <div className="ds-nav-section-title">Картотека</div>
        {CATALOG_GROUP.map((item) => (
          <NavItem key={item.to} item={item} active={isActive(item)} badge={getBadge(item.badgeKey)} />
        ))}

        <div className="ds-nav-section-title">Инструменты</div>
        {TOOLS_GROUP.map((item) => {
          if (item.action === 'export-pdf') {
            return (
              <button
                key={item.to}
                type="button"
                onClick={handleExportClick}
                className="ds-nav-item"
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          }
          return (
            <NavItem
              key={item.to}
              item={item}
              active={isActive(item)}
              badge={getBadge(item.badgeKey)}
            />
          );
        })}
      </nav>

      <div className="ds-sidebar-footer">Версия 2.0</div>
    </aside>
  );
}

function NavItem({
  item,
  active,
  badge,
}: {
  item: NavItemDef;
  active: boolean;
  badge: number | null;
}) {
  const IconComp = item.icon;
  return (
    <NavLink
      to={item.to}
      // Мгновенный переход без transition-анимации — клик по навигации
      // в sidebar должен открывать страницу сразу, как в любом desktop app
      state={{ instant: true }}
      className={clsx('ds-nav-item', active && 'active')}
      onClick={() => haptic('light')}
    >
      <IconComp size={18} />
      <span>{item.label}</span>
      {badge != null && (
        <span className={clsx('ds-nav-badge', item.badgeColor && item.badgeColor)}>{badge}</span>
      )}
    </NavLink>
  );
}

