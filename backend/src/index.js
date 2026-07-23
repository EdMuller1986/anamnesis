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
import errors from './routes/errors';
import reminders from './routes/reminders';
import aiRequests from './routes/ai-requests';
import history from './routes/history';
import patientContext from './routes/patient-context';
import search from './routes/search';

const app = new Hono();

// ── Middleware ─────────────────────────────────────────────

app.use('*', cors({
  origin: (origin, c) => c.env.CORS_ORIGINS === '*' ? origin : (c.env.CORS_ORIGINS || '').split(','),
  credentials: true,
}));

app.use('*', secureHeaders());

app.onError((err, c) => {
  console.error(`Worker Error: ${err.message}`, err.stack);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

/**
 * Хелпер для извлечения метаданных запроса.
 * Гарантирует наличие базовых полей и корректность типов.
 */
const getMeta = (c) => {
  const patientIdRaw = c.req.header('x-patient-id') || '1';
  let patientId = parseInt(patientIdRaw, 10);
  if (isNaN(patientId)) patientId = 1;

  return {
    ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0',
    ua: c.req.header('user-agent') || 'unknown',
    deviceId: c.req.header('x-device-id') || null,
    patientId
  };
};

/**
 * Middleware авторизации.
 * Проверяет сессию пользователя. Исключает публичные и технические эндпоинты.
 */
const authMiddleware = async (c, next) => {
  const path = c.req.path;
  
  // 1. Исключения, не требующие вообще никакой проверки
  const publicPaths = [
    '/api/auth/login',
    '/api/health',
    '/api/version',
    '/api/webauthn/available'
  ];
  if (publicPaths.includes(path)) return await next();
  if (path.startsWith('/api/webauthn/login')) return await next();

  // 2. Исключение для админки — там своя проверка X-Admin-Token
  if (path.startsWith('/api/admin/')) return await next();

  // 3. Исключение для экспорта — там проверка токена в параметрах URL
  if (path === '/api/export/pdf') return await next();

  // 4. Проверка сессии
  const token = c.req.header('X-Session-Token') || 
                c.req.header('Authorization')?.replace('Bearer ', '') || 
                c.req.query('token') ||
                getCookie(c, 'session');

  if (!token) return c.json({ error: 'Unauthorized: Missing token' }, 401);

  const session = await authSession.getSession(c.env.DB, token);
  if (!session) return c.json({ error: 'Unauthorized: Invalid session' }, 401);

  const meta = getMeta(c);
  c.executionCtx.waitUntil(authSession.touchSession(c.env.DB, token, meta.ip));

  c.set('patientId', session.patient_id);
  c.set('session', session);
  await next();
};

app.use('/api/*', authMiddleware);

/**
 * Middleware для админ-инструментов.
 * Защищает операционные ручки ИИ-координатора.
 */
app.use('/api/admin/*', async (c, next) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TOKEN;
  
  if (!expectedToken || adminToken !== expectedToken) {
    console.warn(`Admin access denied from ${c.req.header('cf-connecting-ip')}`);
    return c.json({ error: 'Forbidden: Invalid Admin Token' }, 403);
  }
  await next();
});

// ── Эндпоинты ──────────────────────────────────────────────

app.get('/api/health', (c) => c.json({ status: 'ok', db: 'connected' }));
app.get('/api/version', (c) => c.json({ version: '2.0.0-serverless' }));
app.get('/api/webauthn/available', (c) => c.json({ available: false }));
app.get('/api/auth/security-status', (c) => c.json({ webauthn_enabled: false, lockout_active: false }));

/**
 * Экспорт медицинского отчета.
 * Имеет собственную логику авторизации по токену в URL.
 */
app.get('/api/export/pdf', async (c) => {
  const token = c.req.query('token');
  const pid = parseInt(c.req.query('patient_id') || '1', 10);
  
  if (!token) return c.text('Unauthorized', 401);
  const session = await authSession.getSession(c.env.DB, token);
  if (!session || session.patient_id !== pid) return c.text('Unauthorized', 401);

  // Сбор данных и генерация HTML...
  const [p, ds, ms, ts] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).first(),
    c.env.DB.prepare('SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY status ASC, created_at DESC').bind(pid).all(),
    c.env.DB.prepare('SELECT * FROM medications WHERE patient_id = ? ORDER BY status ASC, created_at DESC').bind(pid).all(),
    c.env.DB.prepare('SELECT * FROM timeline WHERE patient_id = ? ORDER BY event_date DESC').bind(pid).all()
  ]);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Отчёт: ${p.full_name}</title></head><body><h1>Медицинский отчёт</h1><p>Пациент: ${p.full_name}</p></body></html>`;
  return c.html(html);
});

// Монтирование роутов
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
app.route('/api/errors', errors);
app.route('/api/reminders', reminders);
app.route('/api/ai-requests', aiRequests);
app.route('/api/history', history);
app.route('/api/patient-context', patientContext);
app.route('/api/search', search);

// Вход по ПИН-коду
app.post('/api/auth/login', async (c) => {
  const { pin } = await c.req.json();
  const { patientId, ip, ua, deviceId } = getMeta(c);

  try {
    const lockout = await authSession.checkLockout(c.env.DB, ip, deviceId);
    if (lockout.locked) return c.json({ error: 'Too many attempts', remaining_sec: Math.ceil(lockout.remainingMs / 1000) }, 429);
    
    const storedHash = await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`pin_hash_${patientId}`).first('value');
    if (!storedHash) return c.json({ error: 'PIN not configured' }, 500);
    
    if (!(await authSession.verifyPin(pin, storedHash))) {
      const fail = await authSession.recordAuthFailure(c.env.DB, ip, deviceId, patientId);
      return c.json({ error: 'Invalid PIN', attempts: fail.attempts }, 401);
    }

    await authSession.resetAuthFailures(c.env.DB, ip, deviceId);
    const token = await authSession.createSession(c.env.DB, patientId, ip, ua, deviceId);
    return c.json({ token, expires_days: 14 });
  } catch (err) {
    return c.json({ error: 'Login error', message: err.message }, 500);
  }
});

// Статус и выход
app.get('/api/auth/check', async (c) => {
  const session = c.get('session');
  return c.json({ ok: true, patient_id: session.patient_id, expires_at: session.expires_at });
});

app.post('/api/auth/logout', async (c) => {
  const token = c.req.header('X-Session-Token') || getCookie(c, 'session');
  if (token) await c.env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE token = ?').bind(token).run();
  return c.json({ message: 'Logged out' });
});

export default app;
