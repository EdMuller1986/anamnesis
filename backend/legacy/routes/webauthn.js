// WebAuthn / Passkey routes — биометрический fast-path для входа.
//
// Поток регистрации:
//   1. GET  /api/webauthn/register/options     — клиент получает challenge + server info
//   2. Клиент: navigator.credentials.create() → получает attestation
//   3. POST /api/webauthn/register/verify      — сервер проверяет и сохраняет credential
//
// Поток входа (fast-path, вместо PIN):
//   1. GET  /api/webauthn/login/options         — получаем challenge + allow list для device
//   2. Клиент: navigator.credentials.get() → получает assertion
//   3. POST /api/webauthn/login/verify          — сервер проверяет → сессия
//
// Требования:
//   - Вход в WebAuthn разрешён ТОЛЬКО с уже зарегистрированного device_id
//     (credential привязан к конкретному устройству)
//   - При смене PIN / revoke-device credentials этого устройства тоже удаляются
//   - При потере credential → fallback на обычный PIN+контрольное слово

const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const { rawDb } = require('../db');
const authSession = require('../services/auth-session');
const telegram = require('../services/telegram');

const router = express.Router();

// rpID — домен (без протокола и порта). rpName — отображаемое имя.
// origin — полный origin с протоколом (клиентский)
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Anamnesis';
// rpID должен совпадать с доменом сайта (без протокола/порта).
// Для локальной разработки используй 'localhost'; для прода — твой реальный домен.
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const EXPECTED_ORIGIN = process.env.WEBAUTHN_ORIGIN
  || (RP_ID === 'localhost' ? 'http://localhost:5173' : `https://${RP_ID}`);

function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket?.remoteAddress || null;
}
function userAgent(req) {
  return req.headers['user-agent']?.slice(0, 300) || null;
}

// Временное хранилище challenges — живут 5 минут
function saveChallenge(key, value) {
  const expires = Date.now() + 5 * 60 * 1000;
  rawDb.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)"
  ).run(`webauthn_challenge_${key}`, JSON.stringify({ value, expires }));
}

function getChallenge(key) {
  const row = rawDb.prepare("SELECT value FROM app_settings WHERE key = ?").get(`webauthn_challenge_${key}`);
  if (!row) return null;
  const data = JSON.parse(row.value);
  if (data.expires < Date.now()) {
    rawDb.prepare("DELETE FROM app_settings WHERE key = ?").run(`webauthn_challenge_${key}`);
    return null;
  }
  return data.value;
}

function deleteChallenge(key) {
  rawDb.prepare("DELETE FROM app_settings WHERE key = ?").run(`webauthn_challenge_${key}`);
}

// ─── Registration ──────────────────────────────────────────
// Требует активной сессии — нельзя регистрировать passkey без авторизации

router.get('/register/options', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const sess = authSession.getSession(token);
    if (!sess) return res.status(401).json({ error: 'Требуется авторизация' });

    const deviceId = req.headers['x-device-id'];
    if (!deviceId) return res.status(400).json({ error: 'device_id required' });

    // Проверяем что устройство зарегистрировано как trusted
    if (!authSession.isKnownDevice(deviceId, sess.patient_id)) {
      return res.status(400).json({ error: 'Устройство не зарегистрировано. Сначала пройди PIN + контрольное слово.' });
    }

    // Существующие credentials для этого пациента — исключаем из нового запроса
    const existing = rawDb.prepare(
      "SELECT credential_id FROM webauthn_credentials WHERE patient_id = ?"
    ).all(sess.patient_id);

    const patient = rawDb.prepare('SELECT full_name FROM patient WHERE id = ?').get(sess.patient_id);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: patient?.full_name || `patient_${sess.patient_id}`,
      userID: new TextEncoder().encode(String(sess.patient_id)),
      attestationType: 'none',
      authenticatorSelection: {
        // platform = biometric (Face ID / Touch ID / Windows Hello)
        // не cross-platform (usb key)
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      excludeCredentials: existing.map(c => ({ id: c.credential_id })),
      supportedAlgorithmIDs: [-7, -257], // ES256, RS256
    });

    saveChallenge(`reg_${deviceId}`, options.challenge);
    res.json(options);
  } catch (err) {
    console.error('[webauthn] register options error:', err);
    res.status(500).json({ error: 'Ошибка подготовки регистрации' });
  }
});

router.post('/register/verify', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const sess = authSession.getSession(token);
    if (!sess) return res.status(401).json({ error: 'Требуется авторизация' });

    const deviceId = req.headers['x-device-id'];
    if (!deviceId) return res.status(400).json({ error: 'device_id required' });

    const expectedChallenge = getChallenge(`reg_${deviceId}`);
    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge истёк, повтори попытку' });

    const { response, nickname } = req.body;
    if (!response) return res.status(400).json({ error: 'Нет attestation response' });

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Верификация не прошла' });
    }

    const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
    // @simplewebauthn/server v11: credential.id, credential.publicKey, credential.counter
    const credentialId = credential.id;
    const publicKey = Buffer.from(credential.publicKey).toString('base64url');

    rawDb.prepare(`
      INSERT INTO webauthn_credentials
        (patient_id, device_id, credential_id, public_key, counter, transports, backed_up, device_type, nickname)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sess.patient_id,
      deviceId,
      credentialId,
      publicKey,
      credential.counter || 0,
      response.response?.transports ? JSON.stringify(response.response.transports) : null,
      credentialBackedUp ? 1 : 0,
      credentialDeviceType || null,
      (nickname || '').slice(0, 60) || null
    );

    deleteChallenge(`reg_${deviceId}`);
    authSession.logAuthEvent('webauthn_registered', clientIp(req), userAgent(req), {
      patient_id: sess.patient_id, device_id: deviceId, credential_id: credentialId.slice(0, 12),
    });

    // Telegram уведомление о новой биометрии
    const esc = (s) => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    telegram.sendMessage(
      `<b>[BIOMETRY ADDED]</b>\n\n` +
      `На устройстве теперь можно входить через Face ID / Touch ID вместо PIN.\n\n` +
      `• IP: <code>${esc(clientIp(req) || 'unknown')}</code>\n` +
      `• Название: <b>${esc(nickname || 'Без названия')}</b>\n` +
      `• Тип: ${esc(credentialDeviceType || 'unknown')}${credentialBackedUp ? ' (синхронизируется)' : ''}\n` +
      `• Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`
    ).catch(() => {});

    res.json({ ok: true, credential_id: credentialId });
  } catch (err) {
    console.error('[webauthn] register verify error:', err);
    res.status(400).json({ error: err.message || 'Ошибка верификации' });
  }
});

// ─── Authentication (login fast-path) ─────────────────────

router.get('/login/options', async (req, res) => {
  try {
    // НЕ требует сессии — это как раз замена PIN login
    const deviceId = req.headers['x-device-id'];
    if (!deviceId) return res.status(400).json({ error: 'device_id required' });

    // Ищем credentials для этого устройства
    const creds = rawDb.prepare(
      "SELECT credential_id, transports FROM webauthn_credentials WHERE device_id = ?"
    ).all(deviceId);

    if (creds.length === 0) {
      return res.status(404).json({ error: 'Для этого устройства нет зарегистрированных passkey' });
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: creds.map(c => ({
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      userVerification: 'required',
    });

    saveChallenge(`auth_${deviceId}`, options.challenge);
    res.json(options);
  } catch (err) {
    console.error('[webauthn] login options error:', err);
    res.status(500).json({ error: 'Ошибка подготовки входа' });
  }
});

router.post('/login/verify', async (req, res) => {
  try {
    const ip = clientIp(req);
    const ua = userAgent(req);
    const deviceId = req.headers['x-device-id'];
    if (!deviceId) return res.status(400).json({ error: 'device_id required' });

    // Exponential backoff тоже применяется — не даём брутить через WebAuthn
    const lockout = authSession.checkLockout(ip, deviceId);
    if (lockout.locked) {
      return res.status(429).json({
        error: 'Слишком много попыток',
        remaining_sec: Math.ceil(lockout.remainingMs / 1000),
      });
    }

    const expectedChallenge = getChallenge(`auth_${deviceId}`);
    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge истёк' });

    const { response } = req.body;
    if (!response) return res.status(400).json({ error: 'Нет assertion response' });

    const credentialRow = rawDb.prepare(
      "SELECT * FROM webauthn_credentials WHERE credential_id = ?"
    ).get(response.id);

    if (!credentialRow) {
      authSession.recordAuthFailure(ip, deviceId, null);
      return res.status(404).json({ error: 'Credential не найден' });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credentialRow.credential_id,
        publicKey: Buffer.from(credentialRow.public_key, 'base64url'),
        counter: credentialRow.counter,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      authSession.recordAuthFailure(ip, deviceId, credentialRow.patient_id);
      authSession.logAuthEvent('webauthn_fail', ip, ua, {
        patient_id: credentialRow.patient_id, device_id: deviceId,
      });
      return res.status(401).json({ error: 'Верификация не прошла' });
    }

    // Обновляем counter (защита от replay)
    rawDb.prepare(
      "UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE credential_id = ?"
    ).run(verification.authenticationInfo.newCounter, credentialRow.credential_id);

    deleteChallenge(`auth_${deviceId}`);

    // Успех — но сначала проверим что устройство не отозвано
    // (защита от сценария: муж отозвал, жена кликнула Face ID на своём телефоне)
    const knownDeviceRow = rawDb.prepare(
      'SELECT revoked FROM known_devices WHERE device_id = ? AND patient_id = ?'
    ).get(deviceId, credentialRow.patient_id);
    if (knownDeviceRow?.revoked) {
      authSession.logAuthEvent('webauthn_blocked_revoked', ip, ua, {
        patient_id: credentialRow.patient_id, device_id: deviceId,
      });
      return res.status(403).json({
        error: 'Это устройство было отозвано владельцем. Обратитесь к нему для восстановления доступа.',
        device_revoked: true,
      });
    }

    authSession.touchDevice(deviceId, credentialRow.patient_id, ip);
    authSession.resetAuthFailures(ip, deviceId);
    const token = authSession.createSession(credentialRow.patient_id, ip, ua, deviceId);
    authSession.logAuthEvent('webauthn_success', ip, ua, {
      patient_id: credentialRow.patient_id, device_id: deviceId,
    });

    res.json({
      token,
      expires_days: authSession.SESSION_MAX_AGE_DAYS,
      device_trusted: true,
      via: 'webauthn',
    });
  } catch (err) {
    console.error('[webauthn] login verify error:', err);
    res.status(400).json({ error: err.message || 'Ошибка верификации' });
  }
});

// ─── Management ────────────────────────────────────────────

// GET /api/webauthn/credentials — список всех passkeys пациента
router.get('/credentials', (req, res) => {
  const token = req.headers['x-session-token'];
  const sess = authSession.getSession(token);
  if (!sess) return res.status(401).json({ error: 'Требуется авторизация' });

  const rows = rawDb.prepare(`
    SELECT id, device_id, nickname, device_type, backed_up, created_at, last_used_at,
           substr(credential_id, 1, 12) AS credential_short
    FROM webauthn_credentials
    WHERE patient_id = ?
    ORDER BY created_at DESC
  `).all(sess.patient_id);

  res.json({ credentials: rows });
});

// DELETE /api/webauthn/credentials/:id — удалить passkey
router.delete('/credentials/:id', (req, res) => {
  const token = req.headers['x-session-token'];
  const sess = authSession.getSession(token);
  if (!sess) return res.status(401).json({ error: 'Требуется авторизация' });

  const id = parseInt(req.params.id, 10);
  const info = rawDb.prepare(
    'DELETE FROM webauthn_credentials WHERE id = ? AND patient_id = ?'
  ).run(id, sess.patient_id);

  if (info.changes === 0) return res.status(404).json({ error: 'Credential не найден' });

  authSession.logAuthEvent('webauthn_deleted', clientIp(req), userAgent(req), {
    patient_id: sess.patient_id, credential_id: id,
  });
  res.json({ ok: true });
});

// GET /api/webauthn/available — есть ли passkeys для текущего устройства
// Используется PinScreen чтобы показать кнопку "Face ID" на экране входа
router.get('/available', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.json({ available: false });

  const count = rawDb.prepare(
    "SELECT COUNT(*) AS c FROM webauthn_credentials WHERE device_id = ?"
  ).get(deviceId).c;

  res.json({ available: count > 0, count });
});

module.exports = router;
