# GitHub Secrets Checklist

Before pushing, verify all secrets are set in **Settings → Secrets → Actions**:

## Required Secrets

| Secret Name | Example Value | Where to Get |
|-------------|---------------|--------------|
| `CLOUDFLARE_API_TOKEN` | `cfu...17c11` | [API Tokens](https://dash.cloudflare.com/profile/api-tokens) |
| `CLOUDFLARE_ACCOUNT_ID` | `25e87ce0c99d551ef356e7f93922a1eb` | From Cloudflare Dashboard URL |
| `D1_DATABASE_ID` | `f5dcfead-71f4-...` | From your local `wrangler.toml.local` |
| `B2_BUCKET_NAME` | `anamnezis` | From your local `wrangler.toml.local` |
| `B2_KEY_ID` | `1747a8c37830` | From your local `wrangler.toml.local` |
| `B2_ENDPOINT` | `s3.us-east-005.backblazeb2.com` | From your local `wrangler.toml.local` |
| `VITE_API_URL` | `https://anamnesis-backend.workers.dev/api` | Your Workers URL |

## Quick Test

Test your API token locally:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="25e87ce0c99d551ef356e7f93922a1eb"

npx wrangler@3 deploy --dry-run
```

If this works locally, it will work in GitHub Actions.

## Common Issues

**"Invalid access token"**
- Recreate token with these permissions:
  - Account → Workers Scripts → Edit
  - Account → Cloudflare Pages → Edit
  - Account → D1 → Edit
  - Account → Account Settings → Read

**"database_id is required"**
- Check that `D1_DATABASE_ID` is set in GitHub Secrets
- Check that the value is correct (from `wrangler.toml.local`)

**"Project not found"**
- Pages project `anamnesis` doesn't exist yet
- It will be created on first deploy automatically
