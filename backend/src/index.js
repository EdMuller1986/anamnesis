// backend/src/index.js
// Cloudflare Workers + Hono entry point for Anamnesis backend

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { getCookie } from 'hono/cookie';

import { getConfig, validateB2Config } from './config.js';
import * as authSession from './services/auth-session.js';

// Import Routes
import documents from './routes/documents.js';
import patient from './routes/patient.js';
import timeline from './routes/timeline.js';
import diagnoses from './routes/diagnoses.js';
import medications from './routes/medications.js';
import specialists from './routes/specialists.js';
import labResults from './routes/lab-results.js';
import plan from './routes/plan.js';
import dashboard from './routes/dashboard.js';
import comments from './routes/comments.js';
import growth from './routes/growth.js';
import vaccinations from './routes/vaccinations.js';
import adminTools from './routes/admin-tools.js';
import errors from './routes/errors.js';
import reminders from './routes/reminders.js';
import aiRequests from './routes/ai-requests.js';
import history from './routes/history.js';
import patientContext from './routes/patient-context.js';
import search from './routes/search.js';

const app = new Hono();

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═════════════════════════════════════════════════════════════════════���═════

// Middleware to attach config to context
app.use('*', async (c, next) => {
  try {
    const config = getConfig(c.env);
    validateB2Config(config);
    c.set('config', config);
  } catch (err) {
    console.error('[config] Initialization failed:', err.message);
    return c.json(
      { error: 'Server configuration error' },
      500
    );
  }
  await next();
});

// CORS middleware
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const config = c.get('config');
      if (config.corsOrigins === '*') return origin;
      const allowed = config.corsOrigins.split(',').map((s) => s.trim());
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
  })
);

// Security headers
app.use('*', secureHeaders());

// Error handler
app.onError((err, c) => {
  const config = c.get('config');
  const isDev = config?.isDevelopment;

  if (!isDev) {
    console.error(`[error] ${err.message}`);
  } else {
    console.error(`[error] ${err.message}`, err.stack);
  }

  return c.json(
    {
      error: 'Internal Server Error',
      ...(isDev && { debug: err.message }),
    },
    500
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST METADATA HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract metadata from request (IP, user-agent, patient ID).
 * Validates patientId to prevent invalid values.
 */
function getMeta(c) {
  const patientIdRaw = c.req.header('x-patient-id') || '1';
  const patientId = parseInt(patientIdRaw, 10);

  // Validate patientId: must be a positive integer
  if (isNaN(patientId) || patientId < 1 || patientId > 999999) {
    console.warn(
      `[auth] Invalid patient ID in header: "${patientIdRaw}", defaulting to 1`
    );
    return {
      ip: c.req.header('cf-connecting-ip') ||
          c.req.header('x-forwarded-for') ||
          '0.0.0.0',
      ua: c.req.header('user-agent') || 'unknown',
      deviceId: c.req.header('x-device-id') || null,
      patientId: 1,
    };
  }

  return {
    ip: c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for') ||
        '0.0.0.0',
    ua: c.req.header('user-agent') || 'unknown',
    deviceId: c.req.header('x-device-id') || null,
    patientId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

// Public routes that do NOT require authentication
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/health',
  '/api/version',
  '/api/webauthn/available',
];

/**
 * Check if a path is public (no auth required).
 */
function isPublicPath(path) {
  // Exact match
  if (PUBLIC_PATHS.includes(path)) return true;

  // Prefix match for webauthn login flow
  if (path.startsWith('/api/webauthn/login')) return true;

  return false;
}

/**
 * Authentication middleware for protected routes.
 * Verifies session token and populates c.set('patientId') and c.set('session').
 */
const authMiddleware = async (c, next) => {
  const path = c.req.path;

  // Skip auth for public paths
  if (isPublicPath(path)) {
    return await next();
  }

  // Extract token from header, Authorization header, query, or cookie
  const token =
    c.req.header('X-Session-Token') ||
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.query('token') ||
    getCookie(c, 'session');

  if (!token) {
    return c.json({ error: 'Unauthorized: missing session token' }, 401);
  }

  // Validate session
  const config = c.get('config');
  const session = await authSession.getSession(config.database, token);
  if (!session) {
    return c.json({ error: 'Unauthorized: invalid session' }, 401);
  }

  // Update session activity (don't await — fire and forget)
  const ip = getMeta(c).ip;
  c.executionCtx.waitUntil(
    authSession.touchSession(config.database, token, ip)
  );

  // Attach session to context
  c.set('patientId', session.patient_id);
  c.set('session', session);

  return await next();
};

app.use('/api/*', authMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Admin authorization middleware.
 * Checks X-Admin-Token header against config.adminToken.
 */
app.use('/api/admin/*', async (c, next) => {
  const config = c.get('config');
  const adminToken = c.req.header('X-Admin-Token');

  if (!config.adminToken) {
    // Admin token not configured
    return c.json(
      { error: 'Forbidden: admin token not configured' },
      403
    );
  }

  if (adminToken !== config.adminToken) {
    return c.json({ error: 'Forbidden: invalid admin token' }, 403);
  }

  return await next();
});

// ═══════════════════════════════════════════════════════════════════════════
// PDF EXPORT (unprotected, but requires valid session token in query)
// ═══════════════════════════════════════════════════════════════════════════

function esc(text) {
  if (!text && text !== 0) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  const config = c.get('config');
  const session = await authSession.getSession(config.database, token);
  if (!session || session.patient_id !== pid)
    return c.text('Unauthorized', 401);

  // Fetch data
  const [p, ds, ms, ts] = await Promise.all([
    config.database
      .prepare('SELECT * FROM patient WHERE id = ?')
      .bind(pid)
      .first(),
    config.database
      .prepare(
        'SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY status ASC, created_at DESC'
      )
      .bind(pid)
      .all(),
    config.database
      .prepare(
        'SELECT * FROM medications WHERE patient_id = ? ORDER BY status ASC, created_at DESC'
      )
      .bind(pid)
      .all(),
    config.database
      .prepare(
        'SELECT * FROM timeline WHERE patient_id = ? ORDER BY event_date DESC'
      )
      .bind(pid)
      .all(),
  ]);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Отчёт: ${esc(
    p.full_name
  )}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:20px auto;padding:20px;line-height:1.4;}h1{border-bottom:2px solid #007AFF;}h2{margin-top:30px;color:#333;}.section{margin-top:20px;padding:10px;background:#f9f9f9;border-left:4px solid #007AFF;}table{width:100%;border-collapse:collapse;margin-top:10px;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background:#f0f0f0;font-weight:bold;}.footer{color:#999;font-size:12px;margin-top:40px;border-top:1px solid #ddd;padding-top:20px;}</style>
</head><body>
<h1>Медицинский отчёт</h1>
<div class="section"><strong>Пациент:</strong> ${esc(
    p.full_name
  )}<br><strong>Дата рождения:</strong> ${formatDate(
    p.date_of_birth
  )}<br><strong>Пол:</strong> ${esc(p.gender)}<br><strong>Город:</strong> ${esc(
    p.city
  )}</div>
<h2>Диагнозы</h2><table><tr><th>Название</th><th>Статус</th></tr>${ds.results
    .map(
      (d) =>
        `<tr><td>${esc(d.name)}</td><td>${esc(d.status)}</td></tr>`
    )
    .join('')}</table>
<h2>Лекарства</h2><table><tr><th>Название</th><th>Дозировка</th><th>Статус</th></tr>${ms.results
    .map(
      (m) =>
        `<tr><td>${esc(m.name)}</td><td>${esc(
          m.dosage
        )}</td><td>${esc(m.status)}</td></tr>`
    )
    .join('')}</table>
<h2>История</h2><table><tr><th>Дата</th><th>Событие</th></tr>${ts.results
    .map(
      (t) =>
        `<tr><td>${formatDate(t.event_date)}</td><td>${esc(
          t.title
        )}</td></tr>`
    )
    .join('')}</table>
<div class="footer">Сформировано автоматически в Anamnesis. Убедитесь, что данные актуальны перед распечаткой.</div>
</body></html>`;

  return c.html(html, 200, {
    'Content-Type': 'text/html; charset=UTF-8',
    'Content-Disposition': `inline; filename="report_${pid}.html"`,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC SYSTEM ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/health', (c) => c.json({ status: 'ok', db: 'connected' }));
app.get('/api/version', (c) =>
  c.json({ version: '2.0.0-serverless', env: 'cloudflare-workers' })
);
app.get('/api/webauthn/available', (c) =>
  c.json({ available: false, message: 'WebAuthn not yet available' })
);
app.get('/api/auth/security-status', (c) =>
  c.json({ webauthn_enabled: false, lockout_active: false })
);

// ═══════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/auth/login', async (c) => {
  const { pin } = await c.req.json();
  const meta = getMeta(c);

  try {
    const config = c.get('config');

    // Check rate limiting
    const lockout = await authSession.checkLockout(
      config.database,
      meta.ip,
      meta.deviceId
    );
    if (lockout.locked) {
      return c.json(
        { error: 'Too many attempts. Try again later.' },
        429
      );
    }

    // Verify PIN
    const storedHash = await config.database
      .prepare(
        'SELECT value FROM app_settings WHERE key = ?'
      )
      .bind(`pin_hash_${meta.patientId}`)
      .first('value');

    if (!storedHash) {
      return c.json({ error: 'PIN not configured' }, 500);
    }

    const pinValid = await authSession.verifyPin(pin, storedHash);
    if (!pinValid) {
      await authSession.recordAuthFailure(
        config.database,
        meta.ip,
        meta.deviceId,
        meta.patientId
      );
      return c.json({ error: 'Invalid PIN' }, 401);
    }

    // Reset failures and create session
    await authSession.resetAuthFailures(
      config.database,
      meta.ip,
      meta.deviceId
    );
    const token = await authSession.createSession(
      config.database,
      meta.patientId,
      meta.ip,
      meta.ua,
      meta.deviceId
    );

    return c.json({ token, expires_days: config.sessionMaxAgeDays });
  } catch (err) {
    return c.json({ error: 'Login error' }, 500);
  }
});

app.get('/api/auth/check', async (c) => {
  const session = c.get('session');
  return c.json({
    ok: true,
    patient_id: session.patient_id,
    expires_at: session.expires_at,
  });
});

app.post('/api/auth/logout', async (c) => {
  const token =
    c.req.header('X-Session-Token') ||
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    getCookie(c, 'session');

  if (token) {
    const config = c.get('config');
    await config.database
      .prepare('UPDATE sessions SET revoked = 1 WHERE token = ?')
      .bind(token)
      .run();
  }

  return c.json({ message: 'Logged out' });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/webauthn/credentials', (c) => c.json([]));

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
