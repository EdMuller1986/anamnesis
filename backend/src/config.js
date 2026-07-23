// Configuration for Anamnesis Serverless
// Note: In Cloudflare Workers, environment variables are accessed via c.env

export const defaults = {
  SESSION_MAX_AGE_DAYS: 14,
  CORS_ORIGINS: '*',
  NODE_ENV: 'production',
};

// This file is mostly legacy now as we use c.env directly in Hono routes.
export default defaults;
