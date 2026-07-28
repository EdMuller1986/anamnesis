// Auth + Session management for Cloudflare Workers (D1 + Web Crypto)

const PBKDF2_ITERATIONS = 100000;
const SESSION_MAX_AGE_DAYS = 14;
const SESSION_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Хеширование значения (PIN или контрольное слово) через PBKDF2.
 */
export async function hashValue(value) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(value)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256
  );

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(hash));
  return `${saltHex}$${PBKDF2_ITERATIONS}$${hashHex}`;
}

/**
 * Проверка соответствия значения хешу.
 */
export async function verifyValue(value, stored) {
  if (!stored || !stored.includes('$')) return false;
  const [saltHex, iterations, hashHex] = stored.split('$');
  const salt = hexToBytes(saltHex);
  const iterationsCount = parseInt(iterations, 10);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(value)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterationsCount,
      hash: 'SHA-256',
    },
    key,
    256
  );

  const actualHashHex = bytesToHex(new Uint8Array(hash));
  return actualHashHex === hashHex;
}

// Alias for backward compatibility if needed, though we'll update calls
export const hashPin = hashValue;
export const verifyPin = verifyValue;

export async function createSession(db, patientId, ip, ua, deviceId) {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();

  await db.prepare(
    `INSERT INTO sessions (token, patient_id, device_id, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(token, patientId, deviceId, expiresAt, ip, ua).run();

  // Также обновляем/создаем запись в known_devices
  if (deviceId) {
    await db.prepare(`
      INSERT INTO known_devices (device_id, patient_id, last_ip, user_agent, last_seen_at, revoked)
      VALUES (?, ?, ?, ?, datetime('now'), 0)
      ON CONFLICT(device_id, patient_id) DO UPDATE SET
        last_ip = excluded.last_ip,
        user_agent = excluded.user_agent,
        last_seen_at = excluded.last_seen_at,
        revoked = 0
    `).bind(deviceId, patientId, ip, ua).run();
  }

  return token;
}

export async function getSession(db, token) {
  return await db.prepare(
    'SELECT * FROM sessions WHERE token = ? AND revoked = 0 AND expires_at > datetime("now")'
  ).bind(token).first();
}

export async function touchSession(db, token, ip) {
  await db.prepare(
    'UPDATE sessions SET last_seen_at = datetime("now"), ip = ? WHERE token = ?'
  ).bind(ip, token).run();
}

/**
 * Разлогинить все сессии пациента, кроме указанной.
 */
export async function revokeAllOtherSessions(db, patientId, exceptToken) {
  await db.prepare(
    'UPDATE sessions SET revoked = 1 WHERE patient_id = ? AND token != ?'
  ).bind(patientId, exceptToken).run();
}

// Lockout logic (simplified for Worker context)
export async function checkLockout(db, ip, deviceId) {
  const key = `${ip}:${deviceId || '-'}`;
  const row = await db.prepare(
    'SELECT * FROM auth_lockouts WHERE lockout_key = ?'
  ).bind(key).first();

  if (!row || !row.locked_until) return { locked: false };

  const lockedUntil = new Date(row.locked_until).getTime();
  if (lockedUntil > Date.now()) {
    return { locked: true, remainingMs: lockedUntil - Date.now(), attempts: row.attempts };
  }

  return { locked: false };
}

export async function recordAuthFailure(db, ip, deviceId, patientId) {
  const key = `${ip}:${deviceId || '-'}`;
  const row = await db.prepare(
    'SELECT attempts FROM auth_lockouts WHERE lockout_key = ?'
  ).bind(key).first();

  const attempts = (row?.attempts || 0) + 1;
  let lockedUntil = null;

  if (attempts >= 3) {
    const lockoutMinutes = Math.min(2 ** (attempts - 3), 1440); // Max 24h
    lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000).toISOString();
  }

  await db.prepare(
    `INSERT INTO auth_lockouts (lockout_key, ip, device_id, patient_id, attempts, last_fail_at, locked_until)
     VALUES (?, ?, ?, ?, ?, datetime("now"), ?)
     ON CONFLICT(lockout_key) DO UPDATE SET
       attempts = excluded.attempts,
       last_fail_at = excluded.last_fail_at,
       locked_until = excluded.locked_until,
       updated_at = datetime("now")`
  ).bind(key, ip, deviceId, patientId, attempts, lockedUntil).run();

  return { attempts, locked: !!lockedUntil, remainingMs: lockedUntil ? new Date(lockedUntil).getTime() - Date.now() : 0 };
}

export async function resetAuthFailures(db, ip, deviceId) {
  const key = `${ip}:${deviceId || '-'}`;
  await db.prepare('DELETE FROM auth_lockouts WHERE lockout_key = ?').bind(key).run();
}

// Helper functions for Hex
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
