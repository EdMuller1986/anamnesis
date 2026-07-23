const crypto = require('crypto');
const config = require('../config');

// Constant-time сравнение токенов — защита от timing attack
function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Базовая Bearer-проверка на все /api/* маршруты.
 * Принимает API_TOKEN ИЛИ ADMIN_TOKEN (ADMIN — более сильный,
 * логично пропускать там где достаточно API).
 * Если API_TOKEN в .env не задан — пропускает всех (dev mode).
 */
function authMiddleware(req, res, next) {
  const apiToken = config.API_TOKEN;
  const adminToken = config.ADMIN_TOKEN;

  // Dev mode: токены не настроены — авторизация отключена (только session)
  if (!apiToken && !adminToken) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const provided = authHeader.slice(7);
  if (safeEqual(provided, apiToken) || safeEqual(provided, adminToken)) {
    return next();
  }
  return res.status(403).json({ error: 'Неверный токен' });
}

/**
 * Строгая проверка для admin endpoints — только ADMIN_TOKEN.
 * API_TOKEN (если настроен) НЕ даёт доступа к админке чтобы
 * разделить уровни: компрометация API_TOKEN не даёт админ-доступ.
 */
function adminAuthMiddleware(req, res, next) {
  const adminToken = config.ADMIN_TOKEN;

  // Dev mode: токен не настроен — пропускаем
  if (!adminToken) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация администратора' });
  }

  const provided = authHeader.slice(7);
  if (safeEqual(provided, adminToken)) {
    return next();
  }
  return res.status(403).json({ error: 'Недостаточно прав' });
}

module.exports = { authMiddleware, adminAuthMiddleware };
