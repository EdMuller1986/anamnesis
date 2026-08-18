/**
 * Shared helpers for real SQLite (node:sqlite) tests that mimic D1 enough
 * for backup + applyImport.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const migrationsDir = join(__dirname, '..', '..', 'migrations');

export function applyAllMigrations(db) {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/i.test(f))
    .sort();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const name of files) {
    db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
  }
}

export function openMigratedDb() {
  const sqlite = new DatabaseSync(':memory:');
  applyAllMigrations(sqlite);
  return sqlite;
}

/**
 * Minimal D1-like adapter: prepare/bind/all/first/run + batch.
 */
export function d1Adapter(sqlite) {
  function bound(sql, params) {
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
        const info = params.length ? stmt.run(...params) : stmt.run();
        return {
          success: true,
          meta: {
            changes: info?.changes ?? 0,
            last_row_id: info?.lastInsertRowid ?? null,
          },
        };
      },
    };
  }

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return bound(sql, params);
        },
        all() {
          return bound(sql, []).all();
        },
        first() {
          return bound(sql, []).first();
        },
        run() {
          return bound(sql, []).run();
        },
      };
    },
    async batch(statements) {
      const out = [];
      for (const s of statements) {
        if (s && typeof s.run === 'function') {
          out.push(await s.run());
        } else {
          out.push({ success: false });
        }
      }
      return out;
    },
  };
}
