-- A family's chosen voice (ElevenLabs voice id; not secret) and the clips made with it.
ALTER TABLE families ADD COLUMN voice_id TEXT;
CREATE TABLE IF NOT EXISTS voice_clips (
  family_id  TEXT NOT NULL,
  voice_id   TEXT NOT NULL,
  hash       TEXT NOT NULL,     -- hash of the normalised phrase (see clipKey in the game)
  text       TEXT NOT NULL,
  mp3        BLOB NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (family_id, voice_id, hash)
);
