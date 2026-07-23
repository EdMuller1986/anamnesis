// backend/src/config.js
// Configuration for Cloudflare Workers + D1
// No dotenv — variables come from wrangler.toml [vars] and secrets

/**
 * Get configuration from Cloudflare Workers environment.
 * @param {Object} env - Hono context.env (from c.env in request handler)
 * @returns {Object} Configuration object
 */
export function getConfig(env) {
  // Validate critical settings
  if (!env.DB) {
    throw new Error('D1 database binding "DB" not configured in wrangler.toml');
  }

  return {
    // Database
    database: env.DB,

    // CORS
    corsOrigins: env.CORS_ORIGINS || '*',

    // Backblaze B2 for file storage
    b2: {
      endpoint: env.B2_ENDPOINT,
      bucketName: env.B2_BUCKET_NAME,
      keyId: env.B2_KEY_ID,
      // Application key comes from wrangler secret (not env.var)
      // Access via: await c.env.B2_APPLICATION_KEY
    },

    // Admin token for privileged operations
    // Generate: openssl rand -hex 32
    adminToken: env.ADMIN_TOKEN,

    // Sessions
    sessionMaxAgeDays: parseInt(env.SESSION_MAX_AGE_DAYS || '14', 10),

    // Environment
    isDevelopment: env.ENVIRONMENT === 'development',
  };
}

/**
 * Validate that required B2 credentials are present.
 * Call this during app initialization.
 */
export function validateB2Config(config) {
  const missing = [];
  if (!config.b2.endpoint) missing.push('B2_ENDPOINT');
  if (!config.b2.bucketName) missing.push('B2_BUCKET_NAME');
  if (!config.b2.keyId) missing.push('B2_KEY_ID');
  // Note: B2_APPLICATION_KEY is a secret, accessed separately

  if (missing.length > 0) {
    console.warn(
      `[config] Missing B2 settings: ${missing.join(', ')}. ` +
      'Document uploads will fail. Set these in wrangler.toml [vars] or wrangler secret put.'
    );
  }
}
