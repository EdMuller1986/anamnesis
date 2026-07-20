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

3. Set B2 application key as a secret:
   ```bash
   wrangler secret put B2_APPLICATION_KEY
   ```

4. Deploy using your local config:
   ```bash
   wrangler deploy --config wrangler.toml.local
   ```

**Note:** The repository contains `wrangler.toml` with placeholder values only. Your real `wrangler.toml.local` is gitignored.

2. For local development:
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
- Store production secrets in Cloudflare Dashboard (Workers → Settings → Variables)
- Use `wrangler secret put` for sensitive keys like `B2_APPLICATION_KEY`

## Local Development

In development mode, the frontend uses Vite proxy to forward API requests to `localhost:3010`, so you don't need to set `VITE_API_URL`.

## Production Build

For production deployment:
```bash
cd frontend
VITE_API_URL=https://your-backend.workers.dev/api npm run build
```

Or set it in your CI/CD pipeline (GitHub Actions secrets).
