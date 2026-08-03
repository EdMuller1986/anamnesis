-- 0009: auth audit log + generic rate limit counters

CREATE TABLE IF NOT EXISTS auth_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER,
  event TEXT NOT NULL,
  ip TEXT,
  device_id TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_log_created ON auth_log(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_log_patient ON auth_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_auth_log_event ON auth_log(event);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
