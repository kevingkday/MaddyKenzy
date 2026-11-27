-- Beta interest list (email only). The address is encrypted with a key derived from MASTER_KEY;
-- email_hash is a keyed hash (HMAC) used only to spot repeats.
CREATE TABLE IF NOT EXISTS beta_signups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email_enc   TEXT NOT NULL,
  email_hash  TEXT NOT NULL UNIQUE,
  ip_hash     TEXT,
  notified    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS beta_ip ON beta_signups(ip_hash, created_at);
