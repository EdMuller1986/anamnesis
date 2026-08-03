# Migration Plan: VPS → Serverless (IN PROGRESS — NOT PRODUCTION-READY)

This document tracks the migration of Anamnesis from a traditional VPS setup to free serverless infrastructure (Cloudflare Workers + D1 + Backblaze B2).

> **Honest status (2026-07):** Architectural port to Hono/D1/B2 exists, but **feature parity, security isolation, backup/restore, and data migration are incomplete**. See root `TODO.md`. Do not treat checklist items below as verified production truth.

## 🎯 Goals

1. **Zero monthly cost** for typical single-family usage (partially achieved for free-tier stack)
2. **Feature parity** with original implementation (❌ incomplete — see TODO.md)
3. **Maintain security** (encryption, authentication, session management) (⚠️ regressions — P0 hardening in progress)
4. **Preserve AI coordinator protocol** (HTTP API compatibility) (partial)
5. **Git-based deployment** (push to deploy via GitHub Actions) (✅ CI deploys Worker/Pages; D1 migrations not applied automatically)

---

## ✅ Phase 1: Core Backend Infrastructure (COMPLETED)

### Backend Framework Migration
- [x] Replace Express with Hono (Workers-compatible)
- [x] Update all route handlers to Hono context API
- [x] Replace Node.js modules with Workers-compatible alternatives
- [x] Configure CORS middleware for Hono
- [x] Set up local development environment with Wrangler

### Database Migration
- [x] Create D1 database instance
- [x] Convert PostgreSQL syntax to SQLite (`$1` → `?`)
- [x] Replace `pool.query()` with D1 bindings (`c.env.DB.prepare()`)
- [x] Create initial migration `0001_initial.sql` with full schema
- [x] Test migrations locally with `wrangler d1 migrations apply --local`
- [x] Test foreign key constraints and triggers in D1

### File Storage Migration
- [x] Create Backblaze B2 bucket
- [x] Implement S3-compatible API client (`b2-storage.js`)
- [x] Replace `fs` operations with B2 uploads/downloads
- [x] Implement signed URL generation for secure file access
- [x] Configure CORS on B2 bucket for frontend access
- [x] **New**: Implement streaming proxy in Worker to bypass CORS for client-side rendering (pdf.js)

### Core Routes Migrated
- [x] `/api/documents` - File upload/download (streaming)
- [x] `/api/diagnoses` - CRUD operations
- [x] `/api/medications` - CRUD operations
- [x] `/api/lab-results` - CRUD with parameter/norm mapping
- [x] `/api/plan` - Treatment plan management
- [x] `/api/specialists` - Specialist directory
- [x] `/api/timeline` - Events with nested documents
- [x] `/api/patient` - Patient info CRUD

---

## ✅ Phase 2: Authentication & Sessions (COMPLETED)

### PIN Authentication
- [x] Migrate PIN hashing from Node.js `crypto.scrypt` to Workers
  - [x] Implemented using `crypto.subtle.deriveBits` with PBKDF2
- [x] Update `/api/auth/login` route (Two-phase with Device Verification)
- [x] Implement rate limiting for login attempts (D1-based lockout)

### WebAuthn (Biometric)
- [x] Migrate WebAuthn challenge generation (Web Crypto API)
- [x] Update registration and authentication verification routes
- [x] Store and manage WebAuthn credentials in D1
- [x] Add UI for passkey management (list/delete)

### Session Management
- [x] Migrate session tokens to D1 (`sessions` table)
- [x] Implement session middleware for Hono
- [x] Add session expiration, revocation, and cleanup
- [x] Add sliding expiry (touch session on each request)
- [x] Implement "Logout All Other Devices" functionality

### Device Trust
- [x] Implement "Security Question" for unknown devices
- [x] Track known devices in D1 (`known_devices` table)
- [x] Support device revocation and session invalidation

---

## ✅ Phase 3: Admin Tools & AI Coordinator API (COMPLETED)

### Admin Tools Migration
- [x] `/api/admin/tools/ai-review` - Statistical health check
- [x] `/api/admin/tools/integrity` - FTS/DB consistency check
- [x] `/api/admin/tools/orphan-check` - Cleanup of unused files/links
- [x] `/api/admin/tools/sql` - Remote SQL execution for AI
- [x] `/api/admin/tools/search` - Global FTS5 search
- [x] `/api/admin/tools/changelog` - Audit log for AI reasoning
- [x] Complete AI CRUD support for ALL tables (Analyses, Vaccinations, Growth, Plans)
- [x] Verify FTS5 support in Cloudflare D1 (Confirmed: Fully Supported)

### Automated Backups
- [x] Daily encrypted backups (AES-GCM) via Cron Trigger
- [x] Dual-destination: Telegram bot + Backblaze B2
- [x] Hash-based deduplication (skip backup if data didn't change)
- [x] 5-file rotation in storage
- [x] Manual trigger: `/api/admin/tools/backup-now`

---

## ✅ Phase 4: Frontend & Dashboard (COMPLETED)

### Features & UI
- [x] Dashboard — AI summaries, upcoming tasks, anomaly alerts
- [x] History & Search — Global search with FTS5
- [x] Export — Print-friendly HTML reports with all medical data
- [x] Previews — **New**: Full client-side PDF rendering using `pdf.js` (No backend dependencies)
- [x] Performance — Optimized TanStack Query caching

### Reminders
- [x] `/api/reminders` - Full CRUD
- [x] **New**: Automated Telegram notifications via Cron Trigger (`*/15 min`)

---

## ✅ Phase 5: Deployment & Optimization (COMPLETED)

### CI/CD Pipeline
- [x] GitHub Actions → Cloudflare Workers + Pages
- [x] Automatic secret injection during build
- [x] **New**: Functional validation of secrets (B2 Auth, Telegram API, Crypto logic)

### Disaster Recovery
- [ ] Automated restore from B2 backup: **DISABLED** (`/api/admin/tools/restore-from-backup` returns 503 until rewrite)
- [x] Manual "Full Restore" option in GitHub Action workflow (Wipe & Restore)

---

## ✅ Phase 6: Testing & Quality Assurance (COMPLETED)

### Test Coverage (16+ Integration Tests)
- [x] API Health & Versioning
- [x] Auth flow (PIN, lockout, session validation)
- [x] Storage access (Streaming, token authorization)
- [x] Data integrity (CRUD, Wipe, Restore logic)
- [x] Background tasks (Scheduler, Encryption verification)

---

## 📊 Migration Progress Summary (revised)

| Phase | Status | Progress | Notes |
|-------|--------|----------|-------|
| 1. Core Backend | ⚠️ Partial | ~70% | Hono routes exist; schema/API gaps remain |
| 2. Auth & Sessions | ⚠️ Partial | ~50% | PIN/session work; WebAuthn revoke, expiry, multi-patient bugs |
| 3. Admin Tools & AI | ⚠️ Partial | ~40% | Integrity/AI review stubbed; restore **disabled** |
| 4. Frontend & Dash | ⚠️ Partial | ~75% | P2: schema fields + CRUD parity improved; dual-name cleanup still open |
| 5. Deploy & Restore | ⚠️ Partial | ~40% | Deploy works; no auto D1 migrations; restore off |
| 6. Testing & QA | ❌ Incomplete | ~20% | Many mocks; no real backup→wipe→restore cycle |
| **Total** | **Not production-ready** | **~40–50%** | Track work in TODO.md / P0 plan |

---

## 🚨 Final Notes

### Infrastructure
- **Worker**: `anamnesis-backend.workers.dev`
- **Pages**: `anamnesis-frontend.pages.dev`
- **Database**: D1 (Standard D1 storage)
- **Storage**: Backblaze B2 (Region-specific S3 endpoint)

### Maintenance
- Backups run at **02:00 UTC** daily.
- Reminders check every **15 minutes**.

---

- Original author: [Veta-one](https://github.com/Veta-one)
- Serverless migration: [EdMuller1986](https://github.com/EdMuller1986)
- Completion Date: **2026-07-29**
