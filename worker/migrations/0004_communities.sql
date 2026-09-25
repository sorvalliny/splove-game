CREATE TABLE IF NOT EXISTS communities (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  expires_at  INTEGER,
  max_members INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  tg_id        INTEGER NOT NULL REFERENCES players(tg_id),
  community_id TEXT    NOT NULL REFERENCES communities(id),
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (tg_id, community_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_community ON memberships (community_id, joined_at);

INSERT OR IGNORE INTO communities (id, title, code, expires_at, max_members, created_at)
VALUES ('splav', 'Сплав', 'splav', NULL, 50, 0);

-- Кто уже играл до перехода на ссылки, остаётся своим: иначе тестировщики выпадут.
INSERT OR IGNORE INTO memberships (tg_id, community_id, joined_at)
SELECT tg_id, 'splav', created_at FROM players;
