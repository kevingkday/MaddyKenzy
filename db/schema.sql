-- Kids' self-improving games: multi-family schema (Cloudflare D1 / SQLite)
-- Code is shared and public. Everything about a family lives here, keyed by family_id.

CREATE TABLE IF NOT EXISTS families (
  id         TEXT PRIMARY KEY,               -- slug, e.g. 'maddykenzy'
  name       TEXT NOT NULL,
  pin_salt   TEXT,                           -- grown-ups PIN: sha256(pin_salt || pin)
  pin_hash   TEXT,                           -- NULL = fall back to PARENT_PIN env (bootstrap)
  voice_id   TEXT,                           -- ElevenLabs voice for this family's clips
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
  profile_private TEXT,                        -- parent's notes for the improver: interests, needs, goals
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS devices (            -- an iPad/iPhone registered to a family (optionally one child)
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT REFERENCES children(id),
  label      TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen  INTEGER
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
