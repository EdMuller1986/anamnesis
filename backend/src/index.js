import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { getCookie } from 'hono/cookie';
import * as authSession from './services/auth-session';

// Import Routes
import documents from './routes/documents';
import patient from './routes/patient';
import timeline from './routes/timeline';
import diagnoses from './routes/diagnoses';
import medications from './routes/medications';
import specialists from './routes/specialists';
import labResults from './routes/lab-results';
import plan from './routes/plan';
import dashboard from './routes/dashboard';
import comments from './routes/comments';
import growth from './routes/growth';
import vaccinations from './routes/vaccinations';
import adminTools from './routes/admin-tools';
import admin from './routes/admin';
import errors from './routes/errors';
import reminders from './routes/reminders';
import aiRequests from './routes/ai-requests';
import history from './routes/history';
import patientContext from './routes/patient-context';
import search from './routes/search';
import prescriptions from './routes/prescriptions';
import visitDiagnoses from './routes/visit-diagnoses';
import exportRoute from './routes/export';
import webauthn from './routes/webauthn';
import auth from './routes/auth';
import changelog from './routes/changelog';
import * as backup from './services/backup';
import * as scheduler from './services/scheduler';

const app = new Hono();

// ── Middleware ─────────────────────────────────────────────

app.use('*', cors({
  origin: (origin, c) => {
    const allowed = c.env.CORS_ORIGINS;
    if (!allowed) {
      console.warn('CORS_ORIGINS not set, rejecting request from:', origin);
      return null;
    }
    return allowed === '*' ? origin : allowed.split(',');
  },
  credentials: true,
}));

app.use('*', secureHeaders({
  contentSecurityPolicy: false, // Отключаем CSP в Workers, так как он может конфликтовать с фронтендом на другом домене
  xFrameOptions: false,
  permissionsPolicy: {
    'publickey-credentials-get': ['*'],
    'publickey-credentials-create': ['*'],
  },
}));

app.onError((err, c) => {
  console.error(`Worker Error: ${err.message}`, err.stack);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

/**
 * Хелпер для извлечения метаданных запроса.
 * Гарантирует наличие базовых полей и корректность типов.
 */
const getMeta = (c) => {
  return {
    ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0',
    ua: c.req.header('user-agent') || 'unknown',
    deviceId: c.req.header('x-device-id') || null,
  };
};

/**
 * Resolve active chart (family multi-patient).
 * Session = authenticated family user; X-Patient-Id = which chart to use.
 * If header is absent, fall back to session.patient_id (login default) or 1.
 * Invalid header → 400; unknown patient → 404.
 */
async function resolvePatientId(c, { fallbackPatientId = 1, requireExists = true } = {}) {
  const headerRaw = c.req.header('x-patient-id');
  let patientId;

  if (headerRaw != null && String(headerRaw).trim() !== '') {
    patientId = parseInt(headerRaw, 10);
    if (isNaN(patientId) || patientId <= 0) {
      return { error: c.json({ error: 'Invalid X-Patient-Id' }, 400) };
    }
  } else {
    patientId = parseInt(fallbackPatientId, 10);
    if (isNaN(patientId) || patientId <= 0) patientId = 1;
  }

  if (requireExists && c.env.DB) {
    const row = await c.env.DB.prepare('SELECT id FROM patient WHERE id = ?').bind(patientId).first();
    if (!row) {
      return { error: c.json({ error: 'Patient not found' }, 404) };
    }
  }

  return { patientId };
}

/**
 * Middleware авторизации.
 * Проверяет сессию пользователя. Исключает публичные и технические эндпоинты.
 */
const authMiddleware = async (c, next) => {
  const path = c.req.path;
  
  // 1. Публичные эндпоинты
  const publicPaths = new Set([
    '/api/auth/login',
    '/api/auth/verify-device',
    '/api/health',
    '/api/version',
    '/api/webauthn/available'
  ]);

  if (publicPaths.has(path)) return await next();

  // 2. Исключения по префиксу (admin sets patientId in its own middleware)
  if (path.startsWith('/api/webauthn/login/') || path.startsWith('/api/admin/')) {
    return await next();
  }

  // 3. Проверка сессии
  const token = c.req.header('X-Session-Token') || 
                c.req.header('Authorization')?.replace('Bearer ', '') || 
                c.req.query('token') ||
                getCookie(c, 'session');

  if (!token) return c.json({ error: 'Unauthorized: Missing token' }, 401);

  const session = await authSession.getSession(c.env.DB, token);
  if (!session) return c.json({ error: 'Unauthorized: Invalid session' }, 401);

  const meta = getMeta(c);
  try {
    // В Cloudflare Workers есть executionCtx. В тестах или других окружениях его может не быть.
    if (c.executionCtx) {
      c.executionCtx.waitUntil(authSession.touchSession(c.env.DB, token, meta.ip));
    } else {
      await authSession.touchSession(c.env.DB, token, meta.ip);
    }
  } catch (e) {
    await authSession.touchSession(c.env.DB, token, meta.ip);
  }

  // Family mode: honor X-Patient-Id (active chart), not only session.patient_id from login
  const resolved = await resolvePatientId(c, {
    fallbackPatientId: session.patient_id || 1,
    requireExists: true,
  });
  if (resolved.error) return resolved.error;

  c.set('patientId', resolved.patientId);
  c.set('session', session);
  await next();
};

app.use('/api/*', authMiddleware);

/**
 * Middleware для админ-инструментов.
 * Защищает операционные ручки ИИ-координатора.
 * Also resolves X-Patient-Id so admin tools are not stuck on patient 1.
 */
app.use('/api/admin/*', async (c, next) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TOKEN;
  
  if (!expectedToken || adminToken !== expectedToken) {
    console.warn(`Admin access denied from ${c.req.header('cf-connecting-ip')}`);
    return c.json({ error: 'Forbidden: Invalid Admin Token' }, 403);
  }

  // Admin may omit patient existence check for tools that wipe empty DBs; still parse header.
  const resolved = await resolvePatientId(c, {
    fallbackPatientId: 1,
    requireExists: false,
  });
  if (resolved.error) return resolved.error;
  c.set('patientId', resolved.patientId);

  await next();
});

// ── Эндпоинты ──────────────────────────────────────────────

app.get('/api/health', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ status: 'degraded', db: 'missing' }, 503);
    }
    // .bind() keeps D1 + test mocks consistent (some mocks only expose first after bind)
    const row = await c.env.DB.prepare('SELECT 1 AS ok').bind().first();
    if (!row || (row.ok !== 1 && row['1'] !== 1)) {
      return c.json({ status: 'degraded', db: 'error' }, 503);
    }
    return c.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('[health] DB check failed:', err);
    return c.json({ status: 'error', db: 'disconnected', message: err.message }, 503);
  }
});
app.get('/api/version', (c) => c.json({ version: '2.0.0-serverless' }));
app.route('/api/webauthn', webauthn);
app.route('/api/auth', auth);

// ── Эндпоинты ──────────────────────────────────────────────

app.route('/api/patient', patient);
app.route('/api/timeline', timeline);
app.route('/api/documents', documents);
app.route('/api/diagnoses', diagnoses);
app.route('/api/medications', medications);
app.route('/api/specialists', specialists);
app.route('/api/lab-results', labResults);
app.route('/api/plan', plan);
app.route('/api/dashboard', dashboard);
app.route('/api/comments', comments);
app.route('/api/growth', growth);
app.route('/api/vaccinations', vaccinations);
app.route('/api/admin/tools', adminTools);
app.route('/api/admin', admin);
app.route('/api/errors', errors);
app.route('/api/reminders', reminders);
app.route('/api/ai-requests', aiRequests);
app.route('/api/history', history);
app.route('/api/patient-context', patientContext);
app.route('/api/search', search);
app.route('/api/prescriptions', prescriptions);
app.route('/api/visit-diagnoses', visitDiagnoses);
app.route('/api/export', exportRoute);
app.route('/api/changelog', changelog);

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    if (event.cron === '0 2 * * *') {
      ctx.waitUntil(backup.runBackup(env));
    } else if (event.cron === '*/15 * * * *') {
      ctx.waitUntil(scheduler.checkReminders(env));
    }
  },
};
