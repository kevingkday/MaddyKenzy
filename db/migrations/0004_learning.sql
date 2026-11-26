-- The improver measures its own changes and keeps a playbook it can propose updates to.
ALTER TABLE game_versions ADD COLUMN applied_at INTEGER;          -- ms; when the parent made it live
UPDATE game_versions SET applied_at = created_at * 1000 WHERE status = 'live' AND applied_at IS NULL;

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
