# Manual Workflow Runs

You can now trigger deployments manually without pushing code.

## How to Run Manually

1. Go to your GitHub repository
2. Click **Actions** tab
3. Select **"Deploy to Cloudflare"** workflow (left sidebar)
4. Click **"Run workflow"** button (right side)
5. Choose options:
   - ✅ **Deploy backend (Workers)** - deploy backend
   - ✅ **Deploy frontend (Pages)** - deploy frontend
6. Click **"Run workflow"** button

## Use Cases

### ✅ **After Changing Secrets**

If you updated secrets in GitHub (e.g., new API token, new D1 database):
1. Update secrets in **Settings → Secrets → Actions**
2. Run workflow manually
3. No need to push empty commits

### ✅ **Deploy Only Backend**

If you only changed backend code:
1. Run workflow manually
2. ✅ Check "Deploy backend"
3. ❌ Uncheck "Deploy frontend"

### ✅ **Deploy Only Frontend**

If you only changed frontend code:
1. Run workflow manually
2. ❌ Uncheck "Deploy backend"
3. ✅ Check "Deploy frontend"

### ✅ **Full Redeploy**

To redeploy everything without code changes:
1. Run workflow manually
2. ✅ Keep both checkboxes checked (default)

## Automatic Deploys Still Work

Manual runs **don't replace** automatic deploys:
- Push to `master` → automatic full deploy
- Manual trigger → deploy what you choose

## Example Scenarios

**Scenario 1: Changed D1_DATABASE_ID secret**
```
1. Settings → Secrets → Update D1_DATABASE_ID
2. Actions → Deploy to Cloudflare → Run workflow
3. ✅ Deploy backend
4. ❌ Deploy frontend (no need)
5. Run workflow
```

**Scenario 2: Changed VITE_API_URL secret**
```
1. Settings → Secrets → Update VITE_API_URL
2. Actions → Deploy to Cloudflare → Run workflow
3. ❌ Deploy backend (no need)
4. ✅ Deploy frontend (needs rebuild with new URL)
5. Run workflow
```

**Scenario 3: Rollback test**
```
1. Revert to previous commit locally
2. Actions → Deploy to Cloudflare → Run workflow
3. ✅ Deploy backend
4. ✅ Deploy frontend
5. Run workflow
```

## Notes

- Manual runs use the **latest code** from the selected branch (default: `master`)
- Secrets are always taken from **Settings → Secrets → Actions**
- Manual runs appear in Actions history just like automatic ones
- You can run workflow on **any branch** (select branch in "Run workflow" dialog)
