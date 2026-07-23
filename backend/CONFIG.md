# Backend Configuration Guide

## Initial Setup

### 1. Create Cloudflare D1 Database

```bash
cd backend
wrangler d1 create anamnesis_db
```

Copy the `database_id` from the output and replace `REPLACE_WITH_YOUR_DATABASE_ID` in `wrangler.toml`.

### 2. Set Up Backblaze B2

1. Create a [Backblaze B2 account](https://www.backblaze.com/b2/sign-up.html)
2. Create a bucket (e.g., `anamnesis-medical-docs`)
3. Create an Application Key with read/write permissions
4. Note down:
   - `B2_KEY_ID` (application key ID)
   - `B2_APPLICATION_KEY` (secret key)
   - Bucket name
   - Endpoint region (e.g., `s3.us-west-004.backblazeb2.com`)

### 3. Configure Secrets

```bash
# Store B2 credentials in Cloudflare Workers
wrangler secret put B2_KEY_ID
# Paste: your-key-id

wrangler secret put B2_APPLICATION_KEY
# Paste: your-application-key
```

### 4. Update wrangler.toml Variables

Edit `wrangler.toml` and set:
```toml
[vars]
CORS_ORIGINS = "https://yourdomain.com"  # Your production domain
B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"  # Your B2 region
B2_BUCKET_NAME = "anamnesis-medical-docs"  # Your bucket name
```

## Environment-Specific Configuration

### Local Development

Create `wrangler.toml.local` for local overrides (gitignored):

```toml
name = "anamnesis-backend-local"

[[d1_databases]]
binding = "DB"
database_name = "anamnesis_db"
database_id = "local-db-id-here"  # from 'wrangler d1 create'

[vars]
CORS_ORIGINS = "http://localhost:5173"
B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"
B2_BUCKET_NAME = "test-anamnesis-docs"
```

Run locally:
```bash
npm run dev
# Listens on http://localhost:8787
```

### Production Deployment

Secrets are stored in GitHub via:
1. Repository Settings → Secrets and variables → Actions
2. Add these secrets:
   - `CLOUDFLARE_API_TOKEN` (from Cloudflare dashboard)
   - `CLOUDFLARE_ACCOUNT_ID` (from Cloudflare dashboard)
   - `D1_DATABASE_ID` (database_id from Cloudflare D1)
   - `B2_KEY_ID` (Backblaze B2)
   - `B2_APPLICATION_KEY` (Backblaze B2)

The GitHub Actions workflow (`.github/workflows/cloudflare.yml`) will:
1. Fetch secrets
2. Build and deploy backend to Cloudflare Workers
3. Build and deploy frontend to Cloudflare Pages

## Database Migrations

Migrations are applied automatically when backend starts:

```bash
# Test locally first
wrangler d1 migrations apply anamnesis_db --local

# Apply to production
wrangler d1 migrations apply anamnesis_db
```

Migration files are in `backend/migrations/`:
- `0001_initial.sql` — base schema
- `0002_fix_missing_columns.sql` — fixes
- `0003_add_status_to_specialists.sql` — extensions
- etc.

## Security Notes

⚠️ **DO NOT**:
- Commit `wrangler.toml` with real credentials
- Share `B2_APPLICATION_KEY` or `CLOUDFLARE_API_TOKEN`
- Use `CORS_ORIGINS = "*"` in production

✅ **DO**:
- Use GitHub Secrets for all sensitive data
- Rotate B2 keys annually
- Keep `.gitignore` entries for `*.local` files
- Review access logs regularly

## Troubleshooting

### "database_id not found"
The `database_id` in `wrangler.toml` doesn't exist. Create a new database:
```bash
wrangler d1 create anamnesis_db
```

### "B2 authentication failed"
Check that B2 credentials are correct and the key hasn't expired:
```bash
wrangler secret list
# Should show B2_KEY_ID and B2_APPLICATION_KEY
```

### "CORS blocked"
Ensure `CORS_ORIGINS` in `wrangler.toml` matches your frontend domain.
For local dev: `http://localhost:5173`
