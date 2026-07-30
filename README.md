<div align="center">

<img src="docs/assets/hero.png" alt="Anamnesis" width="640" />

# Anamnesis (Free Serverless Stack)

**AI-coordinated medical records tracker running on free cloud infrastructure**

**English** • [Русский](README.ru.md)

[![Deploy Status](https://github.com/EdMuller1986/anamnesis/workflows/Deploy%20to%20Cloudflare/badge.svg)](https://github.com/EdMuller1986/anamnesis/actions)

</div>

---

> AI-coordinated medical records tracker — a personal health PWA where an AI assistant does the heavy lifting of data entry, structuring, and cross-referencing, while you just scan documents and talk to it in plain language.

**Status**: ✅ Migration Completed. Production-ready on Cloudflare Stack.

## 🆓 Free Serverless Architecture

This is a complete reimplementation of [Veta-one/anamnesis](https://github.com/Veta-one/anamnesis) optimized for **zero-cost high-availability infrastructure**:

| Component | Original | This Fork | Free Tier Usage |
|-----------|----------|-----------|-----------------|
| **Backend** | Node.js + Express | **Cloudflare Workers** (Hono) | 100k req/day |
| **Database** | Local SQLite | **Cloudflare D1** (SQLite + FTS5) | 5GB, 5M reads/day |
| **File Storage** | Local filesystem | **Backblaze B2** (S3/Streaming) | 10GB free |
| **Frontend** | VPS + nginx | **Cloudflare Pages** | Unlimited bandwidth |
| **CI/CD** | Manual | **GitHub Actions** | Automated validation |

**Total monthly cost: $0.00** for typical family usage.

## 🚀 Key Improvements in this Fork

- 🔒 **Enhanced Security**:
  - AES-GCM encrypted daily backups.
  - Multi-destination backup (Telegram + Backblaze B2).
  - Two-phase authentication with device trust and security questions.
  - WebAuthn (FaceID/TouchID) support out of the box.
- 🛠️ **Disaster Recovery**:
  - Automated state restoration from B2 storage via GitHub Action or API.
  - Hash-based deduplication to save storage and bandwidth.
- 📱 **PWA Excellence**:
  - Full client-side PDF rendering (no backend poppler/pdftoppm dependency).
  - Native-like performance via Cloudflare Edge network.
  - Automated Telegram notifications for medical reminders (Cron-triggered).
- 🧬 **AI-First Design**:
  - Comprehensive CRUD API for AI coordinators.
  - Full medical context injection (Analyses, Growth, Vaccines, Plans).

---

## 🛠️ Getting Started

### 1. External Services Setup
- **Cloudflare**: Create account, get `ACCOUNT_ID` and `API_TOKEN` (Edit Cloudflare Workers/D1 permissions).
- **Backblaze B2**: Create bucket, get `KEY_ID`, `APPLICATION_KEY`, and `ENDPOINT`.
- **Telegram**: Create bot via [@BotFather](https://t.me/botfather), get `BOT_TOKEN` and your `CHAT_ID`.

### 2. GitHub Secrets Configuration
Go to **Settings -> Secrets and variables -> Actions** and add:
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_ID`
- `B2_ENDPOINT` / `B2_BUCKET_NAME` / `B2_KEY_ID` / `B2_APPLICATION_KEY`
- `ADMIN_TOKEN` (Random string for AI access)
- `BACKUP_ENCRYPTION_KEY` (Strong password for data encryption)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
- `VITE_API_URL` (Points to your backend worker URL)

### 3. Deployment
Simply push to `master`. The GitHub Actions workflow will:
1. Validate all secrets (functional check of B2, Telegram, and Crypto).
2. Run 16+ integration tests.
3. Deploy backend to Workers and frontend to Pages.

---

## 🧬 AI Coordinator Protocol

Anamnesis works with any LLM that can talk to HTTP APIs. The coordinator reads your medical documents and maintains the structured database.

**Supported Tools for AI:**
- **[Claude Code](docs/setup/claude-code.md)** (Anthropic).
- **[Gemini CLI](docs/setup/gemini-cli.md)** (Google).
- **[Cursor IDE](docs/setup/cursor.md)** / **[Aider](docs/setup/aider.md)**.

See [`AI_COORDINATOR_GUIDE.md`](AI_COORDINATOR_GUIDE.md) for detailed tool definitions.

---

## 🛡️ Quality Assurance

We use automated tests to ensure stability: every deploy runs a full integration cycle (Empty -> Populate Demo -> Verify Report -> Wipe -> Restore).

---

## Technical Stack
- **Frontend**: React 19, Vite 7, TypeScript, React Router 7, TanStack Query 5, PDF.js, Framer Motion.
- **Backend**: Hono Framework, Cloudflare Workers, Cloudflare D1 (SQLite), Web Crypto API.
- **Storage**: Backblaze B2 S3-Compatible API with Streaming Proxy.
- **Auth**: PBKDF2 Hashing, WebAuthn, Device Revocation.

## Links

- **Original repository**: https://github.com/Veta-one/anamnesis
- **Original author's article**: [Habr](https://habr.com/ru/articles/1022450/)
- **Migration Roadmap**: [`docs/MIGRATION_PLAN.md`](docs/MIGRATION_PLAN.md)

---

Original project by [Veta-one](https://github.com/Veta-one).
Serverless migration by [EdMuller1986](https://github.com/EdMuller1986).
