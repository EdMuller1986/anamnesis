# Testing Plan: Anamnesis Serverless Migration

This document outlines the testing strategy for validating the migration from VPS to serverless infrastructure.

## 🎯 Testing Goals

1. **Functional parity**: All features work identically to the original
2. **Data integrity**: No data loss or corruption during operations
3. **Security**: Authentication, authorization, and data isolation work correctly
4. **Performance**: Response times acceptable for single-family usage
5. **Reliability**: Handle edge cases and errors gracefully

---

## 🧪 Test Levels

### 1. Unit Tests
Test individual functions and modules in isolation.

### 2. Integration Tests
Test interactions between components (API → D1, Workers → B2).

### 3. End-to-End Tests
Test complete user flows through the UI.

### 4. Security Tests
Test authentication, authorization, and data access controls.

### 5. Performance Tests
Test response times and resource usage under load.

---

## 📋 Phase 1: Core Backend Routes (Current Priority)

### `/api/diagnoses`

#### Unit Tests
- [ ] `GET /api/diagnoses` returns all diagnoses for patient
- [ ] `GET /api/diagnoses?status=active` filters by status
- [ ] `GET /api/diagnoses/:id` returns single diagnosis
- [ ] `POST /api/diagnoses` creates new diagnosis
- [ ] `POST /api/diagnoses` validates required fields (name)
- [ ] `PUT /api/diagnoses/:id` updates diagnosis
- [ ] `DELETE /api/diagnoses/:id` removes diagnosis
- [ ] Operations isolated by patient ID (no cross-patient access)

#### Edge Cases
- [ ] Non-existent ID returns 404
- [ ] Missing required fields return 400
- [ ] SQL injection attempts are blocked
- [ ] Large text fields (notes) handled correctly
- [ ] Unicode/emoji in text fields

#### Data Integrity
- [ ] Created diagnosis has correct timestamp
- [ ] Updated diagnosis updates `updated_at`
- [ ] Deleted diagnosis is fully removed from D1
- [ ] Foreign key to patient is enforced

---

### `/api/medications`

#### Unit Tests
- [ ] `GET /api/medications` returns all medications
- [ ] `GET /api/medications?status=active` filters correctly
- [ ] Join with specialists resolves names correctly
- [ ] `POST /api/medications` creates medication
- [ ] `PUT /api/medications/:id` updates fields
- [ ] `DELETE /api/medications/:id` removes medication

#### Edge Cases
- [ ] Medication with non-existent specialist_id (should allow NULL)
- [ ] Very long dosage instructions
- [ ] Special characters in medication names

#### Data Integrity
- [ ] Foreign key to specialist (if present)
- [ ] Cascade behavior on specialist deletion (SET NULL or RESTRICT)

---

### `/api/lab-results`

#### Unit Tests
- [ ] `GET /api/lab-results` returns all results
- [ ] `GET /api/lab-results?group_by=parameter` groups correctly
- [ ] Grouped results maintain sort order (by date DESC)
- [ ] `POST /api/lab-results` creates result
- [ ] Validates required fields (test_date, test_name, parameter)
- [ ] `PUT` and `DELETE` operations work

#### Edge Cases
- [ ] Numeric values with decimals (e.g., 12.5 mmol/L)
- [ ] NULL ref_min/ref_max (no reference range)
- [ ] Very large result sets (100+ tests)

#### Data Integrity
- [ ] Foreign keys to timeline, specialist enforced
- [ ] Status values constrained to valid set

---

### `/api/plan`

#### Unit Tests
- [ ] `GET /api/plan` returns all plan items
- [ ] `GET /api/plan?status=pending` filters correctly
- [ ] `GET /api/plan?priority=urgent` filters correctly
- [ ] `POST /api/plan` sets completed_at when status=done
- [ ] `PUT /api/plan/:id` updates completed_at on status change
- [ ] Priority values validated

#### Edge Cases
- [ ] Changing status from done → pending clears completed_at
- [ ] Very long detail text
- [ ] NULL due_date (no deadline)

---

### `/api/specialists`

#### Unit Tests
- [ ] `GET /api/specialists` returns all specialists
- [ ] `POST /api/specialists` creates specialist
- [ ] `PUT /api/specialists/:id` updates info
- [ ] `DELETE /api/specialists/:id` removes specialist

#### Data Integrity
- [ ] Deleting specialist with linked medications (check cascade/restrict)
- [ ] Deleting specialist with lab results

---

### `/api/timeline`

#### Unit Tests
- [ ] `GET /api/timeline` returns events with nested documents
- [ ] `GET /api/timeline?from=2026-01-01` filters by date
- [ ] `GET /api/timeline?category=visit` filters by category
- [ ] Join with specialists works
- [ ] Documents array populated correctly
- [ ] `POST /api/timeline` creates event
- [ ] `DELETE /api/timeline/:id` removes event

#### Edge Cases
- [ ] Event with no documents (empty array)
- [ ] Event with multiple documents
- [ ] Very long descriptions

#### Data Integrity
- [ ] Foreign key to specialist
- [ ] Cascade delete of documents when timeline deleted

---

### `/api/patient`

#### Unit Tests
- [ ] `GET /api/patient/list` returns all patients
- [ ] `GET /api/patient` returns current patient
- [ ] `POST /api/patient` creates new patient
- [ ] Validates required field (name)

#### Edge Cases
- [ ] Patient with no diagnoses/medications (empty state)

---

### `/api/documents`

#### Unit Tests
- [ ] `POST /api/documents` uploads file to B2
- [ ] Returns document record with B2 path
- [ ] `GET /api/documents/:id/download` generates signed B2 URL
- [ ] Signed URL is time-limited (expires)
- [ ] `DELETE /api/documents/:id` removes from D1 and B2

#### Integration Tests (Workers + B2)
- [ ] File upload flow: frontend → Workers → B2
- [ ] File download flow: frontend → Workers (signed URL) → B2
- [ ] File types: PDF, PNG, JPG, DOCX
- [ ] Large files (up to 10 MB)

#### Edge Cases
- [ ] Non-existent document ID
- [ ] Expired signed URL
- [ ] Upload with invalid file type
- [ ] Upload exceeding size limit

#### Security
- [ ] Signed URLs cannot be guessed or forged
- [ ] Patient isolation: cannot access other patients' documents
- [ ] CORS configured correctly on B2 bucket

---

## 📋 Phase 2: Authentication & Sessions

### PIN Authentication

#### Unit Tests
- [ ] `POST /api/auth/login` with correct PIN succeeds
- [ ] Returns session token
- [ ] `POST /api/auth/login` with wrong PIN fails
- [ ] Rate limiting after 5 failed attempts (exponential backoff)
- [ ] `POST /api/auth/logout` invalidates session

#### Security
- [ ] PIN is never stored in plaintext
- [ ] Hashed with sufficient cost factor (time > 100ms)
- [ ] Timing attacks mitigated (constant-time comparison)

---

### WebAuthn (Biometric)

#### Unit Tests
- [ ] `POST /api/webauthn/register/options` generates challenge
- [ ] `POST /api/webauthn/register/verify` stores credential
- [ ] `POST /api/webauthn/login/options` generates challenge
- [ ] `POST /api/webauthn/login/verify` authenticates user

#### Security
- [ ] Challenge is cryptographically random and unique
- [ ] Challenge expires after 5 minutes
- [ ] Replay attacks prevented

---

### Session Management

#### Unit Tests
- [ ] Session token created on login
- [ ] Session persisted in D1
- [ ] Session retrieved by token
- [ ] Session expires after inactivity (e.g., 30 days)
- [ ] Session cleanup job removes expired sessions

#### Security
- [ ] Session token is cryptographically random (128+ bits)
- [ ] Session hijacking: cannot use token from different IP/user-agent (device trust)
- [ ] Concurrent sessions: max N sessions per user

---

### Auth Middleware

#### Integration Tests
- [ ] Protected routes reject requests without token (401)
- [ ] Protected routes accept valid token
- [ ] Public routes accessible without token
- [ ] Patient switching requires valid patient ID in session

---

## 📋 Phase 3: Admin Tools & AI Coordinator API

### `/api/admin/tools/integrity`

#### Tests
- [ ] Detects orphaned diagnoses (no patient)
- [ ] Detects orphaned documents (no timeline, no patient)
- [ ] Detects invalid foreign keys
- [ ] Returns report with counts and examples

---

### `/api/admin/tools/search` (FTS5)

#### Tests
- [ ] Searches across diagnoses, medications, timeline
- [ ] Supports Cyrillic/multilingual text
- [ ] Ranks results by relevance
- [ ] Handles special characters (quotes, wildcards)

#### Performance
- [ ] Search completes in <500ms for 1000+ records

---

### `/api/admin/tools/sql`

#### Security
- [ ] Only allows SELECT queries (no INSERT/UPDATE/DELETE)
- [ ] Blocks DROP, ALTER, PRAGMA
- [ ] Rate limited (max 10 queries/min)
- [ ] Logs all queries for audit

---

### `/api/admin/tools/backup-now`

#### Tests
- [ ] Exports D1 database to SQLite file
- [ ] Encrypts SQLite file
- [ ] Uploads encrypted file to B2
- [ ] Returns backup metadata (timestamp, size)

#### Data Integrity
- [ ] Backup can be restored and decrypted
- [ ] Restored database matches original (schema + data)

---

## 📋 Phase 4: Frontend & Dashboard

### Dashboard

#### E2E Tests
- [ ] Dashboard loads statistics correctly
- [ ] Active diagnoses count matches database
- [ ] Current medications displayed
- [ ] AI summary fetched and rendered

---

### Reminders

#### Tests
- [ ] Create reminder with notification date
- [ ] Scheduled job triggers notification (email/webhook)
- [ ] Reminder marked as sent

---

### Export to PDF

#### Tests
- [ ] Generate PDF with patient summary
- [ ] PDF includes diagnoses, medications, timeline
- [ ] PDF downloadable

---

## 🔒 Security Testing

### Authentication & Authorization
- [ ] Brute force login attempts blocked
- [ ] Session fixation prevented
- [ ] CSRF tokens not required (stateless API)
- [ ] XSS: user input sanitized before rendering

### Data Isolation
- [ ] User A cannot access User B's data
- [ ] Patient 1 data not visible when logged in as Patient 2
- [ ] SQL injection via query params blocked

### CORS
- [ ] CORS headers configured correctly
- [ ] Only allowed origins can make requests
- [ ] Credentials (cookies) not exposed to untrusted origins

### B2 Security
- [ ] Signed URLs expire after short time (e.g., 5 minutes)
- [ ] Bucket not publicly readable (requires signed URLs)
- [ ] B2 credentials not exposed in frontend code

---

## ⚡ Performance Testing

### Response Times (Target: p95 < 500ms)
- [ ] `GET /api/dashboard` < 300ms
- [ ] `GET /api/timeline` (50 events) < 400ms
- [ ] `GET /api/lab-results?group_by=parameter` (100 results) < 500ms
- [ ] `POST /api/documents` (5 MB file) < 2s

### D1 Query Performance
- [ ] Simple SELECT by ID < 50ms
- [ ] JOIN with 2 tables < 100ms
- [ ] FTS5 search < 200ms

### B2 Upload/Download
- [ ] Upload 5 MB file < 2s
- [ ] Generate signed URL < 50ms
- [ ] Download via signed URL (depends on B2 CDN)

### Cloudflare Workers CPU
- [ ] No route exceeds 50ms CPU time (free tier limit)
- [ ] Complex queries optimized to stay under limit

---

## 🛠️ Testing Tools & Setup

### Unit & Integration Tests
- **Framework**: Vitest (for Workers environment)
- **D1 Mocking**: `@cloudflare/workers-types` + local D1
- **B2 Mocking**: Stub S3 client with test responses

### E2E Tests
- **Framework**: Playwright or Cypress
- **Environment**: Local Wrangler dev + frontend dev server
- **Test data**: Seed database with realistic fixtures

### Performance Tests
- **Tool**: k6 or Artillery
- **Metrics**: Response time, throughput, error rate
- **Load profile**: 10 concurrent users, 100 requests/min

### Security Tests
- **OWASP ZAP** for vulnerability scanning
- **Manual penetration testing** for auth flows

---

## 📊 Test Coverage Goals

| Component | Unit Tests | Integration Tests | E2E Tests | Target Coverage |
|-----------|------------|-------------------|-----------|-----------------|
| Backend routes | ✅ Required | ✅ Required | - | 80%+ |
| Auth & sessions | ✅ Required | ✅ Required | ✅ Required | 90%+ |
| Admin tools | ✅ Required | ⚠️ Optional | - | 70%+ |
| Frontend | ⚠️ Optional | - | ✅ Required | 60%+ |

---

## 🚀 Testing Phases

### Phase 1: Smoke Testing (1 day)
- Run basic CRUD operations on all routes
- Verify no crashes or 500 errors
- Check database migrations applied correctly

### Phase 2: Functional Testing (3 days)
- Complete unit tests for all routes
- Integration tests for Workers + D1 + B2
- Verify data integrity constraints

### Phase 3: Security Testing (2 days)
- Authentication and authorization flows
- Input validation and SQL injection
- CORS and signed URL security

### Phase 4: Performance Testing (1 day)
- Baseline response times
- Identify slow queries
- Optimize as needed

### Phase 5: E2E Testing (2 days)
- User flows: create patient → add diagnosis → upload document
- AI coordinator workflows
- Dashboard and reports

---

## ✅ Acceptance Criteria

The migration is **complete** when:

1. ✅ All backend routes pass unit tests (80%+ coverage)
2. ✅ Authentication and sessions work end-to-end
3. ✅ File upload/download to B2 works reliably
4. ✅ No data loss or corruption in D1 operations
5. ✅ Response times < 500ms (p95)
6. ✅ Security tests pass (no critical vulnerabilities)
7. ✅ AI coordinator can use all admin tools
8. ✅ Frontend deploys to Cloudflare Pages and loads correctly
9. ✅ CI/CD pipeline runs tests automatically
10. ✅ Documentation complete (setup, API, troubleshooting)

---

## 📝 Test Execution Log

| Date | Phase | Tests Run | Pass | Fail | Notes |
|------|-------|-----------|------|------|-------|
| 2026-07-20 | Smoke | Manual | - | - | Backend routes migrated, not tested yet |

---

## 🐛 Known Issues & Blockers

None yet. Will update as testing progresses.

---

## 📚 References

- [Cloudflare Workers Testing Docs](https://developers.cloudflare.com/workers/testing/)
- [D1 Best Practices](https://developers.cloudflare.com/d1/platform/best-practices/)
- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
