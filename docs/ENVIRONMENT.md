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
| Non-secret config | `CORS_ORIGINS`, `B2_ENDPOINT`, `B2_BUCKET_NAME`, `B2_KEY_ID`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` | `[vars]` in wrangler.toml / GitHub secrets → CI |
| Sensitive | `B2_APPLICATION_KEY`, `ADMIN_TOKEN`, `BACKUP_ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_PIN` | **Worker Secrets** (`wrangler secret put`) |

GitHub Actions also needs secrets `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` (your Pages domain), plus `VITE_API_URL` for the frontend build and `_redirects` proxy.

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
- **Restore from backup** is re-enabled with guards (unwrap + refuse empty wipe). Metadata always; optional file re-upload when backup was made with `include_files=1`. Auto-restore in CI remains off.
- CI runs `wrangler d1 migrations apply anamnesis-db --remote` **before** Worker deploy

## Migrating data from old SQLite (VPS)

Orchestrated helper (export → optional B2 upload → import):

```bash
export WORKER_URL=https://your-backend.workers.dev
export ADMIN_TOKEN=...
export B2_ENDPOINT=... B2_BUCKET_NAME=... B2_KEY_ID=... B2_APPLICATION_KEY=...

# Dry-run (no network import)
node backend/scripts/migrate-from-sqlite.mjs /path/to/old.db --patient 1 \
  --uploads /path/to/uploads --basename-only --dry-run

# Full migrate (optional --wipe)
node backend/scripts/migrate-from-sqlite.mjs /path/to/old.db --patient 1 \
  --uploads /path/to/uploads --basename-only
```

Or step-by-step:

```bash
# 1) Export tables to JSON (metadata only)
node backend/scripts/export-sqlite-for-import.mjs /path/to/old.db --patient 1 > import.json

# 2) Upload files from old backend/uploads to B2
node backend/scripts/upload-uploads-to-b2.mjs /path/to/uploads --basename-only

# 3) Import into D1 (admin token)
curl -X POST "$WORKER_URL/api/admin/import" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "X-Patient-Id: 1" \
  -H "Content-Type: application/json" \
  -d @import.json
```

Admin helpers:
- `GET /api/admin/tools` — catalog of tools
- `GET /api/admin/tools/auth-log`
- `GET /api/admin/tools/schema-info`
- `GET /api/admin/tools/backup-status` — last cron/manual backup
- `GET /api/admin/tools/backups` — list `backups/` objects in B2
- `POST /api/admin/tools/inspect-backup` — decrypt + summarize without restore (`{ "key": "…" }`)
- `POST /api/admin/tools/backup-now?wait=1` — run backup now  
  - `include_files=1` — embed B2 object bytes (base64) under size caps (~40 files / 5 MB each / 20 MB total)  
  - `force=1` — write even if content hash unchanged  
  Daily cron still stores **metadata + file key manifest** only (keeps Telegram size sane).
- `GET /api/health?detail=1` — schema + last backup age (public)
- `POST /api/admin/tools/restore-from-backup?dry_run=1` — summarize backup without wipe
- `POST /api/admin/tools/restore-from-backup?key=backups/….json.gz.enc` — restore from a listed object  
  Body required: `{"confirm":"WIPE"}`  
  (writes a `pre-restore-*` snapshot first unless `skip_snapshot=1`; rate-limited)  
  - `restore_files=1` — re-upload embedded `b2_file_blobs` to B2 (no-op if backup has none)
- `GET /api/admin/tools/orphan-check?include_b2=1` — DB vs B2 key comparison  

**Full DR with files:**  
1. `POST .../backup-now?wait=1&include_files=1&force=1`  
2. On disaster (after dry-run): `POST .../restore-from-backup?restore_files=1` + `{"confirm":"WIPE"}`  
If files were never packed, restore recovers DB rows; re-upload uploads separately (`upload-uploads-to-b2.mjs` or live B2 copy).

**Family mode:** full backups have `scope: all_patients`. Wipe restore partitions rows by `patient_id` and restores each chart separately (does not collapse everyone onto the active session patient).

Admin SQL writes require `"allow_write": true` and are rate-limited.

`APP_PIN` bootstrap seeds only **patient_id=1** by default. Set Worker var/secret `APP_PIN_ALL_PATIENTS=true` to seed every patient on first login.

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
