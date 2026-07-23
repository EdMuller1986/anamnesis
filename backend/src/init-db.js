// NOTE: This is a LOCAL Node.js utility script for traditional SQLite.
// It is NOT used by the Cloudflare Worker production runtime.
// For Cloudflare D1, use wrangler d1 migrations.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'anamnesis-local.db');

if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Local legacy SQLite database initialized at:', dbPath);
console.log('For production Cloudflare D1, please use: wrangler d1 migrations apply');
db.close();
