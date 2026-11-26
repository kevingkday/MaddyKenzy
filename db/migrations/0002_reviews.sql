-- Reviews become proposals the parent applies.
-- game_versions.status: proposed (waiting for the parent) | live (has been applied) | dismissed | superseded
ALTER TABLE game_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'live';
ALTER TABLE family_games ADD COLUMN last_review_at INTEGER;   -- ms; play after this counts as new
CREATE INDEX IF NOT EXISTS versions_by_status ON game_versions(family_id, game_id, status);
