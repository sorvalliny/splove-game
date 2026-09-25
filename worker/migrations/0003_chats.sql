CREATE TABLE IF NOT EXISTS chats (
  chat_id    INTEGER PRIMARY KEY,
  title      TEXT,
  kind       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  added_at   INTEGER NOT NULL,
  greeted_at INTEGER
);
