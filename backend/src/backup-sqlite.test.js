/**
 * Real SQLite smoke: apply migrations, insert visit_diagnoses (no id), run getFullState.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getFullState, stableBackupPayload } from './services/backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

function applyAllMigrations(db) {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/i.test(f))
    .sort();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const name of files) {
    db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
  }
}

/** Minimal D1-like adapter over node:sqlite */
function d1Adapter(sqlite) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return this._bound(sql, params);
        },
        _bound(sql, params) {
          return {
            async all() {
              const stmt = sqlite.prepare(sql);
              const rows = params.length ? stmt.all(...params) : stmt.all();
              return { results: rows };
            },
            async first() {
              const stmt = sqlite.prepare(sql);
              const row = params.length ? stmt.get(...params) : stmt.get();
              return row ?? null;
            },
            async run() {
              const stmt = sqlite.prepare(sql);
              if (params.length) stmt.run(...params);
              else stmt.run();
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
        all() {
          return this._bound(sql, []).all();
        },
        first() {
          return this._bound(sql, []).first();
        },
        run() {
          return this._bound(sql, []).run();
        },
      };
    },
  };
}

describe('backup getFullState on real schema', () => {
  it('exports visit_diagnoses without ORDER BY id and produces stable hash', async () => {
    const sqlite = new DatabaseSync(':memory:');
    applyAllMigrations(sqlite);

    sqlite.prepare(
      `INSERT INTO patient (id, name, full_name) VALUES (1, 'Test', 'Test User')`
    ).run();
    sqlite.prepare(
      `INSERT INTO timeline (id, patient_id, event_date, title) VALUES (10, 1, '2024-01-01', 'Visit')`
    ).run();
    sqlite.prepare(
      `INSERT INTO diagnoses (id, patient_id, name, status) VALUES (20, 1, 'Asthma', 'active')`
    ).run();
    sqlite.prepare(
      `INSERT INTO visit_diagnoses (visit_id, diagnosis_id, relation, patient_id) VALUES (10, 20, 'discussed', 1)`
    ).run();
    sqlite.prepare(
      `INSERT INTO documents (id, patient_id, title, file_path) VALUES (1, 1, 'Lab', 'abc.pdf')`
    ).run();

    const state = await getFullState(d1Adapter(sqlite));
    expect(state.data.visit_diagnoses).toHaveLength(1);
    expect(state.data.visit_diagnoses[0].visit_id).toBe(10);
    expect(state.data.documents).toHaveLength(1);
    expect(state.data.b2_file_manifest.count).toBe(1);
    expect(state.backup_errors).toBeUndefined();

    const a = JSON.stringify(stableBackupPayload(state));
    // second call — same medical data
    const state2 = await getFullState(d1Adapter(sqlite));
    const b = JSON.stringify(stableBackupPayload(state2));
    expect(a).toBe(b);
  });
});
