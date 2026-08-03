/**
 * «Экспорт PDF» — на самом деле HTML-отчёт (print-friendly).
 *
 * Нельзя просто window.open('/api/export/pdf?token=...') :
 * - token в URL ломается на proxy/SW/редиректах;
 * - без X-Patient-Id middleware берёт session.patient_id, не активного пациента;
 * - при ошибке proxy Pages отдаёт SPA (index.html) — «просто переадресация» в приложение.
 *
 * Надёжный путь: fetch с теми же headers, что api client → Blob → window.open.
 */

import { getSession } from '@/shared/auth/session';
import { EP } from '@/shared/api/endpoints';

const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

function buildExportUrl(patientId: number): string {
  const path = EP.exportPdf.startsWith('/') ? EP.exportPdf : `/${EP.exportPdf}`;
  // BASE already ends without trailing slash and includes /api when set
  return `${BASE}${path}?patient_id=${encodeURIComponent(String(patientId))}`;
}

/**
 * Загружает HTML-отчёт и открывает в новой вкладке.
 * @throws Error с понятным текстом при 401/5xx/не-HTML ответе
 */
export async function openMedicalReportHtml(): Promise<void> {
  const session = getSession();
  const token = session.sessionToken;
  if (!token) {
    throw new Error('Сначала войдите в приложение (нет session token)');
  }

  const patientId = session.patientId && session.patientId > 0 ? session.patientId : 1;
  const url = buildExportUrl(patientId);

  const headers: Record<string, string> = {
    Accept: 'text/html, application/xhtml+xml, */*',
    'X-Session-Token': token,
    'X-Patient-Id': String(patientId),
  };
  if (session.deviceId) headers['X-Device-Id'] = session.deviceId;
  if (session.apiToken) headers['Authorization'] = `Bearer ${session.apiToken}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error(
      err instanceof Error ? `Сеть: ${err.message}` : 'Сеть недоступна для экспорта'
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const bodyText = await res.text();

  if (!res.ok) {
    let msg = `Ошибка экспорта (${res.status})`;
    try {
      const j = JSON.parse(bodyText) as { error?: string; message?: string };
      msg = j.error || j.message || msg;
    } catch {
      if (bodyText && bodyText.length < 200) msg = bodyText;
    }
    throw new Error(msg);
  }

  // Pages SPA fallback / wrong proxy often returns the React shell instead of the report
  const looksLikeSpaShell =
    bodyText.includes('id="root"') &&
    !bodyText.includes('Медицинский отчёт') &&
    !bodyText.includes('Anamnesis');
  const looksLikeHtml = /<html[\s>]/i.test(bodyText) || contentType.includes('text/html');

  if (looksLikeSpaShell || !looksLikeHtml) {
    throw new Error(
      'Вместо отчёта пришла страница приложения. Проверьте VITE_API_URL и proxy /api → Worker.'
    );
  }

  const blob = new Blob([bodyText], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');

  if (!win) {
    // Popup blocked — same-tab fallback
    window.location.assign(blobUrl);
    return;
  }

  // Revoke after the tab has a chance to load
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
}
