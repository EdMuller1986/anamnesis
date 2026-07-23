# Local Development Guide

## Prerequisites

- Node.js 18+ (LTS)
- npm or yarn
- Cloudflare account (free tier OK)
- Wrangler CLI: `npm install -g wrangler`

## Backend Setup (Cloudflare Workers + D1)

### 1. Initialize D1 Database Locally

```bash
cd backend
npm install

# Create local D1 database
wrangler d1 create anamnesis_db --local
```

This generates `.wrangler/state/v3/d1/` with a local SQLite database.

### 2. Create wrangler.toml.local

Copy the `database_id` from the output above and create `backend/wrangler.toml.local`:

```toml
# .gitignored local override
name = "anamnesis-backend-local"
main = "src/index.js"
compatibility_date = "2024-05-02"

[[d1_databases]]
binding = "DB"
database_name = "anamnesis_db"
database_id = "<paste-your-local-database-id>"

[vars]
CORS_ORIGINS = "http://localhost:5173"
B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"
B2_BUCKET_NAME = "test-bucket"  # Use a test bucket
ENVIRONMENT = "development"
```

### 3. Apply Database Migrations

```bash
# Apply all migrations to local database
wrangler d1 migrations apply anamnesis_db --local
```

Migrations are idempotent — run them multiple times safely.

### 4. Set Up Secrets for Local Development

For local testing, you can mock B2 credentials:

```bash
# These are mock values for local dev only!
echo "mock-key-id-12345" | wrangler secret put B2_KEY_ID --local
echo "mock-application-key-secret" | wrangler secret put B2_APPLICATION_KEY --local
echo "admin-token-dev-only-change-in-prod" | wrangler secret put ADMIN_TOKEN --local
```

### 5. Run Backend Locally

```bash
npm run dev
# Listens on http://localhost:8787
```

Test the health check:
```bash
curl http://localhost:8787/api/health
# {"status":"ok","db":"connected"}
```

## Frontend Setup (Vite + React)

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Create .env.local

```env
VITE_API_URL=http://localhost:8787
```

### 3. Run Dev Server

```bash
npm run dev
# Listens on http://localhost:5173
```

## Full-Stack Local Development

Run in separate terminals:

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

Then open http://localhost:5173 in your browser.

## Testing Login

1. Set a PIN via SQL (or through admin API):

```bash
# Connect to local D1
wrangler d1 execute anamnesis_db --local <<EOF
INSERT INTO app_settings (key, value) 
VALUES ('pin_hash_1', 'hashed-pin-value-here');
EOF
```

2. Call login endpoint:

```bash
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Patient-ID: 1" \
  -d '{"pin": "123456"}'
```

3. Use the returned `token` in subsequent requests:

```bash
curl http://localhost:8787/api/patient \
  -H "X-Session-Token: <token-from-login>"
```

## Database Inspection

### Query Local Database

```bash
# Interactive SQLite prompt
wrangler d1 execute anamnesis_db --local --interactive

# Or run SQL directly
wrangler d1 execute anamnesis_db --local <<EOF
SELECT COUNT(*) FROM patient;
EOF
```

### View Raw Database File

```bash
# Path to local database
ls -la .wrangler/state/v3/d1/
```

## Troubleshooting

### "database not found"

```bash
# Recreate database
wrangler d1 create anamnesis_db --local
# Update database_id in wrangler.toml.local
```

### "CORS blocked from frontend"

Ensure `CORS_ORIGINS` in `wrangler.toml.local` includes `http://localhost:5173`:

```toml
[vars]
CORS_ORIGINS = "http://localhost:5173"
```

### "Migrations not applying"

```bash
# Force rebuild
rm -rf .wrangler/
wrangler d1 create anamnesis_db --local
wrangler d1 migrations apply anamnesis_db --local
```

### "Worker Error: config not found"

Make sure middleware order is correct in `backend/src/index.js`:
1. Config middleware runs first
2. CORS middleware
3. Security headers
4. Auth middleware

## Next Steps

- See `backend/CONFIG.md` for production deployment
- See `.github/workflows/cloudflare.yml` for CI/CD setup
- See `docs/GITHUB_ACTIONS_SETUP.md` for GitHub Secrets configuration
