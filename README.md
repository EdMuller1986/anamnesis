<div align="center">

<img src="docs/assets/hero.png" alt="Anamnesis" width="640" />

# Anamnesis (Free Serverless Fork)

**AI-coordinated medical records tracker running on free cloud infrastructure**

**English** • [Русский](README.ru.md)

[![Deploy Status](https://github.com/EdMuller1986/anamnesis/workflows/Deploy%20to%20Cloudflare/badge.svg)](https://github.com/EdMuller1986/anamnesis/actions)

</div>

---

> AI-coordinated medical records tracker — a personal health PWA where an AI assistant does the heavy lifting of data entry, structuring, and cross-referencing, while you just scan documents and talk to it in plain language.

**Status**: Migration to free serverless infrastructure in progress.

## 🆓 Free Serverless Architecture

This is a fork of [Veta-one/anamnesis](https://github.com/Veta-one/anamnesis) migrated to run entirely on **free cloud services**:

| Component | Original | This Fork | Free Tier |
|-----------|----------|-----------|-----------|
| **Backend** | Node.js + Express + VPS | **Cloudflare Workers** | 100,000 requests/day |
| **Database** | SQLite on VPS disk | **Cloudflare D1** (SQLite) | 5 GB storage, 5M reads/day |
| **File Storage** | Local disk + nginx | **Backblaze B2** | 10 GB free |
| **Frontend Hosting** | VPS + nginx | **Cloudflare Pages** | Unlimited bandwidth |
| **CI/CD** | Manual deploy | **GitHub Actions** | 2,000 minutes/month |

**Total cost: $0/month** for typical single-family usage.

### Why This Fork?

The original Anamnesis requires a VPS ($5-10/month) and manual deployment. This fork makes it:
- ✅ **Completely free** for most users
- ✅ **Zero-maintenance** (serverless auto-scaling)
- ✅ **Git-based deployment** (push to deploy)
- ✅ **Global CDN** (fast worldwide)
- ✅ **Auto-backups** to B2

### What's Been Migrated

✅ **Completed:**
- Backend framework: Express → **Hono** (optimized for Workers)
- Database queries: PostgreSQL syntax → **SQLite/D1 bindings**
- File uploads: Local storage → **Backblaze B2 S3-compatible API**
- All API routes: `/api/diagnoses`, `/api/medications`, `/api/lab-results`, `/api/plan`, `/api/specialists`, `/api/timeline`, `/api/patient`, `/api/documents`
- Security: Environment variable system for secrets
- CI/CD: GitHub Actions workflow for automatic deployment
- Documentation: Setup guides and migration plans

🚧 **In Progress:**
- Authentication routes (PIN, WebAuthn, sessions)
- Admin tools (`/api/admin/tools/*`)
- Full-text search (FTS5 in D1)
- Dashboard and analytics endpoints
- Frontend deployment to Cloudflare Pages

📋 **Planned:**
- D1 migrations automation
- B2 lifecycle policies for old files
- Edge caching optimization
- Multi-region replication

---

## What is Anamnesis?

Most medical trackers ask you to fill in dozens of fields by hand — diagnosis, dosage, reference ranges, anomaly flags, links between tests and visits. It is tedious and most people give up after a week.

Anamnesis flips the model: **an AI coordinator** (Claude, GPT, Gemini, local LLM — your choice) reads your medical documents, extracts the data, and writes it into a structured SQLite database. You get a clean timeline, automatic anomaly detection, cross-referenced visits, and a full audit log — without typing it in yourself.

The app is a minimal PWA that **shows** the data. The coordinator **maintains** the data.

## Who is this for?

- Families with complex or ongoing medical situations (a child with multiple specialists, chronic conditions, frequent tests)
- Developers comfortable with serverless deployment (Cloudflare Workers, GitHub Actions)
- People who already work with an AI assistant daily and want to extend that habit to their health records
- Privacy-conscious users who don't want medical data in a SaaS cloud but also don't want to manage a VPS

This is **not** for casual users looking for a one-tap wellness app.

## Key Features

### For the user
- **Dashboard** — aggregated stats, active diagnoses, current medications, upcoming reminders, AI summary
- **Plan** — treatment and examination plan with priorities, tabs pending/done
- **Errors** — medical errors and lab anomalies with AI recommendations
- **Visits & documents** — doctor visits with audio transcriptions, AI analysis, attached documents, comments
- **Diagnoses** — all diagnoses with optional AI assessment
- **Lab results** — grouped by test, with ref ranges and anomaly highlighting
- **Vaccinations** — schedule with photos and reactions
- **Growth log** — height/weight/head circumference over time
- **Specialists directory**, **medications register**, **reminders**, **full-text search (FTS5)**, **change history**, **AI chat**
- **Export to PDF** — shareable summary for a new doctor
- **Health graph** (Cytoscape) — visualize connections between diagnoses, medications, specialists, visits

### For the AI coordinator
- HTTP API (`/api/admin/tools/*`) — `ai-review`, `integrity`, `orphan-check`, `impact`, `sql`, `search`, `changelog`, `mark-reviewed`, `since-last-review`, `backup-now`
- Full-text search (FTS5 with Cyrillic support in D1)
- Strict data integrity checks (foreign keys, orphan detection, conflict resolution protocol)
- Audit log with per-patient filtering — the AI can reason about what changed since last session

### Technical Stack
- **Frontend**: React 19, Vite 7, TypeScript strict, React Router 7 (data mode), TanStack Query 5, Motion, PWA with offline support (Workbox)
- **Backend**: Cloudflare Workers (Hono framework), D1 (SQLite), Backblaze B2 (S3-compatible storage)
- **Auth**: scrypt PIN hashing + WebAuthn biometry + device trust + session management in D1
- **Deploy**: GitHub Actions → Cloudflare Workers + Pages
- **Multi-patient**: ready for up to 4 patients in one instance (per-patient data isolation, audit log, UI patient switcher)

## Model-agnostic AI coordinator

Anamnesis does not depend on a specific AI provider. The coordinator is any LLM with the ability to execute shell commands and HTTP requests — the project provides a protocol (see `AI_COORDINATOR_GUIDE.md`) and lets you plug in whatever you use.

Tested setups:
- **[Claude Code](docs/setup/claude-code.md)** (Anthropic) — recommended for clinical reasoning
- **[Cursor IDE](docs/setup/cursor.md)** — integrated IDE + AI + terminal
- **[Aider](docs/setup/aider.md)** — CLI-based, works with any model
- **[Gemini CLI](docs/setup/gemini-cli.md)** (Google)
- **[Local models](docs/setup/ollama-local.md)** via Ollama — Llama 3, Qwen, DeepSeek

Clinical-reasoning tasks benefit from larger models. Routine data entry works fine on smaller ones.

---

## Getting Started (Free Serverless Setup)

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier)
- [Backblaze B2 account](https://www.backblaze.com/b2/sign-up.html) (10 GB free)
- [GitHub account](https://github.com/signup) (for CI/CD)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) — `npm install -g wrangler`

### 2. Fork and Clone

```bash
# Fork this repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/anamnesis.git
cd anamnesis
```

### 3. Backend Setup (Cloudflare Workers + D1)

```bash
cd backend

# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create anamnesis_db

# Copy the database_id from output, then create your local config:
cp wrangler.toml wrangler.toml.local
# Edit wrangler.toml.local and paste your database_id

# Run migrations
wrangler d1 migrations apply anamnesis_db --local  # Test locally first
wrangler d1 migrations apply anamnesis_db          # Then apply to production

# Set B2 secrets
wrangler secret put B2_APPLICATION_KEY
# Paste your B2 application key when prompted
```

### 4. Backblaze B2 Setup

1. Create a [Backblaze B2 bucket](https://www.backblaze.com/b2/cloud-storage.html)
2. Create an application key with read/write permissions
3. Update `backend/wrangler.toml.local`:
   ```toml
   [vars]
   B2_BUCKET_NAME = "your-bucket-name"
   B2_KEY_ID = "your-key-id"
   B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"  # Your region
   ```

### 5. Deploy Backend

```bash
# Deploy to Cloudflare Workers
wrangler deploy --config wrangler.toml.local

# Note the deployed URL (e.g., https://anamnesis-backend.your-subdomain.workers.dev)
```

### 6. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Create local environment config
cp .env.example .env.local

# Edit .env.local and set your Workers URL:
# VITE_API_URL=https://anamnesis-backend.your-subdomain.workers.dev/api
```

### 7. Deploy Frontend (Cloudflare Pages)

```bash
# Build for production
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name anamnesis

# Or set up automatic deployment via GitHub integration:
# https://developers.cloudflare.com/pages/get-started/git-integration/
```

### 8. GitHub Actions (Optional - Automatic Deployment)

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add these secrets:
   - `CLOUDFLARE_API_TOKEN` (from Cloudflare dashboard)
   - `CLOUDFLARE_ACCOUNT_ID` (from Cloudflare dashboard)
3. Push to `master` branch to trigger automatic deployment

**Full setup guide**: See [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)

---

## Development

### Local Development

```bash
# Backend (with local D1)
cd backend
npm run dev  # Runs on http://localhost:8787

# Frontend (with Vite proxy)
cd frontend
npm run dev  # Runs on http://localhost:5173
```

The frontend proxy will forward `/api/*` requests to your local Workers instance.

### Project Structure

```
anamnesis/
├── backend/                    Cloudflare Workers + D1
│   ├── src/
│   │   ├── index.js           Main Hono app
│   │   ├── routes/            API endpoints
│   │   ├── services/          B2 storage, auth, etc.
│   │   └── middleware/        Auth, validation
│   ├── migrations/            D1 schema migrations
│   ├── wrangler.toml          Template (placeholders)
│   ├── wrangler.toml.local    Your config (gitignored)
│   └── CONFIG.md              Setup instructions
│
├── frontend/                   React PWA
│   ├── src/
│   │   ├── app/               Router, providers
│   │   ├── shared/            UI primitives, auth, API client
│   │   └── features/          Dashboard, plan, documents, etc.
│   ├── .env.example           Template
│   └── .env.local             Your config (gitignored)
│
├── docs/
│   ├── ENVIRONMENT.md         Configuration guide
│   ├── MIGRATION_PLAN.md      Migration roadmap
│   └── TESTING_PLAN.md        Testing strategy
│
└── .github/workflows/
    └── cloudflare.yml         CI/CD pipeline
```

---

## Migration Status & Roadmap

See [`docs/MIGRATION_PLAN.md`](docs/MIGRATION_PLAN.md) for detailed migration roadmap.

See [`docs/TESTING_PLAN.md`](docs/TESTING_PLAN.md) for testing strategy.

## Contributing

PRs welcome for:
- Migration of remaining endpoints
- Bug fixes in migrated code
- Performance optimizations for Workers/D1
- Documentation improvements
- Testing infrastructure

Please open an issue first for larger changes.

## Differences from Original

This fork maintains feature parity with [Veta-one/anamnesis](https://github.com/Veta-one/anamnesis) but runs on different infrastructure:

| Aspect | Original | This Fork |
|--------|----------|-----------|
| Backend runtime | Node.js 22 | Cloudflare Workers (V8 isolates) |
| HTTP framework | Express | Hono |
| Database | SQLite on disk | Cloudflare D1 (distributed SQLite) |
| File storage | Local filesystem | Backblaze B2 (S3-compatible) |
| Deployment | VPS + systemd + nginx | Serverless (Workers + Pages) |
| Cost | $5-10/month | $0/month (free tiers) |
| Scaling | Manual | Automatic |
| Backups | Custom scripts + Telegram | B2 lifecycle policies |

**Philosophy**: Same UX, same AI coordinator protocol, zero hosting cost.

## Credits

Original project by [Veta-one](https://github.com/Veta-one).

Serverless migration by [EdMuller1986](https://github.com/EdMuller1986).

## License

MIT, see [LICENSE](LICENSE). Not a medical device.

## Links

- **Original repository**: https://github.com/Veta-one/anamnesis
- **Original author's article** (Russian): [Habr](https://habr.com/ru/articles/1022450/)
- **This fork**: https://github.com/EdMuller1986/anamnesis
- **Cloudflare Workers docs**: https://developers.cloudflare.com/workers/
- **Cloudflare D1 docs**: https://developers.cloudflare.com/d1/
- **Backblaze B2 docs**: https://www.backblaze.com/b2/docs/
