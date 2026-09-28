-- Финиш и время: заплыв запоминает, финишировал ли игрок и за сколько (время симуляции, мс).
ALTER TABLE runs ADD COLUMN finished INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN time_ms  INTEGER;

-- Лучшее время игрока на сложности. Внешних ключей нет, как у остальных таблиц сезона.
CREATE TABLE IF NOT EXISTS best_times (
  tg_id      INTEGER NOT NULL,
  level      TEXT    NOT NULL CHECK (level IN ('easy', 'normal', 'hard')),
  time_ms    INTEGER NOT NULL,
  run_id     INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tg_id, level)
);
CREATE INDEX IF NOT EXISTS idx_best_times_board ON best_times (level, time_ms, updated_at);
