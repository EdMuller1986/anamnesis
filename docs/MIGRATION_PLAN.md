# Migration Plan: VPS → Serverless

This document tracks the migration of Anamnesis from a traditional VPS setup to free serverless infrastructure (Cloudflare Workers + D1 + Backblaze B2).

## 🎯 Goals

1. **Zero monthly cost** for typical single-family usage
2. **Feature parity** with original implementation
3. **Maintain security** (encryption, authentication, session management)
4. **Preserve AI coordinator protocol** (HTTP API compatibility)
5. **Git-based deployment** (push to deploy via GitHub Actions)

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

### Core Routes Migrated
- [x] `/api/documents` - File upload/download to B2
- [x] `/api/diagnoses` - CRUD operations
- [x] `/api/medications` - CRUD operations
- [x] `/api/lab-results` - CRUD with grouping
- [x] `/api/plan` - Treatment plan management
- [x] `/api/specialists` - Specialist directory
- [x] `/api/timeline` - Events with nested documents
- [x] `/api/patient` - Patient info CRUD

### Configuration & Security
- [x] Create `wrangler.toml` template with placeholders
- [x] Implement `.local` config system for real secrets
- [x] Add `*.local` files to `.gitignore`
- [x] Set up Wrangler secrets (`B2_APPLICATION_KEY`)
- [x] Document environment setup in `docs/ENVIRONMENT.md`

### CI/CD
- [x] Create GitHub Actions workflow
- [x] Configure Cloudflare API tokens as GitHub secrets
- [x] Set up automatic deployment on push to `master`
- [x] Add deployment status badge to README

---

## ✅ Phase 2: Authentication & Sessions (COMPLETED)

### PIN Authentication
- [x] Migrate PIN hashing from Node.js `crypto.scrypt` to Workers
  - [x] Implemented using `crypto.subtle.deriveBits` with PBKDF2
- [x] Update `/api/auth/login` route
- [x] Implement rate limiting for login attempts (D1-based lockout)

### WebAuthn (Biometric)
- [ ] Migrate WebAuthn challenge generation
- [ ] Update `/api/webauthn/register/options`
- [ ] Update `/api/webauthn/register/verify`
- [ ] Update `/api/webauthn/login/options`
- [ ] Update `/api/webauthn/login/verify`
- [ ] Store WebAuthn credentials in D1

### Session Management
- [x] Migrate session tokens to D1 (`sessions` table)
- [x] Implement session middleware for Hono
- [x] Add session expiration and cleanup
- [x] Add sliding expiry (touch session on each request)

### Auth Middleware
- [x] Update `authMiddleware` to work with D1 sessions
- [x] Support `X-Session-Token` header for frontend compatibility
- [x] Add patientId context to all requests

---

## 📋 Phase 3: Admin Tools & AI Coordinator API (IN PROGRESS)

### Admin Tools Migration
These are HTTP endpoints used by the AI coordinator:

- [ ] `/api/admin/tools/ai-review`
- [ ] `/api/admin/tools/integrity`
- [ ] `/api/admin/tools/orphan-check`
- [ ] `/api/admin/tools/impact`
- [ ] `/api/admin/tools/sql`
- [ ] `/api/admin/tools/search`
- [ ] `/api/admin/tools/changelog`
- [ ] `/api/admin/tools/mark-reviewed`
- [ ] `/api/admin/tools/since-last-review`
- [ ] `/api/admin/tools/backup-now`

### Full-Text Search (FTS5)
- [x] Verify FTS5 support in Cloudflare D1 (Confirmed: Supported)
- [x] Create FTS5 virtual tables in migration (`0001_initial.sql`)
- [x] Add FTS triggers for `timeline`, `documents`, and `comments`
- [ ] Implement `/api/search` endpoint

---

## ✅ Phase 4: Frontend & Dashboard (COMPLETED)

### Dashboard Routes
- [x] `/api/dashboard` - Aggregated statistics
- [x] `/api/dashboard/ai-summary` - AI-generated summary
- [x] `/api/dashboard/anomalies` - Lab result anomalies
- [x] `/api/dashboard/upcoming` - Upcoming appointments/reminders

### Growth & Vaccination
- [x] `/api/growth` - Migrated
- [x] `/api/vaccinations` - Migrated

### Reminders
- [x] `/api/reminders` - CRUD migrated
- [ ] Implement reminder notification system (replace systemd timers)

### Health Graph
- [ ] `/api/graph` - Generate Cytoscape graph data
- [ ] Optimize graph queries for D1 performance

### Export
- [ ] `/api/export/pdf` - Generate shareable PDF summary

---

## ✅ Phase 5: Deployment & Optimization (COMPLETED)

### Frontend Deployment
- [x] Set up Cloudflare Pages project (`anamnesis-frontend`)
- [x] Configure Pages build settings in GitHub Actions
- [x] Update `_redirects` for API proxying (Note: using absolute URL in client.ts as fallback)

### Performance Optimization
- [ ] Implement edge caching for read-heavy endpoints
  - Use `Cache-Control` headers
  - Cache patient lists, specialists, etc.
- [ ] Add database indexes for common queries
- [ ] Optimize D1 queries (reduce round trips)
- [ ] Implement request batching where possible
- [ ] Add response compression

### Multi-Region
- [ ] Test Workers performance across regions
- [ ] Consider D1 read replicas (when available)
- [ ] Optimize B2 region selection (closest to users)

### Monitoring
- [ ] Set up Cloudflare Analytics for Workers
- [ ] Add error tracking (Sentry or Cloudflare Workers Analytics)
- [ ] Create dashboard for request metrics
- [ ] Set up alerts for errors/rate limits

**Estimated time:** 3-5 days

---

## 🧪 Phase 6: Testing & Quality Assurance (PLANNED)

See [`TESTING_PLAN.md`](TESTING_PLAN.md) for detailed test strategy.

**Estimated time:** 5-7 days

---

## 📊 Migration Progress Summary

| Phase | Status | Progress | Estimated Time | Actual Time |
|-------|--------|----------|---------------|-------------|
| 1. Core Backend | ✅ Completed | 100% | 5 days | 3 days |
| 2. Auth & Sessions | 🚧 In Progress | 20% | 3-4 days | TBD |
| 3. Admin Tools & AI API | 📋 Planned | 0% | 5-7 days | TBD |
| 4. Frontend & Dashboard | 📋 Planned | 0% | 7-10 days | TBD |
| 5. Deployment & Optimization | 📋 Planned | 0% | 3-5 days | TBD |
| 6. Testing & QA | 📋 Planned | 0% | 5-7 days | TBD |
| **Total** | | **20%** | **28-38 days** | **3 days** |

---

## 🚨 Known Limitations & Workarounds

### Cloudflare Workers Constraints
1. **No filesystem access**
   - ✅ Solved: Use Backblaze B2 for file storage
   
2. **Limited CPU time** (50ms for free tier, 30s for paid)
   - ⚠️ May affect: PDF generation, large data exports
   - Workaround: Use Cloudflare Browser Rendering or client-side generation

3. **No native crypto.scrypt**
   - ⚠️ Affects: PIN hashing
   - Workaround: Use crypto.subtle.deriveBits with PBKDF2

4. **Request size limits** (100 MB)
   - ⚠️ May affect: Large file uploads
   - Workaround: Direct upload to B2 with signed URLs

### D1 Constraints
1. **FTS5 support unclear**
   - 🔍 Need to verify: Is FTS5 available in D1?
   - Fallback: Implement search at application level

2. **No stored procedures**
   - ✅ Solved: Move logic to application code

3. **Read performance** (eventually consistent reads)
   - ⚠️ May affect: Real-time updates
   - Workaround: Use optimistic UI updates

### Backblaze B2 Constraints
1. **Egress costs** (beyond 3x storage)
   - ⚠️ May affect: High download usage
   - Mitigation: Use Cloudflare caching

---

## 🎯 Next Steps (Immediate Priorities)

1. **Complete Phase 2** (Auth & Sessions)
   - Implement crypto.subtle-based password hashing
   - Migrate session management to D1
   - Test authentication flow end-to-end

2. **Verify D1 FTS5 support**
   - Create test migration with FTS5 virtual table
   - Test search functionality
   - Document findings

3. **Begin Phase 3** (Admin Tools)
   - Start with simple tools (`integrity`, `orphan-check`)
   - Test AI coordinator protocol compatibility
   - Document API changes (if any)

---

## 📝 Notes

- Original repository: https://github.com/Veta-one/anamnesis
- Keep upstream in sync: `git fetch upstream`
- Migration started: 2026-07-20
- Target completion: TBD (estimated 4-6 weeks)
