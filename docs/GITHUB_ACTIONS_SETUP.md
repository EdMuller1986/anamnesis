# GitHub Actions Setup Guide

This document explains how to configure GitHub Actions for deploying Anamnesis to Cloudflare.

## Prerequisites

1. **Cloudflare Account** with Workers and D1 enabled
2. **Backblaze B2 Account** for file storage
3. **GitHub Repository** with admin access

## Step 1: Create Cloudflare API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Account Home → API Tokens → Create Token
3. Use template: **"Edit Cloudflare Workers"**
4. Permissions:
   - `Workers Scripts: Edit`
   - `D1: Edit`
   - `Cloudflare Pages: Edit`
5. Copy the token

## Step 2: Create D1 Database

```bash
# Via Cloudflare CLI
wrangler d1 create anamnesis_db
```

Note the `database_id` from output.

## Step 3: Create Backblaze B2 Application Key

1. Go to [Backblaze B2 Console](https://secure.backblaze.com/)
2. Buckets → Create a bucket (e.g., `anamnesis-prod-docs`)
3. App Keys → Create Application Key
4. Permissions: **Read and Write**
5. Note down:
   - Application Key ID (`B2_KEY_ID`)
   - Application Key Secret (`B2_APPLICATION_KEY`)
   - Endpoint URL (e.g., `s3.us-west-004.backblazeb2.com`)

## Step 4: Add GitHub Secrets

Repository Settings → Secrets and variables → Actions → New repository secret

### Secrets (Encrypted)

```
CLOUDFLARE_API_TOKEN      → Paste Cloudflare token
CLOUDFLARE_ACCOUNT_ID     → Your Cloudflare Account ID
D1_DATABASE_ID            → From 'wrangler d1 create' output
B2_KEY_ID                 → From Backblaze B2
B2_APPLICATION_KEY        → From Backblaze B2 (keep secret!)
ADMIN_TOKEN               → openssl rand -hex 32
```

### Variables (Non-sensitive)

Repository Settings → Secrets and variables → Actions → New repository variable

```
CORS_ORIGINS = "https://yourdomain.com"
B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"
B2_BUCKET_NAME = "anamnesis-prod-docs"
ENVIRONMENT = "production"
```

## Step 5: Update wrangler.toml

```toml
# backend/wrangler.toml

[[d1_databases]]
binding = "DB"
database_name = "anamnesis_db"
database_id = "<from-step-2>"

[vars]
CORS_ORIGINS = "https://yourdomain.com"
B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"
B2_BUCKET_NAME = "anamnesis-prod-docs"
```

## Step 6: Verify Workflow

1. Commit and push to `master` branch
2. Go to GitHub → Actions
3. Watch "Deploy to Cloudflare" workflow run
4. Check logs for errors

## Workflow Behavior

The workflow (`.github/workflows/cloudflare.yml`) will:

1. **Checkout** code
2. **Install dependencies** for backend and frontend
3. **Create wrangler.toml** from secrets (on each deploy)
4. **Deploy backend** to Cloudflare Workers
5. **Build frontend** with Vite
6. **Deploy frontend** to Cloudflare Pages

### Manual Deployment

You can also trigger manually:

1. GitHub → Actions → "Deploy to Cloudflare"
2. Click "Run workflow"
3. Optionally uncheck "Deploy backend" or "Deploy frontend" to deploy only one

## Troubleshooting

### Workflow fails: "authentication failed"

- Verify `CLOUDFLARE_API_TOKEN` in GitHub Secrets
- Regenerate token if expired (Cloudflare API tokens expire after 1 year)

### "database_id not found"

- The `database_id` in `wrangler.toml` must match the one you created
- Check `.github/workflows/cloudflare.yml` — it reads from `secrets.D1_DATABASE_ID`

### B2 upload fails

- Check `B2_KEY_ID` and `B2_APPLICATION_KEY` in GitHub Secrets
- Verify the B2 bucket exists and you have write permission
- Make sure `B2_ENDPOINT` and `B2_BUCKET_NAME` are correct

### "CORS blocked in production"

- Update `CORS_ORIGINS` in GitHub Variables to match your domain
- It should be `https://yourdomain.com`, not `http://` in production

## Security Best Practices

✅ **DO**:
- Use GitHub Secrets for all sensitive data
- Rotate API tokens annually
- Use separate Backblaze accounts for dev and prod
- Enable branch protection rules requiring status checks
- Review workflow logs for exposed secrets (they should be redacted)

⚠️ **DO NOT**:
- Commit `.env` files or secrets
- Use the same `ADMIN_TOKEN` across environments
- Share API tokens via email or chat
- Deploy to production with `CORS_ORIGINS = "*"`

## Next Steps

- See `backend/CONFIG.md` for local setup
- See `docs/LOCAL_DEVELOPMENT.md` for full-stack dev
- Read `.github/workflows/cloudflare.yml` to understand the deployment pipeline
