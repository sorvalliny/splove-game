CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id       INTEGER NOT NULL REFERENCES players(tg_id),
  level       TEXT    NOT NULL CHECK (level IN ('easy','normal','hard')),
  bank        INTEGER NOT NULL,
  onboard     INTEGER NOT NULL,
  meters      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  oars_lost   INTEGER NOT NULL,
  rejected    TEXT,
  started_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bests (
  tg_id      INTEGER NOT NULL REFERENCES players(tg_id),
  level      TEXT    NOT NULL,
  bank       INTEGER NOT NULL,
  meters     INTEGER NOT NULL,
  run_id     INTEGER NOT NULL REFERENCES runs(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tg_id, level)
);

CREATE INDEX IF NOT EXISTS idx_runs_player ON runs (tg_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_dedup ON runs (tg_id, started_at);
CREATE INDEX IF NOT EXISTS idx_bests_board ON bests (level, bank DESC, meters DESC, updated_at);
