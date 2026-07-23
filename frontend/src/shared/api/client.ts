import { ApiError } from './errors';
import { getSession } from '@/shared/auth/session';

/**
 * Базовый fetch-клиент для всех запросов к `/api/*`.
 *
 * Отвечает за:
 * - Базовый URL `/api`
 * - Auth headers (Bearer, Session, Patient-Id) из session store
 * - JSON <-> string сериализация
 * - Корректный обработчик ошибок (ApiError с кодом статуса)
 * - Поддержка FormData для upload-запросов
 *
 * НЕ отвечает за:
 * - Кэширование (это делает React Query)
 * - Retry (это делает React Query + networkMode)
 * - Оффлайн-очередь POST (это делает Workbox background sync, добавим в Фазе 4)
 *
 * Паттерн использования:
 * ```ts
 * const data = await api.get<DashboardResponse>(EP.dashboard);
 * await api.post(EP.plan, { title, priority });
 * ```
 */

// In development, Vite proxy forwards /api to backend (see vite.config.ts)
// In production, use VITE_API_URL from environment or fall back to relative path
const BASE = import.meta.env.VITE_API_URL || '/api';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  isFormData = false
): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = {};

  if (!isFormData && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (session.apiToken) {
    headers['Authorization'] = `Bearer ${session.apiToken}`;
  }
  if (session.sessionToken) {
    headers['X-Session-Token'] = session.sessionToken;
  }
  if (session.patientId !== null && session.patientId !== undefined) {
    headers['X-Patient-Id'] = String(session.patientId);
  }
  // X-Device-Id: стабильный UUID устройства для device trust
  // (бэкенд запоминает known devices, спрашивает secret question на новых)
  if (session.deviceId) {
    headers['X-Device-Id'] = session.deviceId;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: isFormData
        ? (body as FormData)
        : body !== undefined
          ? JSON.stringify(body)
          : null,
    });
  } catch (err) {
    // Сеть упала — возвращаем «сетевую» ApiError со статусом 0.
    throw new ApiError(
      err instanceof Error ? err.message : 'Network error',
      0,
      err
    );
  }

  if (!response.ok) {
    let data: unknown;
    let message = response.statusText;
    try {
      data = await response.json();
      if (data && typeof data === 'object' && 'error' in data) {
        message = String((data as { error: unknown }).error);
      }
    } catch {
      // ignore body parse errors
    }

    // Глобальный обработчик 401/403 — если сессия недействительна
    // (например устройство было отозвано владельцем), диспатчим
    // событие которое AuthContext подхватит и сделает auto-logout.
    // Это срабатывает на ЛЮБОЙ endpoint кроме самих auth-эндпоинтов.
    if (
      (response.status === 401 || (response.status === 403 && (data as { device_revoked?: boolean })?.device_revoked)) &&
      !path.startsWith('/auth/login') &&
      !path.startsWith('/auth/verify-device') &&
      !path.startsWith('/auth/check') &&
      !path.startsWith('/webauthn/login/')
    ) {
      try {
        window.dispatchEvent(new CustomEvent('auth:unauthorized', {
          detail: { status: response.status, path, message },
        }));
      } catch {
        // ignore — window может отсутствовать в SSR/тестах
      }
    }

    throw new ApiError(message, response.status, data);
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return response as unknown as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, formData: FormData) => request<T>('POST', path, formData, true),
};
