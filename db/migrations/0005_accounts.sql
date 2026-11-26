-- Parent accounts, kid-device links, and per-family encryption.
-- Private text (names, notes, goals, the AI's notes, playbooks) is stored as "enc:v1:<iv>:<ciphertext>" (AES-256-GCM)
-- under a per-family key. That key is locked either with MASTER_KEY (a Cloudflare secret, never in this database)
-- or, in private mode, with a key derived from the parent's passphrase in their browser.
ALTER TABLE families ADD COLUMN dek_wrapped TEXT;           -- family key locked with MASTER_KEY (NULL in private mode)
ALTER TABLE families ADD COLUMN private_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE families ADD COLUMN dek_pass_wrapped TEXT;      -- private mode: family key locked with the parent's passphrase key
ALTER TABLE families ADD COLUMN pass_salt TEXT;
ALTER TABLE children ADD COLUMN label TEXT;                 -- what the kid's device shows (a letter or emoji); not secret
ALTER TABLE children ADD COLUMN age INTEGER;
ALTER TABLE devices ADD COLUMN token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS devices_token ON devices(token_hash);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  family_id  TEXT REFERENCES families(id),
  role       TEXT NOT NULL DEFAULT 'parent',    -- parent | admin
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,                 -- ms
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS links (               -- one-time links and codes: invite | login | device
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  user_id    TEXT,
  family_id  TEXT,
  created_by TEXT,
  expires_at INTEGER NOT NULL,                 -- ms
  used_at    INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
