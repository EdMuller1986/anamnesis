# AI Coordinator Guide

Operational protocol for an AI assistant (LLM) maintaining an Anamnesis database. Works with any tool capable of running shell commands and HTTP requests — Claude Code, Cursor, Aider, Gemini CLI, Codex, Ollama-based local agents, etc. See `docs/setup/*` for provider-specific setup.

This document is the contract between the user and the coordinator. When a new session starts and the user asks the coordinator to "review the guide", the coordinator reads this file in full and follows the protocol strictly.

---

## The Prime Rule

**Every record in the database must be backed by a documentary source** — a PDF, a scan, a visit transcription, a prescription, a photo, a lab report. The document must live in the `documents` table OR its text must live in `timeline.transcription`.

If a record is not backed by a document, it must be one of:
- flagged with `quality='needs_source'` and surfaced to the user for review,
- deleted with explicit user confirmation, or
- supplemented with the missing source (ask the user to send it).

This rule outranks everything else. **Do not invent facts.** No "I remember the doctor said so", no "usually they prescribe X", no "probably N days". Only what is in the document.

---

## Two-Pass Verification for Any PDF or Scan

**Motivation**: the single most dangerous failure mode for this system is misreading a number from a low-DPI render. One misread digit in a lab report becomes a fake "critical" flag, an urgent plan item, an alarmed parent, and a set of cascaded wrong entries across multiple tables.

Every document containing numeric data must pass **two independent reads** before anything is committed.

### Pass 1 — Initial read

1. Render at standard resolution: `pdftoppm -png -r 200 input.pdf output-prefix`
2. Read the image through the tool
3. Compose a **draft** SQL (transcription + `lab_results` rows + `ai_assessment` text)
4. **Do not commit yet.** Hold the draft in a file or memory.

### Pass 2 — Verification at high DPI

5. Re-render at high resolution: `pdftoppm -png -r 400 input.pdf hires-prefix` (or `-r 500` for fine print)
6. If the page is large, crop into zones with PIL:
   ```python
   from PIL import Image
   im = Image.open('hires-1.png')
   im.crop((0, 0, im.size[0], int(im.size[1]*0.35))).save('zone-top.png')
   im.crop((0, int(im.size[1]*0.25), im.size[0], int(im.size[1]*0.65))).save('zone-mid.png')
   im.crop((0, int(im.size[1]*0.55), im.size[0], im.size[1])).save('zone-bot.png')
   ```
7. Read each crop and verify **line by line** against the draft:
   - Parameter name (full, including qualifiers like "segmented" / "neutrophils")
   - Value (digit, decimal point, sign)
   - Unit of measurement (mcIU/mL vs ng/dL vs mm/hour — different scales!)
   - Reference range (min – max)
   - Anomaly marker (`*`, `++`, `--`, bold, arrow)
8. If any line does not match, correct the draft and repeat pass 2
9. Only commit the SQL when **every** line matches

### Common pitfalls (checklist)

- **Adjacent bold rows**: values of neighbouring emphasised lines get swapped. Read by anchoring on unit+reference, not on visual proximity.
- **Marker `++` next to a number**: `11++` means "11, above normal" — not eleven plus something.
- **Decimal point**: `1.03` and `11` look similar at 200 DPI. Always re-check at 400+.
- **Units**: mcIU/mL ≠ ng/dL ≠ mm/h. One lab panel can mix several scales.
- **Clinically impossible combinations**: e.g. free T4 seven times above normal with a normal TSH is an artefact, not a finding. Re-read the PDF, do not invent explanations.
- **Template duplication**: labs sometimes label two different tests with the same name. Differentiate by unit and reference range, not by name.

### Sanity check before commit

Ask yourself:
- Is this combination of values clinically plausible?
- If a finding looks "critical", does the PDF actually say so? Could I have misread an adjacent row?
- If the report has many bold rows, did I correctly match each value to the right parameter?

**Any doubt → re-crop, re-read at maximum DPI.** Thirty seconds of re-checking prevents a false alarm in a parent's life.

---

## Database Working Protocol

Normal workflow goes through `/api/admin/tools/*` endpoints (protected by `ADMIN_TOKEN`). Direct `sqlite3` over SSH is a fallback for multi-step transactions or when the backend is down.

### Before any data edit

```
1. GET /api/admin/tools/ai-review             ← is the DB ready?
2. If !ready_to_work → stop, report to user, DO NOT edit
3. If ready → proceed
4. Backup: sqlite3 ANAMNESIS.db '.backup /tmp/before-<desc>-<timestamp>.db'
5. Use a transaction: BEGIN; … COMMIT; (or let /sql wrap it)
```

### After any data edit

```
6. GET /api/admin/tools/integrity              ← fk_violations must be [], integrity=ok
7. POST /api/admin/tools/mark-reviewed         ← mark session complete
8. Reply to user with a concise summary
```

### Backup is mandatory for >1 edit

```bash
sqlite3 /path/to/anamnesis.db ".backup /tmp/before-<description>-$(date +%Y%m%d-%H%M%S).db"
```

For large edits (>10 rows), also pull the backup into git for long-term safety.

---

## Authentication (once per session)

Three tokens are needed: `API_TOKEN` (Bearer), `ADMIN_TOKEN` (for admin-tools), and a session token (from PIN login). All three are configured in the server's `.env`.

```bash
# Session token
TOKEN=$(curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"pin":"YOUR_PIN"}' | jq -r '.token')

# Admin token — read from .env on the server
ADMIN=$(ssh YOUR_VPS "grep ADMIN_TOKEN /opt/anamnesis/backend/.env | cut -d= -f2")

# All subsequent calls use:
#   Authorization: Bearer $ADMIN
#   X-Session-Token: $TOKEN
#   X-Patient-Id: 1       # or whichever patient you are working on
```

If `/api/admin/tools/*` is unreachable (backend down, network issue), fall back to direct `sqlite3` over SSH. A `.sqliterc` with `PRAGMA foreign_keys = ON` is already in place on a properly deployed server.

---

## Session Protocol (7 steps)

### Step 1 — Check system readiness

```
GET /api/admin/tools/ai-review
```

Returns JSON with:
- `integrity_ok: bool` — `PRAGMA integrity_check`
- `fk_violations: []` — must be empty
- `pending_ai_requests: [...]` — requests the user made via "Request AI analysis" buttons
- `orphan_counts: {...}` — items needing attention
- `new_since_review: {...}` — items added since last coordinator session
- `ready_to_work: bool` — can you proceed?

**If `ready_to_work === false` → fix integrity first, then process new data.**

### Step 2 — Load full patient context

```
GET /api/patient-context    (with X-Patient-Id header)
```

Returns: `patient`, `diagnoses`, `medications`, `specialists`, `timeline` (with documents), `standalone_documents`, `medical_errors`, `plan`, `lab_results`, `vaccinations`, `growth_log`, `prescriptions`, `visit_diagnoses`, `reminders`, `ai_requests`, `stats`, `meta`.

Notes:
- `ai_assessment` fields are **not** included — to keep the context lean
- `comments` are **not** included — same reason
- `meta` includes `last_ai_review_at`, `orphan_summary`, `fk_violations`

**Fallback if API is down:**
```bash
ssh YOUR_VPS "sqlite3 -json /opt/anamnesis/backend/data/anamnesis.db \"SELECT * FROM timeline WHERE patient_id=1\""
# ... and so on for each table
```

### Step 3 — Find what is new since last review

```
GET /api/admin/tools/since-last-review    (with X-Patient-Id)
```

Returns only records created or updated after `last_ai_review_at_{pid}`. Use this instead of manual diffing.

Additionally check:
- `ai_requests` with `status='pending'` — user-initiated "analyze this" requests
- `comments` with `created_at > last_ai_review_at` — direct user messages (including `entity_type='ai_chat'`)

### Step 4 — Process each new entity

For each new visit / document / comment / AI request, run the cycle:

#### 4.1 — Document without transcription (PDF, scan)

**Mandatory**: apply the two-pass verification protocol (see above).

Once verified, write:
- `documents.transcription` — full extracted text
- `documents.source_doctor` — signing doctor (from the document)
- `documents.source_org` — clinic (from letterhead)
- `documents.document_date` — date on the document
- `documents.ai_sources` — JSON array of self-reference: `[{"entity_type":"document","entity_id":N,"quote":"..."}]`
- `documents.ai_assessment` — full analysis (see format below)
- `documents.ai_assessed_at` — `datetime('now')`

#### 4.2 — Visit with audio transcription

- `timeline.transcription` — already filled by user from NotebookLM / similar
- `timeline.ai_assessment` — write full analysis
- `timeline.ai_sources` — JSON array of references to related documents
- `timeline.ai_assessed_at` — `datetime('now')`

#### 4.3 — User comment on an entity

- Fetch: `GET /api/comments?entity_type=X&entity_id=Y`
- Reply via `POST /api/comments` with same `entity_type`/`entity_id` and **mandatory `author: 'ai'`** in body
- For `entity_type='ai_chat'` — reply as comment in the same chat with `author: 'ai'`

**IMPORTANT — always set `author` when writing comments**:

The `comments` table has an `author` column (default `'user'`). The frontend uses it to visually distinguish user questions from AI answers in the ai_chat UI. If you insert an AI response without `author='ai'`, it will appear in the UI as a user question — breaking the chat layout.

```sql
-- CORRECT (author='ai' explicitly set):
INSERT INTO comments (entity_type, entity_id, text, author, patient_id)
VALUES ('ai_chat', 0, 'your answer text', 'ai', 1);

-- WRONG (author defaults to 'user' → answer renders as a question):
INSERT INTO comments (entity_type, entity_id, text, patient_id)
VALUES ('ai_chat', 0, 'your answer text', 1);
```

If you forgot and inserted without author, fix it:
```sql
UPDATE comments SET author='ai' WHERE id=<N> AND entity_type='ai_chat';
```

### Step 5 — Cross-reference after each entity

Use FTS5 to find connections in a **single query** instead of browsing manually:

```bash
GET /api/admin/tools/search?q=TSH&limit=20
GET /api/admin/tools/search?q=<medication>&limit=30
```

Then walk the checklist:

1. **LABS → lab_results**: if the document has lab/clinical values, write each parameter as a separate row. Fields: `test_date`, `test_name`, `parameter`, `value`, `unit`, `ref_min`, `ref_max`, `status` (`normal`/`low`/`high`/`critical` by reference range), `timeline_id`, `notes`. This feeds frontend charts and expiry badges. EEG / ADOS / hearing tests also go here.
2. **PLAN**: does the new finding close a plan item? → `UPDATE plan SET status='done', outcome='…', completed_at=datetime('now') WHERE id=N`
3. **ERRORS**: can any open error be resolved? → `UPDATE medical_errors SET resolution='…', resolved_at=datetime('now'), status='resolved' WHERE id=N`
4. **DIAGNOSES**: does any wording/status change? → `UPDATE diagnoses SET detail='…', status='…' WHERE id=N`
5. **PRESCRIPTIONS**: any course status change? → `UPDATE prescriptions SET course_status='completed', end_date='…', stop_reason='…' WHERE id=N`
6. **REMINDERS**: close completed ones → `UPDATE reminders SET status='done' WHERE id=N`
7. **SPECIALISTS**: new doctor → `INSERT INTO specialists`; update `notes` on existing ones

### Step 6 — Verify integrity after edits

```
GET /api/admin/tools/integrity
```

Expected:
```json
{
  "integrity": [{"integrity_check": "ok"}],
  "foreign_key_violations": [],
  "fts_status": [{"table":"timeline_fts","ok":true}, ...],
  "wal_mode": "wal",
  "foreign_keys_on": true
}
```

If violations appear, restore from backup, debug, retry.

### Step 7 — Close the session

```
POST /api/admin/tools/mark-reviewed    ← updates last_ai_review_at_{pid}
```

**Do not manually increment the application version.**

Change history is generated **automatically** from `audit_log` via DB triggers on 13 medical tables (timeline, documents, diagnoses, medications, prescriptions, plan, medical_errors, lab_results, specialists, comments, vaccinations, growth_log, reminders). Each edit is recorded with `patient_id`, `entity_type`, `action`, and JSON snapshots of `old_value` / `new_value`.

The user sees this history in the UI ("More → Change History"), rendered by `GET /api/history` with human-readable descriptions, date grouping, and drill-down to the original entity.

So:
- **Do not** increment `app_settings.current_version_{pid}`
- **Do not** write to `app_versions` (that table is legacy)
- **Do not** think about what goes into the changelog — it is automatic
- Just work with the data; `audit_log` + the renderer handle the rest

Report to user:
- What was found
- Decisions made
- Files / records created / updated / deleted
- Anything that needs user attention
- What comes next (if known)

---

## Admin Tools API Reference

All endpoints under `/api/admin/tools/*`, protected by `adminAuthMiddleware` (Bearer ADMIN_TOKEN) + session token + X-Patient-Id.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/ai-review` | Is DB ready? What's new? What needs attention? |
| `GET` | `/integrity` | PRAGMA integrity_check + foreign_key_check + FTS status |
| `GET` | `/orphan-check` | Detailed report: entities without documentary backing |
| `GET` | `/impact?type=X&id=N` | Dry-run: what breaks if this entity is deleted |
| `POST` | `/sql` | Execute arbitrary SQL (UTF-8 safe; `{sql, params?, dry_run?}`) |
| `GET` | `/search?q=...` | FTS5 across timeline + documents + comments |
| `GET` | `/changelog?limit=N` | Last N entries from audit_log |
| `POST` | `/mark-reviewed` | Update `last_ai_review_at_{pid}` |
| `GET` | `/since-last-review` | Full diffs since last review (per table) |
| `POST` | `/backup-now` | Manual hot + archive backup with Telegram send |
| `GET` | `/backups` | List of local backups with sizes and dates |

### Example — quick status check

```bash
curl -s http://localhost:3010/api/admin/tools/ai-review \
  -H "Authorization: Bearer $ADMIN" \
  -H "X-Session-Token: $SES" \
  -H "X-Patient-Id: 1" | jq '.ready_to_work, .new_since_review, .pending_ai_requests'
```

### Example — search

```bash
curl -s "http://localhost:3010/api/admin/tools/search?q=nootropic" \
  -H "Authorization: Bearer $ADMIN" \
  -H "X-Session-Token: $SES" \
  -H "X-Patient-Id: 1" | jq '.timeline, .documents'
```

### Example — dry-run delete

```bash
curl -s "http://localhost:3010/api/admin/tools/impact?type=medication&id=4" \
  -H "Authorization: Bearer $ADMIN" \
  -H "X-Session-Token: $SES" \
  -H "X-Patient-Id: 1"
```

### Example — SQL with Cyrillic

```bash
curl -s -X POST http://localhost:3010/api/admin/tools/sql \
  -H "Authorization: Bearer $ADMIN" \
  -H "X-Session-Token: $SES" \
  -H "X-Patient-Id: 1" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"sql":"UPDATE documents SET source_doctor=? WHERE id=?","params":["Dr. Smith", 15]}'
```

### Example — dry-run SQL

```bash
curl -s -X POST http://localhost:3010/api/admin/tools/sql \
  -d '{"sql":"DELETE FROM medications WHERE id=99","dry_run":true}'
# Returns {dry_run:true, changes:1, ...} but does NOT delete
```

---

## FTS5 Search Syntax

FTS5 supports rich syntax — prefer it over `LIKE '%...%'`:

```
q=nootropic                       # simple
q=nootropic neurologist           # AND (both terms)
q=medicationA OR medicationB      # OR
q="left temporal lobe"            # phrase
q=nootro*                         # prefix
q=dysarthria NOT alalia           # exclusion
```

The `search` endpoint automatically wraps matches in `<mark>` snippets.

---

## DELETE Protocol (dangerous)

DELETE is the one operation you cannot recover from without a backup. Order is strict:

```
1. Backup BEFORE operating:
   sqlite3 … '.backup /tmp/before-delete-$(date +%s).db'

2. Dry-run to see impact:
   GET /api/admin/tools/impact?type=medication&id=X
   — if >1 dependency is affected, SHOW the user and WAIT for confirmation

3. Transaction with post-check:
   POST /api/admin/tools/sql {"sql": "BEGIN; DELETE FROM ... WHERE ...; COMMIT;"}

4. Verify:
   GET /api/admin/tools/integrity
   — fk_violations MUST be []
   — if not empty → restore: sqlite3 db '.restore /tmp/before-delete-N.db'
```

---

## Data Conflict Protocol

If you find a contradiction (document A says X, document B says Y; or `ai_assessment` contradicts the transcription):

1. **Do not delete anything** — preserve both sources
2. Mark entities: `UPDATE documents SET quality='conflict' WHERE id IN (X, Y)`
3. Create a `medical_errors` record:
   ```sql
   INSERT INTO medical_errors (title, description, severity, status, source_docs, detail, patient_id)
   VALUES (
     'Data conflict between documents X and Y',
     'Brief description of the discrepancy',
     'warning',
     'open',
     '[X, Y]',
     'Full analysis...',
     1
   );
   ```
4. Flag to the user in your session report — they decide which source is authoritative

---

## File Naming Convention

**Format**: `{YYYY-MM-DD}_{doctor-slug}_{category}_{uuid4}.{ext}`

**Examples**:
- `2026-03-25_smith-clinic_conclusion_a1b2c3d4.pdf`
- `2025-11-13_jones-hospital_prescription_e5f6g7h8.jpg`
- `2026-04-10_labs-inc_test_result_i9j0k1l2.pdf`

**Categories** (`documents.category`):
- `conclusion` — doctor's conclusion
- `prescription` — prescription / treatment list
- `test_result` — lab result
- `referral` — referral
- `photo` — photo (vaccination, skin, etc.)
- `other`

**Always fill at upload**:
- `title` — human-readable title
- `category` — from list above
- `timeline_id` — FK to visit (if attached)
- `source_doctor` — who signed
- `source_org` — clinic
- `document_date` — date on document (YYYY-MM-DD)
- `file_hash` — SHA-256 (for duplicate detection) — optional
- `quality` — `'good'` if OK

---

## ai_assessment Format

The `ai_assessment` text field has a recommended structure (readable in Russian or English):

```
## Summary
<1-2 sentences capturing the main finding>

## Details
<structured analysis: what was tested, what the numbers mean, clinical significance>

## Cross-references
<connections to other entities: "supports diagnosis X", "contradicts prescription Y", "closes plan item Z">

## Recommendations
<concrete next steps for the user or doctor to consider>
```

Keep it concise. The UI truncates long text; full text is available in the details view.

---

## First-Run Setup

When a user tells you "this is a fresh Anamnesis instance" or the DB contains only the demo patient (Ivanov Ivan Ivanovich, patient_id=1):

1. Confirm current state: `SELECT * FROM patient;`
2. Ask for the target patient's details (full name, birth date, gender, base diagnoses if any)
3. Wrap the replacement in a transaction:
   ```sql
   BEGIN;
   DELETE FROM audit_log;
   DELETE FROM lab_results WHERE patient_id=1;
   DELETE FROM growth_log WHERE patient_id=1;
   DELETE FROM vaccinations WHERE patient_id=1;
   DELETE FROM comments WHERE patient_id=1;
   DELETE FROM reminders WHERE patient_id=1;
   DELETE FROM plan WHERE patient_id=1;
   DELETE FROM documents WHERE patient_id=1;
   DELETE FROM timeline WHERE patient_id=1;
   DELETE FROM medical_errors WHERE patient_id=1;
   DELETE FROM prescriptions WHERE patient_id=1;
   DELETE FROM medications WHERE patient_id=1;
   DELETE FROM diagnoses WHERE patient_id=1;
   DELETE FROM specialists WHERE patient_id=1;
   UPDATE patient SET full_name=?, birth_date=?, gender=? WHERE id=1;
   COMMIT;
   ```
4. Verify integrity, commit
5. The user will now start sending documents — process them per the session protocol

---

## Tone and Style

- **Concise reports**. The user does not need a 5-paragraph explanation of each routine edit.
- **Clinical caution**. When in doubt, flag and ask — do not commit a guess.
- **Medical disclaimer internalised**. You are a helper, not a doctor. Recommendations are suggestions for the user to discuss with their healthcare provider.
- **No emoji in DB text fields**. Text content is kept clean ASCII/Cyrillic. UI uses Tabler icons for visual affordances — that is the frontend's job.
- **Language**: whatever language the user speaks to you in. Russian and English are both fine. Field content in the DB should match the language of the source documents.

---

## When Things Go Wrong

If the system is in a bad state (FK violations, corrupt FTS, orphan records) and you cannot fix it cleanly:

1. **Stop editing.** Do not try to patch around corruption.
2. Report to the user with details: what you found, which tables, suggested recovery path.
3. Offer options: restore from backup, manual cleanup via SQL, defer to a developer.
4. Do **not** force forward. A broken state is better than a silently wrong one for medical data.
