import { Hono } from 'hono';
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
import documents from './routes/documents';
import patient from './routes/patient';
import * as authSession from './services/auth-session';
import { getCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

const app = new Hono();

// Middleware
app.use('*', cors({
  origin: (origin, c) => c.env.CORS_ORIGINS === '*' ? origin : c.env.CORS_ORIGINS.split(','),
  credentials: true,
}));
app.use('*', secureHeaders());

// Global Error Handler
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
    '/api/auth/check',
    '/api/health',
    '/api/version',
    '/api/webauthn/available'
  ];

  if (skipPaths.some(p => path === p || path.startsWith('/api/webauthn/login'))) return await next();

  const token = c.req.header('X-Session-Token') || 
                c.req.header('Authorization')?.replace('Bearer ', '') || 
                getCookie(c, 'session');

  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const session = await authSession.getSession(c.env.DB, token);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  const meta = getMeta(c);
  c.executionCtx.waitUntil(authSession.touchSession(c.env.DB, token, meta.ip));

  c.set('patientId', session.patient_id);
  c.set('session', session);
  await next();
};

app.use('/api/*', authMiddleware);

// Stubs for missing functional endpoints
app.get('/api/version', (c) => c.json({ version: '2.0.0-serverless', build: 'cf-workers' }));
app.get('/api/webauthn/available', (c) => c.json({ available: false }));
app.get('/api/auth/security-status', (c) => c.json({ webauthn_enabled: false, lockout_active: false }));

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

// Login
app.post('/api/auth/login', async (c) => {
  const { pin } = await c.req.json();
  const meta = getMeta(c);
  try {
    const lockout = await authSession.checkLockout(c.env.DB, meta.ip, meta.deviceId);
    if (lockout.locked) return c.json({ error: 'Too many attempts', remaining_sec: Math.ceil(lockout.remainingMs / 1000) }, 429);
    const storedHash = await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`pin_hash_${meta.patientId}`).first('value');
    if (!storedHash) return c.json({ error: 'PIN not configured' }, 500);
    if (!(await authSession.verifyPin(pin, storedHash))) {
      const fail = await authSession.recordAuthFailure(c.env.DB, meta.ip, meta.deviceId, meta.patientId);
      return c.json({ error: 'Invalid PIN', attempts: fail.attempts }, 401);
    }
    await authSession.resetAuthFailures(c.env.DB, meta.ip, meta.deviceId);
    const token = await authSession.createSession(c.env.DB, meta.patientId, meta.ip, meta.ua, meta.deviceId);
    return c.json({ token, expires_days: 14 });
  } catch (err) {
    return c.json({ error: 'Login error', message: err.message }, 500);
  }
});

app.get('/api/health', (c) => c.json({ status: 'ok' }));

export default app;
