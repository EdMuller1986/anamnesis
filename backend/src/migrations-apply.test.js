/**
 * Apply all numbered D1 migrations to real SQLite (node:sqlite) — catches
 * ADD COLUMN conflicts and basic schema breakage that mocks miss.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

function loadMigrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/i.test(f))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), 'utf8'),
    }));
}

describe('D1 migrations on real SQLite', () => {
  it('applies all numbered migrations to empty DB without error', () => {
    const db = new DatabaseSync(':memory:');
    // D1/SQLite FTS triggers need FK off for some recreate paths; enable for checks after
    db.exec('PRAGMA foreign_keys = OFF');
    const files = loadMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(9);

    const applied = [];
    for (const file of files) {
      try {
        // exec whole file — triggers contain ';' inside BEGIN...END
        db.exec(file.sql);
      } catch (e) {
        throw new Error(`Migration ${file.name} failed:\n${e.message}`);
      }
      applied.push(file.name);
    }

    // Core tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    for (const t of [
      'patient',
      'timeline',
      'documents',
      'diagnoses',
      'sessions',
      'app_versions',
      'auth_log',
      'rate_limits',
    ]) {
      expect(tables, `missing table ${t}`).toContain(t);
    }

    // app_versions has patient_id (0007)
    const cols = db.prepare('PRAGMA table_info(app_versions)').all().map((c) => c.name);
    expect(cols).toContain('patient_id');

    // Dual-field backfill works on empty patient insert then sync-style update path
    db.prepare(
      `INSERT INTO patient (name, birth_date) VALUES (?, ?)`
    ).run('Test User', '2015-01-01');

    // Re-run 0010 (idempotent backfill)
    const m10 = files.find((f) => f.name.startsWith('0010_'));
    if (m10) db.exec(m10.sql);
    const row = db.prepare('SELECT full_name, date_of_birth FROM patient WHERE id = 1').get();
    expect(row.full_name).toBe('Test User');
    expect(row.date_of_birth).toBe('2015-01-01');

    // PIN-like settings + auth_log insert
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)`
    ).run('pin_hash_1', 'salt$100000$deadbeef');
    db.prepare(
      `INSERT INTO auth_log (patient_id, event, ip) VALUES (1, 'login_ok', '127.0.0.1')`
    ).run();
    const logCount = db.prepare('SELECT COUNT(*) AS c FROM auth_log').get().c;
    expect(logCount).toBe(1);

    expect(applied.at(-1)).toMatch(/^0010_/);
  });

  it('refuses re-adding reminders.updated_at style conflict (0002 then no dup in later files)', () => {
    const files = loadMigrationFiles();
    const allSql = files.map((f) => f.sql).join('\n');
    // Count ADD COLUMN updated_at on reminders — must be exactly once across history
    const matches = allSql.match(/ALTER TABLE reminders ADD COLUMN updated_at/gi) || [];
    expect(matches.length).toBe(1);
  });
});
