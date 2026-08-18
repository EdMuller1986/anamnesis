# Migration Plan: VPS → Serverless

This document tracks the migration of Anamnesis from a traditional VPS setup to free serverless infrastructure (Cloudflare Workers + D1 + Backblaze B2).

> **Honest status (2026-08):** Architectural port **plus P0 hardening** is in place (auth, isolation, upload policy, D1 migrations in CI, backup/restore with guards, audit triggers, SQLite migrator, real round-trip tests). Treat as **family-dev**: validate restore on your own data before real medical use. Historical findings: root `TODO.md`.

## Goals

1. **Zero monthly cost** for typical single-family usage (✅ free-tier stack)
2. **Feature parity** with original implementation (⚠️ ~85–90% for active product paths; niche upstream edges may differ)
3. **Maintain security** (encryption, authentication, session management) (✅ P0 regressions largely closed)
4. **Preserve AI coordinator protocol** (HTTP API compatibility) (✅ admin import/tools + enriched patient-context)
5. **Git-based deployment** (✅ GHA → Workers/Pages; **D1 migrations apply remotely before deploy**)

---

## Phase 1: Core Backend Infrastructure — COMPLETED

### Backend Framework Migration
- [x] Replace Express with Hono (Workers-compatible)
- [x] Update all route handlers to Hono context API
- [x] Replace Node.js modules with Workers-compatible alternatives
- [x] Configure CORS middleware for Hono (single origin string; credentials-safe `*`)
- [x] Set up local development environment with Wrangler 4

### Database Migration
- [x] Create D1 database instance
- [x] Convert query style to D1 `prepare().bind()`
- [x] Initial + incremental migrations `0001`…`0012` (audit triggers, dual patient fields, auth_log, schema parity, …)
- [x] CI applies `wrangler d1 migrations apply anamnesis-db --remote` before Worker deploy
- [x] Real SQLite migration-apply tests (`migrations-apply.test.js`)

### File Storage Migration
- [x] Backblaze B2 via S3-compatible client
- [x] Upload / signed download / list / delete
- [x] Streaming proxy through Worker (avoid B2 CORS for previews)
- [x] Upload policy: size limits, extension whitelist, magic-byte sniff, private cache headers

### Core Routes
- [x] Documents, diagnoses, medications, lab-results, plan, specialists, timeline, patient (incl. PUT)
- [x] Vaccinations (+ section/photos CRUD), growth (syncs patient height/weight), reminders (+ send-now)
- [x] Medical errors full CRUD, AI requests CRUD, history (`limit`/`offset`/`since`)
- [x] Dashboard, patient-context, search, export report

---

## Phase 2: Authentication & Sessions — COMPLETED (hardened)

### PIN Authentication
- [x] PBKDF2 via Web Crypto
- [x] Two-phase login + device verification
- [x] Lockout / rate limits / `auth_log`
- [x] PIN exactly **6 digits**; bootstrap from `APP_PIN` on fresh install
- [x] PIN change revokes other sessions

### WebAuthn
- [x] Register / authenticate / list / delete
- [x] Credentials restored on wipe-restore; auth_log events

### Session / device trust
- [x] D1 sessions + sliding expiry
- [x] Known devices + security question + revoke
- [x] Family multi-patient via session + `X-Patient-Id` / chart switcher

---

## Phase 3: Admin Tools & AI Coordinator — COMPLETED (restore re-enabled with guards)

### Admin tools
- [x] ai-review, integrity (FTS + FK probes), orphan-check (`include_b2`), sql (rate-limited writes), search, changelog, impact
- [x] schema-info (tables + audit trigger inventory)
- [x] auth-log, backup-status, backups list, inspect-backup
- [x] **validate-restore** (staging / no writes)
- [x] backup-now (`wait`, `include_files`, `force`)
- [x] restore-from-backup (`dry_run`, `key`, `restore_files`, body `{"confirm":"WIPE"}`, pre-restore snapshot)

### Automated backups
- [x] Daily AES-GCM backups → B2 + Telegram
- [x] Stable-hash dedup (ignores `exported_at` / volatile settings / base64 bodies)
- [x] All-patients scope + B2 key manifest
- [x] Optional embedded file pack (size-capped)
- [x] Rotation of `backups/` objects

### Data migration from legacy VPS
- [x] `export-sqlite-for-import.mjs` / `upload-uploads-to-b2.mjs` / `migrate-from-sqlite.mjs`
- [x] `--patient` and `--all-patients`, post-import verify

---

## Phase 4: Frontend & Dashboard — COMPLETED (product paths)

- [x] Dashboard, history, search, export (enriched HTML report)
- [x] PDF.js previews, TanStack Query
- [x] Reminders UI + cron Telegram sender
- [x] Security / PIN / WebAuthn / multi-patient switcher

---

## Phase 5: Deployment & Disaster Recovery — COMPLETED (manual restore; auto CI restore off)

### CI/CD
- [x] GitHub Actions → Workers + Pages
- [x] Secrets as Worker Secrets (not plain vars)
- [x] Wrangler **4** for whoami / migrate / deploy / secret put / pages
- [x] D1 migrations apply before deploy

### Disaster recovery
- [x] Restore API **re-enabled** with unwrap, empty-wipe refuse, WIPE confirm, snapshot, rate limit, multi-patient partition, optional file re-upload
- [ ] **Auto-restore after every deploy** remains **off** (by design — too dangerous)
- [x] Staging-style validation without wipe (`validate-restore` / `dry_run`)
- [ ] Separate Cloudflare **staging D1** database (ops: create binding if desired)

---

## Phase 6: Testing & QA — SUBSTANTIALLY IMPROVED

- [x] ~69 backend Vitest tests (mocked API + real SQLite migrations + **backup→wipe→restore round-trip**)
- [x] Patient isolation tests, upload-policy, auth hardening, schema parity
- [ ] Full live E2E against production Worker + real B2 in CI (optional future)
- [ ] Operator DR drill on real backup (human checklist in `TODO.md`)

---

## Progress summary (2026-08)

| Phase | Status | Progress | Notes |
|-------|--------|----------|-------|
| 1. Core Backend | ✅ | ~95% | Routes + schema through `0012` |
| 2. Auth & Sessions | ✅ | ~95% | PIN/WebAuthn/lockout/family chart |
| 3. Admin Tools & AI | ✅ | ~90% | Restore guarded; AI review statistical |
| 4. Frontend & Dash | ✅ | ~90% | Product paths; niche gaps possible |
| 5. Deploy & Restore | ✅ | ~90% | Migrations in CI; restore manual+guards |
| 6. Testing & QA | ✅ | ~80% | Real SQLite round-trip; live E2E optional |
| **Total** | **Family-dev ready** | **~90%** | Residual: staging D1, full-file DR size limits, live drill |

---

## Final notes

### Infrastructure
- **Worker**: Cloudflare Workers (Hono)
- **Pages**: Cloudflare Pages frontend
- **Database**: D1
- **Storage**: Backblaze B2

### Maintenance
- Backups: daily cron (metadata + manifest; optional manual `include_files`)
- Reminders: cron ~every 15 minutes
- Ops docs: `docs/ENVIRONMENT.md`, hardening summary in root `TODO.md`

### Credits
- Original: [Veta-one](https://github.com/Veta-one)
- Serverless fork: [EdMuller1986](https://github.com/EdMuller1986)
