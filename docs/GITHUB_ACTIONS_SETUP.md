# GitHub Actions Setup Guide

This guide explains how to set up automatic deployment to Cloudflare via GitHub Actions.

## Prerequisites

1. Cloudflare account with Workers and Pages enabled
2. GitHub repository with push access
3. `wrangler.toml.local` configured locally (DO NOT commit this file)

---

## Step 1: Get Cloudflare Credentials

### 1.1 Get API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click **"Create Token"**
3. Use template **"Edit Cloudflare Workers"** or create custom with:
   - Permissions:
     - `Account` → `Cloudflare Pages` → `Edit`
     - `Account` → `Workers Scripts` → `Edit`
     - `Account` → `D1` → `Edit`
   - Account Resources: `Include` → Your account
4. Click **"Continue to summary"** → **"Create Token"**
5. **Copy the token** (you'll need it for GitHub secrets)

### 1.2 Get Account ID

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your account
3. Scroll down in the right sidebar
4. Copy **Account ID**

---

## Step 2: Add Secrets to GitHub

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"** and add:

| Secret Name | Value | Where to get |
|-------------|-------|--------------|
| `CLOUDFLARE_API_TOKEN` | `your-api-token` | From Step 1.1 |
| `CLOUDFLARE_ACCOUNT_ID` | `your-account-id` | From Step 1.2 |
| `VITE_API_URL` | `https://anamnesis-backend.your-subdomain.workers.dev/api` | Your Workers URL |

**Example VITE_API_URL:**
```
https://anamnesis-backend.simulyakrge.workers.dev/api
```

---

## Step 3: Set B2 Secret in Cloudflare (One-Time)

GitHub Actions **cannot** set Cloudflare Workers secrets (they're write-only).
You need to set it **once manually**:

```bash
cd backend
wrangler login  # If not logged in
wrangler secret put B2_APPLICATION_KEY --config wrangler.toml.local
# Paste your B2 application key when prompted
```

This secret is stored in Cloudflare Workers and persists across deployments.

---

## Step 4: Prepare wrangler.toml.local for CI

**Problem:** GitHub Actions needs `wrangler.toml.local` to deploy, but we don't commit it (it contains secrets).

**Solution:** Use environment variables or create the file in CI.

### Option A: Create wrangler.toml.local from GitHub Secrets (Recommended)

Add more secrets to GitHub:

| Secret Name | Value | Example |
|-------------|-------|---------|
| `D1_DATABASE_ID` | Your D1 database ID | `f5dcfead-71f4-46e1-a1c7-32902c6db311` |
| `B2_BUCKET_NAME` | Your B2 bucket name | `anamnezis` |
| `B2_KEY_ID` | Your B2 key ID | `1747a8c37830` |
| `B2_ENDPOINT` | Your B2 endpoint | `s3.us-east-005.backblazeb2.com` |

Then update `.github/workflows/cloudflare.yml` to create the file:

```yaml
- name: Create wrangler.toml.local
  run: |
    cd backend
    cat > wrangler.toml.local << EOF
    name = "anamnesis-backend"
    main = "src/index.js"
    compatibility_date = "2024-05-02"

    [[d1_databases]]
    binding = "DB"
    database_name = "anamnesis_db"
    database_id = "${{ secrets.D1_DATABASE_ID }}"

    [vars]
    CORS_ORIGINS = "*"
    B2_ENDPOINT = "${{ secrets.B2_ENDPOINT }}"
    B2_BUCKET_NAME = "${{ secrets.B2_BUCKET_NAME }}"
    B2_KEY_ID = "${{ secrets.B2_KEY_ID }}"
    EOF

- name: Deploy Worker
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: backend
    command: deploy --config wrangler.toml.local
```

### Option B: Commit a sanitized wrangler.toml (Not Recommended)

Keep `wrangler.toml` with placeholders in the repo and deploy with:
```yaml
command: deploy --config wrangler.toml
```

But this means your database ID and bucket name are public.

---

## Step 5: Test the Workflow

1. Make a small change (e.g., add a comment to README.md)
2. Commit and push to `master` branch:
   ```bash
   git add .
   git commit -m "test: trigger GitHub Actions"
   git push origin master
   ```
3. Go to GitHub → **Actions** tab
4. Watch the workflow run

If successful, you'll see:
- ✅ `deploy-backend` job completed
- ✅ `deploy-frontend` job completed

---

## Step 6: Check Deployment

1. **Backend:** Visit your Workers URL:
   ```
   https://anamnesis-backend.your-subdomain.workers.dev/api/health
   ```

2. **Frontend:** Visit your Pages URL:
   ```
   https://anamnesis.pages.dev
   ```
   (or your custom domain if configured)

---

## Troubleshooting

### Error: "wrangler.toml.local not found"

- Make sure you added all secrets to GitHub (Step 4)
- Or commit a sanitized `wrangler.toml` without secrets

### Error: "Unauthorized" or "Invalid API Token"

- Check that `CLOUDFLARE_API_TOKEN` has correct permissions
- Regenerate token if needed

### Error: "B2_APPLICATION_KEY not found"

- Run Step 3 manually: `wrangler secret put B2_APPLICATION_KEY`

### Frontend doesn't load data

- Check that `VITE_API_URL` in GitHub secrets matches your Workers URL
- Check CORS settings in `backend/src/index.js`

---

## Best Practices

1. **Never commit** `wrangler.toml.local` or any file with real secrets
2. **Use GitHub Environments** for staging/production separation (optional)
3. **Enable branch protection** on `master` to require PR reviews
4. **Monitor Actions usage** - GitHub Actions has limits (2,000 minutes/month free)

---

## What Happens on Each Push

1. GitHub Actions triggers on push to `master`
2. Backend job:
   - Installs dependencies
   - Creates `wrangler.toml.local` from secrets
   - Deploys to Cloudflare Workers
3. Frontend job (after backend succeeds):
   - Installs dependencies
   - Builds with `VITE_API_URL` from secrets
   - Deploys to Cloudflare Pages
4. Your app is live! 🎉

---

## Disabling Manual Deploys

Once GitHub Actions works, you can stop using `wrangler deploy` manually:

- All deploys happen via `git push`
- Teammates can deploy by merging to `master`
- Rollback = `git revert` + push

---

## Next Steps

- [ ] Set up staging environment (deploy from `develop` branch)
- [ ] Add linting/testing to workflow (before deploy)
- [ ] Set up Slack/Discord notifications for deploy status
- [ ] Configure custom domain for Cloudflare Pages
