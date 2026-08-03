# Environment Configuration

## Frontend Setup

1. Copy the environment template:
   ```bash
   cd frontend
   cp .env.example .env.local
   ```

2. Edit `frontend/.env.local` and set your backend URL:
   ```env
   # For development (default, uses Vite proxy to localhost:3010)
   # VITE_API_URL=/api
   
   # For production build (use your Cloudflare Workers URL)
   VITE_API_URL=https://your-backend.workers.dev/api
   ```

3. If deploying to Cloudflare Pages or Netlify, update redirects:
   ```bash
   cp public/_redirects public/_redirects.local
   # Edit _redirects.local with your real Workers URL
   ```

## Backend Setup (Cloudflare Workers)

1. Copy the wrangler template and fill in your values:
   ```bash
   cd backend
   cp wrangler.toml wrangler.toml.local
   ```

2. Edit `backend/wrangler.toml.local` with your real values:
   - Replace `YOUR_D1_DATABASE_ID` with your D1 database ID (from Cloudflare Dashboard)
   - Replace `YOUR_BUCKET_NAME` with your Backblaze B2 bucket name
   - Replace `YOUR_KEY_ID` with your B2 key ID

3. Set **Worker Secrets** (never put these in `[vars]` / plaintext wrangler.toml):
   ```bash
   wrangler secret put B2_APPLICATION_KEY
   wrangler secret put ADMIN_TOKEN
   wrangler secret put BACKUP_ENCRYPTION_KEY
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   # Bootstrap PIN for first login (fresh install). Seeds pin_hash in D1 on first login.
   wrangler secret put APP_PIN
   ```

4. Deploy using your local config:
   ```bash
   wrangler deploy --config wrangler.toml.local
   ```

**Note:** The repository contains `wrangler.toml` with placeholder values only. Your real `wrangler.toml.local` is gitignored.

### What belongs in `[vars]` vs Secrets

| Kind | Examples | Storage |
|------|----------|---------|
| Non-secret config | `CORS_ORIGINS`, `B2_ENDPOINT`, `B2_BUCKET_NAME`, `B2_KEY_ID`, `WEBAUTHN_*` | `[vars]` in wrangler.toml |
| Sensitive | `B2_APPLICATION_KEY`, `ADMIN_TOKEN`, `BACKUP_ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_PIN` | **Worker Secrets** (`wrangler secret put`) |

GitHub Actions deploy syncs the sensitive set via `wrangler secret put` after `wrangler deploy` (see `.github/workflows/cloudflare.yml`).

For local development:
   ```bash
   cd backend
   cp ../.env.example .env
   # Edit .env and fill in your values
   ```

## Security Notes

- **Never commit** real configuration files:
  - `.env`, `.env.local`, `.env.save`
  - `wrangler.toml.local`
  - `_redirects.local`
  - Any `*.local` files
- These files are in `.gitignore`
- Use `.env.example`, `wrangler.toml`, and `_redirects` as templates only (with placeholder values)
- Store production secrets in Cloudflare Dashboard (Workers → Settings → **Secrets**, not plain Variables)
- Use `wrangler secret put` for all sensitive keys
- **Restore from backup** is re-enabled with guards (unwrap + refuse empty wipe). It restores **JSON metadata only** (not B2 file bytes). Auto-restore in CI remains off.
- CI runs `wrangler d1 migrations apply anamnesis-db --remote` **before** Worker deploy

## Multi-patient (family mode)

After login, the active chart is selected with:

```http
X-Patient-Id: 2
```

The session authenticates the family user; `X-Patient-Id` selects which patient row to read/write. The patient must exist in `patient`. The frontend `PatientSwitcher` sets this header via the API client.

PDF export from a new browser tab cannot send custom headers, so it may pass `?patient_id=` **only after** a valid session token; the backend still requires the patient row to exist.

## Local Development

In development mode, the frontend uses Vite proxy to forward API requests to `localhost:3010`, so you don't need to set `VITE_API_URL`.

## Production Build

For production deployment:
```bash
cd frontend
VITE_API_URL=https://your-backend.workers.dev/api npm run build
```

Or set it in your CI/CD pipeline (GitHub Actions secrets).
