import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import * as authSession from '../services/auth-session';

const auth = new Hono();

const getClientIp = (c) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0';
const getUserAgent = (c) => c.req.header('user-agent') || 'unknown';

const getMeta = (c) => {
  const patientIdRaw = c.req.header('x-patient-id') || '1';
  let patientId = parseInt(patientIdRaw, 10);
  if (isNaN(patientId) || patientId <= 0) patientId = 1;

  return {
    ip: getClientIp(c),
    ua: getUserAgent(c),
    deviceId: c.req.header('x-device-id') || null,
    patientId
  };
};

/**
 * POST /api/auth/login
 * Фаза 1: Проверка ПИН-кода.
 */
auth.post('/login', async (c) => {
  const db = c.env.DB;
  const { pin } = await c.req.json();
  const { patientId, ip, ua, deviceId } = getMeta(c);

  try {
    const lockout = await authSession.checkLockout(db, ip, deviceId);
    if (lockout.locked) return c.json({ error: 'Too many attempts', remaining_sec: Math.ceil(lockout.remainingMs / 1000) }, 429);
    
    let storedHash = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`pin_hash_${patientId}`).first('value');

    // Bootstrap: seed PIN hash from APP_PIN secret/env on first login (fresh install)
    if (!storedHash) {
      const appPin = c.env.APP_PIN;
      if (appPin) {
        storedHash = await authSession.hashPin(String(appPin));
        await db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
          .bind(`pin_hash_${patientId}`, storedHash).run();
      } else {
        return c.json({ error: 'PIN not configured' }, 500);
      }
    }
    
    if (!(await authSession.verifyPin(pin, storedHash))) {
      const fail = await authSession.recordAuthFailure(db, ip, deviceId, patientId);
      return c.json({ error: 'Invalid PIN', attempts: fail.attempts }, 401);
    }

    await authSession.resetAuthFailures(db, ip, deviceId);

    // Проверка устройства
    if (deviceId) {
      const knownDevice = await db.prepare('SELECT revoked FROM known_devices WHERE device_id = ? AND patient_id = ?')
        .bind(deviceId, patientId).first();

      // Если устройство не заблокировано, но и не известно (или мы хотим принудительно спросить вопрос для новых)
      const answerHash = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`security_answer_hash_${patientId}`).first();
      
      if (!knownDevice && answerHash) {
        const question = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`security_question_${patientId}`).first();
        // Генерируем временный токен-челлендж
        const challengeToken = crypto.randomUUID();
        await db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
          .bind(`auth_challenge_${challengeToken}`, JSON.stringify({ patientId, deviceId, expires: Date.now() + 5 * 60 * 1000 }))
          .run();

        return c.json({
          requires_answer: true,
          question: question?.value || 'Контрольное слово',
          challenge_token: challengeToken
        });
      }
      
      if (knownDevice?.revoked) {
        return c.json({ error: 'Это устройство было отозвано владельцем', device_revoked: true }, 403);
      }
    }

    const token = await authSession.createSession(db, patientId, ip, ua, deviceId);
    return c.json({ token, expires_days: 14 });
  } catch (err) {
    return c.json({ error: 'Login error', message: err.message }, 500);
  }
});

/**
 * POST /api/auth/verify-device
 * Фаза 2: Проверка контрольного слова.
 */
auth.post('/verify-device', async (c) => {
  const db = c.env.DB;
  const { challenge_token, answer, device_label } = await c.req.json();
  const { ip, ua } = getMeta(c);

  if (!challenge_token || !answer) return c.json({ error: 'challenge_token and answer are required' }, 400);

  const challengeRow = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`auth_challenge_${challenge_token}`).first();
  if (!challengeRow) return c.json({ error: 'Challenge expired or invalid' }, 400);

  const challengeData = JSON.parse(challengeRow.value);
  if (challengeData.expires < Date.now()) {
    await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(`auth_challenge_${challenge_token}`).run();
    return c.json({ error: 'Challenge expired' }, 400);
  }

  const { patientId, deviceId } = challengeData;

  const lockout = await authSession.checkLockout(db, ip, deviceId);
  if (lockout.locked) {
    return c.json({ error: 'Too many attempts', remaining_sec: Math.ceil(lockout.remainingMs / 1000) }, 429);
  }

  // Do not re-trust a revoked device via control-word path
  if (deviceId && await authSession.isDeviceRevoked(db, deviceId, patientId)) {
    await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(`auth_challenge_${challenge_token}`).run();
    return c.json({ error: 'Это устройство было отозвано владельцем', device_revoked: true }, 403);
  }

  const storedHash = await db.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(`security_answer_hash_${patientId}`).first('value');

  if (!storedHash || !(await authSession.verifyValue(answer.trim().toLowerCase(), storedHash))) {
    const fail = await authSession.recordAuthFailure(db, ip, deviceId, patientId);
    // Invalidate challenge so answer cannot be brute-forced for 5 minutes without re-login
    await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(`auth_challenge_${challenge_token}`).run();
    return c.json({
      error: 'Неверное контрольное слово',
      attempts: fail.attempts,
      challenge_invalidated: true,
    }, 401);
  }

  // Успех! Создаем сессию и помечаем устройство как доверенное
  await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(`auth_challenge_${challenge_token}`).run();
  await authSession.resetAuthFailures(db, ip, deviceId);
  
  if (deviceId) {
    // Explicit trust path: set revoked = 0 only after correct security answer (device was never revoked, or was new)
    await db.prepare(`
      INSERT INTO known_devices (device_id, patient_id, label, last_ip, user_agent, last_seen_at, revoked)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 0)
      ON CONFLICT(device_id, patient_id) DO UPDATE SET
        label = COALESCE(excluded.label, known_devices.label),
        last_ip = excluded.last_ip,
        user_agent = excluded.user_agent,
        last_seen_at = excluded.last_seen_at,
        revoked = 0
    `).bind(deviceId, patientId, device_label || null, ip, ua).run();
  }

  const token = await authSession.createSession(db, patientId, ip, ua, deviceId);
  return c.json({ token, device_trusted: true });
});

/**
 * GET /api/auth/security-status
 */
auth.get('/security-status', async (c) => {
  const db = c.env.DB;
  const patientId = c.get('patientId');

  const [questionRow, answerRow, devices] = await Promise.all([
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`security_question_${patientId}`).first(),
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(`security_answer_hash_${patientId}`).first(),
    db.prepare('SELECT * FROM known_devices WHERE patient_id = ? AND revoked = 0 ORDER BY last_seen_at DESC').bind(patientId).all()
  ]);

  return c.json({
    has_security_question: !!answerRow,
    question: questionRow?.value || null,
    devices: devices.results || []
  });
});

/**
 * POST /api/auth/revoke-device
 */
auth.post('/revoke-device', async (c) => {
  const db = c.env.DB;
  const patientId = c.get('patientId');
  const { device_id } = await c.req.json();

  if (!device_id) return c.json({ error: 'device_id is required' }, 400);

  await db.prepare('UPDATE known_devices SET revoked = 1 WHERE device_id = ? AND patient_id = ?')
    .bind(device_id, patientId).run();

  await db.prepare('UPDATE sessions SET revoked = 1 WHERE device_id = ? AND patient_id = ?')
    .bind(device_id, patientId).run();

  return c.json({ ok: true });
});

/**
 * POST /api/auth/logout-all
 */
auth.post('/logout-all', async (c) => {
  const db = c.env.DB;
  const patientId = c.get('patientId');
  const currentToken = c.req.header('X-Session-Token') || 
                       c.req.header('Authorization')?.replace('Bearer ', '') ||
                       getCookie(c, 'session');

  await authSession.revokeAllOtherSessions(db, patientId, currentToken);

  return c.json({ ok: true });
});

/**
 * POST /api/auth/change-pin
 */
auth.post('/change-pin', async (c) => {
  const db = c.env.DB;
  const patientId = c.get('patientId');
  const currentToken = c.req.header('X-Session-Token') || 
                       c.req.header('Authorization')?.replace('Bearer ', '') ||
                       getCookie(c, 'session');
  const { old_pin, new_pin } = await c.req.json();

  if (!old_pin || !new_pin) return c.json({ error: 'old_pin and new_pin are required' }, 400);

  const storedHash = await db.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(`pin_hash_${patientId}`).first('value');
  
  if (!storedHash || !(await authSession.verifyPin(old_pin, storedHash))) {
    return c.json({ error: 'Неверный текущий PIN' }, 401);
  }

  const newHash = await authSession.hashPin(new_pin);
  await db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
    .bind(`pin_hash_${patientId}`, newHash).run();

  await authSession.revokeAllOtherSessions(db, patientId, currentToken);

  return c.json({ ok: true, token: currentToken });
});

/**
 * POST /api/auth/set-security-question
 */
auth.post('/set-security-question', async (c) => {
  const db = c.env.DB;
  const patientId = c.get('patientId');
  const { question, answer } = await c.req.json();

  if (!answer) return c.json({ error: 'answer is required' }, 400);

  const answerHash = await authSession.hashValue(answer.trim().toLowerCase());
  
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      .bind(`security_question_${patientId}`, question || 'Контрольное слово'),
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      .bind(`security_answer_hash_${patientId}`, answerHash)
  ]);

  return c.json({ ok: true });
});

/**
 * GET /api/auth/check
 */
auth.get('/check', async (c) => {
  const session = c.get('session');
  if (!session) return c.json({ ok: false }, 401);
  return c.json({ ok: true, patient_id: session.patient_id, expires_at: session.expires_at });
});

/**
 * POST /api/auth/logout
 */
auth.post('/logout', async (c) => {
  const token = c.req.header('X-Session-Token') || 
                c.req.header('Authorization')?.replace('Bearer ', '') ||
                getCookie(c, 'session');
  if (token) await c.env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE token = ?').bind(token).run();
  return c.json({ message: 'Logged out' });
});

export default auth;
