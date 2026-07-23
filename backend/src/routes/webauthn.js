import { Hono } from 'hono';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import * as authSession from '../services/auth-session';
import * as telegram from '../services/telegram';

const webauthn = new Hono();

// Helpers for IP and User Agent in Hono
const getClientIp = (c) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0';
const getUserAgent = (c) => c.req.header('user-agent') || 'unknown';

// Challenge management in D1 (app_settings)
async function saveChallenge(db, key, value) {
  const expires = Date.now() + 5 * 60 * 1000;
  await db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)"
  ).bind(`webauthn_challenge_${key}`, JSON.stringify({ value, expires })).run();
}

async function getChallenge(db, key) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`webauthn_challenge_${key}`).first();
  if (!row) return null;
  const data = JSON.parse(row.value);
  if (data.expires < Date.now()) {
    await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(`webauthn_challenge_${key}`).run();
    return null;
  }
  return data.value;
}

async function deleteChallenge(db, key) {
  await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(`webauthn_challenge_${key}`).run();
}

// ─── Registration ──────────────────────────────────────────

webauthn.get('/register/options', async (c) => {
  const db = c.env.DB;
  const patientId = c.get('patientId');
  const deviceId = c.req.header('x-device-id');

  if (!deviceId) return c.json({ error: 'device_id required' }, 400);

  try {
    const existing = await db.prepare(
      "SELECT credential_id FROM webauthn_credentials WHERE patient_id = ?"
    ).bind(patientId).all();

    const patient = await db.prepare('SELECT full_name FROM patient WHERE id = ?').bind(patientId).first();

    const options = await generateRegistrationOptions({
      rpName: c.env.WEBAUTHN_RP_NAME || 'Anamnesis',
      rpID: c.env.WEBAUTHN_RP_ID || 'localhost',
      userName: patient?.full_name || `patient_${patientId}`,
      userID: new TextEncoder().encode(String(patientId)),
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      excludeCredentials: existing.results.map(c => ({ id: c.credential_id })),
      supportedAlgorithmIDs: [-7, -257],
    });

    await saveChallenge(db, `reg_${deviceId}`, options.challenge);
    return c.json(options);
  } catch (err) {
    console.error('[webauthn] register options error:', err);
    return c.json({ error: 'Ошибка подготовки регистрации' }, 500);
  }
});

webauthn.post('/register/verify', async (c) => {
  const db = c.env.DB;
  const patientId = c.get('patientId');
  const deviceId = c.req.header('x-device-id');
  const { response, nickname } = await c.req.json();

  if (!deviceId) return c.json({ error: 'device_id required' }, 400);

  const expectedChallenge = await getChallenge(db, `reg_${deviceId}`);
  if (!expectedChallenge) return c.json({ error: 'Challenge истёк, повтори попытку' }, 400);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: c.env.WEBAUTHN_ORIGIN || (c.env.WEBAUTHN_RP_ID === 'localhost' ? 'http://localhost:5173' : `https://${c.env.WEBAUTHN_RP_ID}`),
      expectedRPID: c.env.WEBAUTHN_RP_ID || 'localhost',
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Верификация не прошла' }, 400);
    }

    const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64');

    await db.prepare(`
      INSERT INTO webauthn_credentials
        (patient_id, device_id, credential_id, public_key, counter, transports, backed_up, device_type, nickname)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      patientId,
      deviceId,
      credential.id,
      publicKeyBase64,
      credential.counter || 0,
      response.response?.transports ? JSON.stringify(response.response.transports) : null,
      credentialBackedUp ? 1 : 0,
      credentialDeviceType || null,
      (nickname || '').slice(0, 60) || null
    ).run();

    await deleteChallenge(db, `reg_${deviceId}`);

    // Telegram notification
    const clientIp = getClientIp(c);
    const esc = (s) => String(s || '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
    telegram.sendMessage(c.env, 
      `<b>[BIOMETRY ADDED]</b>\n\n` +
      `На устройстве теперь можно входить через Face ID / Touch ID вместо PIN.\n\n` +
      `• IP: <code>${esc(clientIp)}</code>\n` +
      `• Название: <b>${esc(nickname || 'Без названия')}</b>\n` +
      `• Тип: ${esc(credentialDeviceType || 'unknown')}${credentialBackedUp ? ' (синхронизируется)' : ''}\n` +
      `• Время: ${new Date().toLocaleString('ru-RU')}`
    ).catch(() => {});

    return c.json({ ok: true, credential_id: credential.id });
  } catch (err) {
    console.error('[webauthn] register verify error:', err);
    return c.json({ error: err.message || 'Ошибка верификации' }, 400);
  }
});

// ─── Authentication ───────────────────────────────────────

webauthn.get('/login/options', async (c) => {
  const db = c.env.DB;
  const deviceId = c.req.header('x-device-id');

  if (!deviceId) return c.json({ error: 'device_id required' }, 400);

  try {
    const creds = await db.prepare(
      "SELECT credential_id, transports FROM webauthn_credentials WHERE device_id = ?"
    ).bind(deviceId).all();

    if (creds.results.length === 0) {
      return c.json({ error: 'Для этого устройства нет зарегистрированных passkey' }, 404);
    }

    const options = await generateAuthenticationOptions({
      rpID: c.env.WEBAUTHN_RP_ID || 'localhost',
      allowCredentials: creds.results.map(c => ({
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      userVerification: 'required',
    });

    await saveChallenge(db, `auth_${deviceId}`, options.challenge);
    return c.json(options);
  } catch (err) {
    console.error('[webauthn] login options error:', err);
    return c.json({ error: 'Ошибка подготовки входа' }, 500);
  }
});

webauthn.post('/login/verify', async (c) => {
  const db = c.env.DB;
  const ip = getClientIp(c);
  const ua = getUserAgent(c);
  const deviceId = c.req.header('x-device-id');
  const { response } = await c.req.json();

  if (!deviceId) return c.json({ error: 'device_id required' }, 400);

  const lockout = await authSession.checkLockout(db, ip, deviceId);
  if (lockout.locked) {
    return c.json({ error: 'Слишком много попыток', remaining_sec: Math.ceil(lockout.remainingMs / 1000) }, 429);
  }

  const expectedChallenge = await getChallenge(db, `auth_${deviceId}`);
  if (!expectedChallenge) return c.json({ error: 'Challenge истёк' }, 400);

  try {
    const credentialRow = await db.prepare(
      "SELECT * FROM webauthn_credentials WHERE credential_id = ?"
    ).bind(response.id).first();

    if (!credentialRow) {
      await authSession.recordAuthFailure(db, ip, deviceId, null);
      return c.json({ error: 'Credential не найден' }, 404);
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: c.env.WEBAUTHN_ORIGIN || (c.env.WEBAUTHN_RP_ID === 'localhost' ? 'http://localhost:5173' : `https://${c.env.WEBAUTHN_RP_ID}`),
      expectedRPID: c.env.WEBAUTHN_RP_ID || 'localhost',
      credential: {
        id: credentialRow.credential_id,
        publicKey: new Uint8Array(Buffer.from(credentialRow.public_key, 'base64')),
        counter: credentialRow.counter,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      await authSession.recordAuthFailure(db, ip, deviceId, credentialRow.patient_id);
      return c.json({ error: 'Верификация не прошла' }, 401);
    }

    await db.prepare(
      "UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE credential_id = ?"
    ).bind(verification.authenticationInfo.newCounter, credentialRow.credential_id).run();

    await deleteChallenge(db, `auth_${deviceId}`);
    await authSession.resetAuthFailures(db, ip, deviceId);

    const token = await authSession.createSession(db, credentialRow.patient_id, ip, ua, deviceId);
    
    return c.json({
      token,
      expires_days: 14,
      device_trusted: true,
      via: 'webauthn',
    });
  } catch (err) {
    console.error('[webauthn] login verify error:', err);
    return c.json({ error: err.message || 'Ошибка верификации' }, 400);
  }
});

// GET /api/webauthn/available — есть ли passkeys для текущего устройства
webauthn.get('/available', async (c) => {
  const deviceId = c.req.header('x-device-id');
  if (!deviceId) return c.json({ available: false });

  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS c FROM webauthn_credentials WHERE device_id = ?"
  ).bind(deviceId).first();

  return c.json({ available: (row?.c || 0) > 0, count: row?.c || 0 });
});

export default webauthn;
