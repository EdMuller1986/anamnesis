import { EP } from '@/shared/api/endpoints';
import { getSession } from '@/shared/auth/session';
import type { Document, Timeline } from '@/shared/types';

/**
 * Конвертирует `doc.file_path` в публичный URL.
 * Теперь использует прокси-эндпоинт бэкенда, который редиректит на B2.
 * Добавляет токен сессии в query param для авторизации при прямом открытии/скачивании.
 */
export function docFileUrl(doc: Document): string | null {
  if (!doc.id) return null;
  const baseUrl = import.meta.env.VITE_API_URL || '/api';
  const token = getSession().sessionToken;
  const url = `${baseUrl}${EP.documentFile(doc.id)}`;
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export function isImage(doc: Document): boolean {
  return !!doc.mime_type && doc.mime_type.startsWith('image/');
}

export function isPdf(doc: Document): boolean {
  return !!doc.mime_type && doc.mime_type.includes('pdf');
}

export const CATEGORY_LABELS: Record<string, string> = {
  visit: 'Приём',
  test: 'Обследование',
  diagnosis: 'Диагноз',
  milestone: 'Событие',
};

export const DOC_CATEGORY_LABELS: Record<string, string> = {
  lab: 'Анализы',
  imaging: 'Снимки',
  prescription: 'Рецепт',
  report: 'Заключение',
  other: 'Другое',
};

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function parseEventDate(dateStr: string | null | undefined): { day: number; month: string; year: number } | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return {
    day: d.getDate(),
    month: MONTHS[d.getMonth()] ?? '',
    year: d.getFullYear(),
  };
}

export function getSpecialistInfo(t: Timeline): { name: string | null; type: string | null } {
  const name = t.specialist_name_resolved ?? t.specialist_name;
  const type = t.specialist_specialty ?? t.specialist_type;
  return { name, type };
}

/**
 * Фильтры списка в Documents (порт из vanilla documents.js:897).
 */
export type DocumentsFilter = 'all' | 'visits' | 'docs';

/**
 * Условие "это визит/приём" — совпадает с vanilla:
 * `isVisit = i.category === 'visit' || i.specialist_id || i.specialist_name || i.specialist_type`
 *
 * Важно: milestone-события с привязанным специалистом (например "Рождение —
 * выписной эпикриз" → Перевозникова Л.В., неонатолог) ТОЖЕ считаются визитами
 * и показываются в фильтре «Приёмы». Раньше в React я проверял только
 * `category === 'visit' || null`, и такие события пропадали при фильтрации.
 */
function isVisitLike(t: Timeline): boolean {
  if (t.category === 'visit' || t.category === null) return true;
  if (t.specialist_id != null) return true;
  if (t.specialist_name != null && t.specialist_name !== '') return true;
  if (t.specialist_type != null && t.specialist_type !== '') return true;
  return false;
}

export function filterTimeline(items: Timeline[], filter: DocumentsFilter): Timeline[] {
  if (filter === 'all') return items;
  if (filter === 'visits') return items.filter(isVisitLike);
  // 'docs' — только те, у кого есть документы
  return items.filter((t) => (t.documents?.length ?? 0) > 0);
}

/**
 * Группировка таймлайна по годам для рендера секций.
 */
export function groupByYear(items: Timeline[]): Array<{ year: number; items: Timeline[] }> {
  const groups = new Map<number, Timeline[]>();
  for (const item of items) {
    const year = new Date(item.event_date).getFullYear();
    const list = groups.get(year) ?? [];
    list.push(item);
    groups.set(year, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({ year, items }));
}

// ─── Unified timeline + standalone docs для фильтра «Все» ──────────
//
// Проблема которая решается: раньше standalone documents рендерились
// отдельной секцией "Документы без привязки" внизу списка, независимо
// от дат. В результате свежий документ (например анализы от 10.04.2026)
// оказывался ВНИЗУ, хотя хронологически он самый недавний.
//
// Решение: объединить timeline visits и standalone docs в единый
// список, отсортированный по дате DESC, затем группировать по годам.

export type UnifiedEntry =
  | { kind: 'visit'; visit: Timeline; sortDate: string }
  | { kind: 'doc'; doc: Document; sortDate: string };

/**
 * Возвращает дату для сортировки документа.
 * Предпочитаем document_date (дата СОБЫТИЯ — когда сдали анализ, когда
 * выписал врач), fallback на created_at (дата загрузки в систему).
 */
function getDocSortDate(doc: Document): string {
  if (doc.document_date) return doc.document_date;
  if (doc.created_at) return doc.created_at.slice(0, 10);
  return '1970-01-01';
}

export function buildUnifiedEntries(
  visits: Timeline[],
  standaloneDocs: Document[]
): UnifiedEntry[] {
  const entries: UnifiedEntry[] = [
    ...visits.map((v): UnifiedEntry => ({
      kind: 'visit',
      visit: v,
      sortDate: v.event_date || '1970-01-01',
    })),
    ...standaloneDocs.map((d): UnifiedEntry => ({
      kind: 'doc',
      doc: d,
      sortDate: getDocSortDate(d),
    })),
  ];
  // DESC — самое свежее сверху
  entries.sort((a, b) => (a.sortDate < b.sortDate ? 1 : a.sortDate > b.sortDate ? -1 : 0));
  return entries;
}

export function groupEntriesByYear(
  entries: UnifiedEntry[]
): Array<{ year: number; items: UnifiedEntry[] }> {
  const groups = new Map<number, UnifiedEntry[]>();
  for (const entry of entries) {
    const year = new Date(entry.sortDate).getFullYear();
    const list = groups.get(year) ?? [];
    list.push(entry);
    groups.set(year, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({ year, items }));
}

/**
 * Сортировать и группировать standalone docs по годам (для фильтра «Документы»).
 * Использует document_date или created_at fallback.
 */
export function groupDocsByYear(
  docs: Document[]
): Array<{ year: number; items: Document[] }> {
  const sorted = [...docs].sort((a, b) => {
    const da = getDocSortDate(a);
    const db = getDocSortDate(b);
    return da < db ? 1 : da > db ? -1 : 0;
  });
  const groups = new Map<number, Document[]>();
  for (const doc of sorted) {
    const year = new Date(getDocSortDate(doc)).getFullYear();
    const list = groups.get(year) ?? [];
    list.push(doc);
    groups.set(year, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({ year, items }));
}
