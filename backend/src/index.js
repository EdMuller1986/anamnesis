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

// Middleware
app.use('*', cors({
  origin: (origin, c) => c.env.CORS_ORIGINS === '*' ? origin : c.env.CORS_ORIGINS.split(','),
  credentials: true,
}));

app.use('*', secureHeaders());

app.onError((err, c) => {
  console.error(`Worker Error: ${err.message}`, err.stack);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

// Helper for metadata
const getMeta = (c) => ({
  ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0',
  ua: c.req.header('user-agent') || 'unknown',
  deviceId: c.req.header('x-device-id') || null,
  patientId: parseInt(c.req.header('x-patient-id') || '1', 10)
});

// Auth Middleware
const authMiddleware = async (c, next) => {
  const path = c.req.path;
  
  const skipPaths = [
    '/api/auth/login',
    '/api/health',
    '/api/version',
    '/api/webauthn/available'
  ];

  if (path === '/api/export/pdf') return await next();
  if (skipPaths.some(p => path === p || path.startsWith('/api/webauthn/login') || path.startsWith('/api/admin/'))) {
    return await next();
  }

  const token = c.req.header('X-Session-Token') || 
                c.req.header('Authorization')?.replace('Bearer ', '') || 
                c.req.query('token') ||
                getCookie(c, 'session');

  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const session = await authSession.getSession(c.env.DB, token);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  const ip = c.req.header('cf-connecting-ip') || '0.0.0.0';
  c.executionCtx.waitUntil(authSession.touchSession(c.env.DB, token, ip));

  c.set('patientId', session.patient_id);
  c.set('session', session);
  await next();
};

app.use('/api/*', authMiddleware);

// --- Export Logic ---
function esc(text) {
  if (!text && text !== 0) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('ru-RU');
}

app.get('/api/export/pdf', async (c) => {
  const token = c.req.query('token');
  const pid = parseInt(c.req.query('patient_id') || '1', 10);
  
  if (!token) return c.text('Unauthorized', 401);
  const session = await authSession.getSession(c.env.DB, token);
  if (!session || session.patient_id !== pid) return c.text('Unauthorized', 401);

  // Fetch data
  const [p, ds, ms, ts] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM patient WHERE id = ?').bind(pid).first(),
    c.env.DB.prepare('SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY status ASC, created_at DESC').bind(pid).all(),
    c.env.DB.prepare('SELECT * FROM medications WHERE patient_id = ? ORDER BY status ASC, created_at DESC').bind(pid).all(),
    c.env.DB.prepare('SELECT * FROM timeline WHERE patient_id = ? ORDER BY event_date DESC').bind(pid).all()
  ]);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Отчёт: ${esc(p.full_name)}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:20px auto;padding:20px;line-height:1.4;}h1{border-bottom:2px solid #007AFF;} .section{margin-top:20px;padding:10px;background:#f9f9f9;border-radius:8px;} table{width:100%;border-collapse:collapse;margin:10px 0;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}</style>
</head><body>
<h1>Медицинский отчёт</h1>
<div class="section"><strong>Пациент:</strong> ${esc(p.full_name)}<br><strong>Дата рождения:</strong> ${formatDate(p.date_of_birth)}<br><strong>Пол:</strong> ${esc(p.gender)}</div>
<h2>Диагнозы</h2><table><tr><th>Название</th><th>Статус</th></tr>${ds.results.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.status)}</td></tr>`).join('')}</table>
<h2>Лекарства</h2><table><tr><th>Название</th><th>Дозировка</th><th>Статус</th></tr>${ms.results.map(m=>`<tr><td>${esc(m.name)}</td><td>${esc(m.dosage)}</td><td>${esc(m.status)}</td></tr>`).join('')}</table>
<h2>История</h2><table><tr><th>Дата</th><th>Событие</th></tr>${ts.results.map(t=>`<tr><td>${formatDate(t.event_date)}</td><td>${esc(t.title)}</td></tr>`).join('')}</table>
<p style="color:#666;font-size:12px;margin-top:40px;">Сформировано автоматически в Anamnesis Serverless</p>
</body></html>`;

  return c.html(html, 200, {
    'Content-Type': 'text/html; charset=UTF-8',
    'Content-Disposition': `inline; filename="report_${pid}.html"`
  });
});

// Admin Auth Middleware
app.use('/api/admin/*', async (c, next) => {
  const adminToken = c.req.header('X-Admin-Token');
  if (c.env.ADMIN_TOKEN && adminToken !== c.env.ADMIN_TOKEN) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

// System/Public Routes
app.get('/api/health', (c) => c.json({ status: 'ok', db: 'connected' }));
app.get('/api/version', (c) => c.json({ version: '2.0.0-serverless' }));
app.get('/api/webauthn/available', (c) => c.json({ available: false }));
app.get('/api/auth/security-status', (c) => c.json({ webauthn_enabled: false, lockout_active: false }));

// Auth
app.post('/api/auth/login', async (c) => {
  const { pin } = await c.req.json();
  const pid = parseInt(c.req.header('x-patient-id') || '1', 10);
  const ip = c.req.header('cf-connecting-ip') || '0.0.0.0';
  const ua = c.req.header('user-agent') || 'unknown';
  const deviceId = c.req.header('x-device-id') || null;

  try {
    const lockout = await authSession.checkLockout(c.env.DB, ip, deviceId);
    if (lockout.locked) return c.json({ error: 'Too many attempts' }, 429);
    
    const storedHash = await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`pin_hash_${pid}`).first('value');
    if (!storedHash) return c.json({ error: 'PIN not configured' }, 500);
    
    if (!(await authSession.verifyPin(pin, storedHash))) {
      await authSession.recordAuthFailure(c.env.DB, ip, deviceId, pid);
      return c.json({ error: 'Invalid PIN' }, 401);
    }

    await authSession.resetAuthFailures(c.env.DB, ip, deviceId);
    const token = await authSession.createSession(c.env.DB, pid, ip, ua, deviceId);
    return c.json({ token, expires_days: 14 });
  } catch (err) { return c.json({ error: 'Login error' }, 500); }
});

// Secure Routes
app.get('/api/webauthn/credentials', (c) => c.json([]));
app.get('/api/auth/check', async (c) => {
  const session = c.get('session');
  return c.json({ ok: true, patient_id: session.patient_id, expires_at: session.expires_at });
});
app.post('/api/auth/logout', async (c) => {
  const token = c.req.header('X-Session-Token') || c.req.header('Authorization')?.replace('Bearer ', '') || getCookie(c, 'session');
  if (token) await c.env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE token = ?').bind(token).run();
  return c.json({ message: 'Logged out' });
});

// Mount Routes
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

export default app;
