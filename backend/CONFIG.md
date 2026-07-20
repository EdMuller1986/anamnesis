# Local Configuration Files

This directory may contain local configuration files that are **NOT** committed to git:

- `wrangler.toml.local` - Your personal Cloudflare Workers configuration with real database IDs and secrets
- `.env` - Local environment variables

These files are listed in `.gitignore` to prevent accidental commits of sensitive data.

## Setup

1. Copy the template:
   ```bash
   cp wrangler.toml wrangler.toml.local
   ```

2. Edit `wrangler.toml.local` and replace all placeholders with your real values:
   - `YOUR_D1_DATABASE_ID` → your Cloudflare D1 database ID
   - `YOUR_BUCKET_NAME` → your Backblaze B2 bucket name
   - `YOUR_KEY_ID` → your B2 key ID

3. Set secrets via wrangler CLI:
   ```bash
   wrangler secret put B2_APPLICATION_KEY
   ```

4. Deploy using your local config:
   ```bash
   wrangler deploy --config wrangler.toml.local
   ```

## Why two files?

- `wrangler.toml` - Template with placeholders, safe to commit
- `wrangler.toml.local` - Your real config, NEVER committed (gitignored)

This approach allows the repository to be public while keeping your secrets private.
