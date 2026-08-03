/**
 * Simple D1-backed sliding-window rate limit for Worker (shared across isolates eventually).
 * Falls back to no-op if table missing.
 */

const DEFAULT_WINDOW_SEC = 60;
const DEFAULT_MAX = 120; // requests per window per key

/**
 * @returns {{ allowed: true } | { allowed: false, retryAfterSec: number }}
 */
export async function checkRateLimit(db, key, { windowSec = DEFAULT_WINDOW_SEC, max = DEFAULT_MAX } = {}) {
  if (!db || !key) return { allowed: true };

  try {
    const row = await db.prepare(
      'SELECT window_start, hit_count FROM rate_limits WHERE rate_key = ?'
    ).bind(key).first();

    const now = Date.now();
    const windowMs = windowSec * 1000;

    if (!row) {
      await db.prepare(
        `INSERT INTO rate_limits (rate_key, window_start, hit_count, updated_at)
         VALUES (?, ?, 1, datetime('now'))`
      ).bind(key, String(now)).run();
      return { allowed: true };
    }

    const start = parseInt(row.window_start, 10) || 0;
    let count = row.hit_count || 0;

    if (now - start > windowMs) {
      await db.prepare(
        `UPDATE rate_limits SET window_start = ?, hit_count = 1, updated_at = datetime('now') WHERE rate_key = ?`
      ).bind(String(now), key).run();
      return { allowed: true };
    }

    count += 1;
    if (count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - start)) / 1000));
      return { allowed: false, retryAfterSec };
    }

    await db.prepare(
      `UPDATE rate_limits SET hit_count = ?, updated_at = datetime('now') WHERE rate_key = ?`
    ).bind(count, key).run();
    return { allowed: true };
  } catch (e) {
    console.warn('[rate_limit]', e.message);
    return { allowed: true };
  }
}

export function clientRateKey(c, prefix = 'api') {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0';
  return `${prefix}:${ip.split(',')[0].trim()}`;
}
