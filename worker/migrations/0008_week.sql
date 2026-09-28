-- День сплава: заплывы недели и бустеры за участие.
ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'free';
ALTER TABLE runs ADD COLUMN week TEXT;
CREATE INDEX IF NOT EXISTS idx_runs_week ON runs (mode, week, tg_id);

-- Внешних ключей на players нет: D1 их проверяет, и тесты, чистящие игроков, падали бы.
CREATE TABLE IF NOT EXISTS boosters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id      INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('shield', 'x2', 'life')),
  earned_key TEXT    NOT NULL,
  earned_at  INTEGER NOT NULL,
  used_at    INTEGER,
  UNIQUE (tg_id, earned_key)
);
