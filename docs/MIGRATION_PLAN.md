# Migration Plan: VPS → Serverless (COMPLETED)

This document tracks the migration of Anamnesis from a traditional VPS setup to free serverless infrastructure (Cloudflare Workers + D1 + Backblaze B2).

## 🎯 Goals

1. **Zero monthly cost** for typical single-family usage (✅ Achieved)
2. **Feature parity** with original implementation (✅ Achieved)
3. **Maintain security** (encryption, authentication, session management) (✅ Achieved)
4. **Preserve AI coordinator protocol** (HTTP API compatibility) (✅ Achieved)
5. **Git-based deployment** (push to deploy via GitHub Actions) (✅ Achieved)

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
- [x] **New**: "External Controller" protocol (GPT-4o review before critical pushes)

### Disaster Recovery
- [x] Automated restore from B2 backup: `/api/admin/tools/restore-from-backup`
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

## 📊 Migration Progress Summary

| Phase | Status | Progress | Estimated Time | Actual Time |
|-------|--------|----------|---------------|-------------|
| 1. Core Backend | ✅ Completed | 100% | 5 days | 3 days |
| 2. Auth & Sessions | ✅ Completed | 100% | 4 days | 2 days |
| 3. Admin Tools & AI | ✅ Completed | 100% | 7 days | 3 days |
| 4. Frontend & Dash | ✅ Completed | 100% | 10 days | 4 days |
| 5. Deploy & Restore | ✅ Completed | 100% | 5 days | 2 days |
| 6. Testing & QA | ✅ Completed | 100% | 7 days | 4 days |
| **Total** | | **100%** | **38 days** | **18 days** |

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
- All critical changes must be reviewed by the **External Controller** (see `GEMINI.md`).

---

- Original author: [Veta-one](https://github.com/Veta-one)
- Serverless migration: [EdMuller1986](https://github.com/EdMuller1986)
- Completion Date: **2026-07-29**
