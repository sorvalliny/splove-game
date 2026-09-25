CREATE TABLE IF NOT EXISTS players (
  tg_id             INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  username          TEXT,
  photo_url         TEXT,
  is_member         INTEGER NOT NULL DEFAULT 0,
  member_checked_at INTEGER,
  track             TEXT,
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL
);
