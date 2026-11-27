-- Kids' self-improving games: multi-family schema (Cloudflare D1 / SQLite)
-- Code is shared and public. Everything about a family lives here, keyed by family_id.

CREATE TABLE IF NOT EXISTS families (
  id         TEXT PRIMARY KEY,               -- slug, e.g. 'maddykenzy'
  name       TEXT NOT NULL,
  pin_salt   TEXT,                           -- grown-ups PIN: sha256(pin_salt || pin)
  pin_hash   TEXT,                           -- NULL = fall back to PARENT_PIN env (bootstrap)
  voice_id   TEXT,                           -- ElevenLabs voice for this family's clips
  dek_wrapped TEXT,                          -- family key locked with MASTER_KEY (NULL in private mode)
  private_mode INTEGER NOT NULL DEFAULT 0,
  dek_pass_wrapped TEXT,                     -- private mode: family key locked with the parent's passphrase key
  pass_salt  TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS family_domains (    -- which family a site address belongs to
  domain    TEXT PRIMARY KEY,                  -- e.g. 'maddykenzy.com'
  family_id TEXT NOT NULL REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS children (
  id              TEXT PRIMARY KEY,
  family_id       TEXT NOT NULL REFERENCES families(id),
  display_name    TEXT NOT NULL,
  profile_private TEXT,                        -- parent's notes for the improver: interests, needs, goals (encrypted)
  label           TEXT,                        -- what the kid's device shows (a letter or emoji); not secret
  age             INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS devices (            -- an iPad/iPhone registered to a family (optionally one child)
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT REFERENCES children(id),
  label      TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen  INTEGER,
  token_hash TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS games (              -- shared game templates; code lives in the repo at site/games/<id>/
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS family_games (       -- a family's own copy of a game
  family_id      TEXT NOT NULL REFERENCES families(id),
  game_id        TEXT NOT NULL REFERENCES games(id),
  active_version INTEGER,
  goals_private  TEXT,                         -- what this family wants this game to teach
  last_review_at INTEGER,                      -- ms; play after this counts as new
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, game_id)
);

CREATE TABLE IF NOT EXISTS game_versions (      -- every config a family's game has had
  family_id      TEXT NOT NULL,
  game_id        TEXT NOT NULL,
  version        INTEGER NOT NULL,
  config_json    TEXT NOT NULL,
  changelog      TEXT,                         -- one line
  notes_private  TEXT,                         -- improver's plain-language note for the parent
  stats_json     TEXT,                         -- play stats the change was based on
  parent_version INTEGER,
  created_by     TEXT NOT NULL,                -- seed | improver | parent
  undone         INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'live',  -- proposed | live | dismissed | superseded
  applied_at     INTEGER,                      -- ms; when the parent made it live
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, game_id, version),
  FOREIGN KEY (family_id, game_id) REFERENCES family_games(family_id, game_id)
);

CREATE INDEX IF NOT EXISTS versions_by_status ON game_versions(family_id, game_id, status);

CREATE TABLE IF NOT EXISTS events (             -- every tap, answer, sound and reward
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL,
  game_id   TEXT NOT NULL,
  device_id TEXT,
  child_id  TEXT,
  session   TEXT,
  version   INTEGER,
  t         INTEGER NOT NULL,                  -- ms since epoch
  activity  TEXT,
  type      TEXT NOT NULL,
  data_json TEXT
);
CREATE INDEX IF NOT EXISTS events_by_game ON events(family_id, game_id, t);

CREATE TABLE IF NOT EXISTS improve_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id    TEXT NOT NULL,
  game_id      TEXT NOT NULL,
  action       TEXT NOT NULL,                  -- review | undo
  status       TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | no_change | failed
  message      TEXT,
  from_version INTEGER,
  to_version   INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS runs_by_game ON improve_runs(family_id, game_id, id);

CREATE TABLE IF NOT EXISTS voice_clips (        -- spoken lines in the family's chosen voice
  family_id  TEXT NOT NULL,
  voice_id   TEXT NOT NULL,
  hash       TEXT NOT NULL,                    -- hash of the normalised phrase (clipKey in the game)
  text       TEXT NOT NULL,
  mp3        BLOB NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, voice_id, hash)
);


CREATE TABLE IF NOT EXISTS version_outcomes (     -- scorecard: what each applied change actually did
  family_id     TEXT NOT NULL,
  game_id       TEXT NOT NULL,
  version       INTEGER NOT NULL,
  baseline      INTEGER,                          -- the version it replaced
  verdict       TEXT NOT NULL,                    -- helped | hurt | mixed | no_change | too_early
  summary       TEXT,                             -- e.g. "Play per session 3.2 -> 4.1 min (+28%) ..."
  metrics_json  TEXT,
  baseline_json TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, game_id, version)
);

CREATE TABLE IF NOT EXISTS playbooks (            -- the reviewer's own rules, rewritten from the scorecard
  family_id     TEXT NOT NULL,
  game_id       TEXT NOT NULL,
  version       INTEGER NOT NULL,
  content       TEXT NOT NULL,
  rationale     TEXT,                             -- why the AI changed its rules (for the parent)
  status        TEXT NOT NULL DEFAULT 'proposed', -- proposed | live | dismissed | superseded
  evidence      INTEGER,                          -- outcomes it was based on
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  applied_at    INTEGER,
  PRIMARY KEY (family_id, game_id, version)
);

-- Accounts, device links and encryption (see db/migrations/0005_accounts.sql for column notes)
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, family_id TEXT REFERENCES families(id), role TEXT NOT NULL DEFAULT 'parent', created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS links (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, family_id TEXT, created_by TEXT, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
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
