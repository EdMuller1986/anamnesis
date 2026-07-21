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

const app = new Hono();

// Middleware
app.use('*', cors({
  origin: (origin, c) => c.env.CORS_ORIGINS === '*' ? origin : c.env.CORS_ORIGINS.split(','),
  credentials: true,
}));
app.use('*', secureHeaders());

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
    '/api/webauthn/available',
    '/api/webauthn/login/options',
    '/api/webauthn/login/verify'
  ];

  if (skipPaths.some(p => path === p)) return await next();

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

// Routes
app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    return c.json({ status: 'error', db: 'disconnected', message: e.message }, 503);
  }
});

// Login
app.post('/api/auth/login', async (c) => {
  const { pin } = await c.req.json();
  const meta = getMeta(c);

  try {
    const lockout = await authSession.checkLockout(c.env.DB, meta.ip, meta.deviceId);
    if (lockout.locked) {
      return c.json({
        error: 'Too many attempts',
        remaining_sec: Math.ceil(lockout.remainingMs / 1000)
      }, 429);
    }

    const storedHash = await c.env.DB.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).bind(`pin_hash_${meta.patientId}`).first('value');

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

export default app;
