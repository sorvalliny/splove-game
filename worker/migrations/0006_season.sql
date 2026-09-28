-- Сезоны по временам года, границы по Москве (UTC+3), конец не включается.
CREATE TABLE IF NOT EXISTS seasons (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at   INTEGER NOT NULL
);

INSERT OR IGNORE INTO seasons (id, title, starts_at, ends_at) VALUES
  ('autumn-2026', 'Осень', 1790802000, 1798750800),
  ('winter-2027', 'Зима',  1798750800, 1806526800),
  ('spring-2027', 'Весна', 1806526800, 1814389200),
  ('summer-2027', 'Лето',  1814389200, 1822338000);

-- Внешних ключей на players нет намеренно: D1 их проверяет, и тесты, чистящие игроков, падали бы.
CREATE TABLE IF NOT EXISTS visits (
  tg_id INTEGER NOT NULL,
  day   TEXT    NOT NULL,
  PRIMARY KEY (tg_id, day)
);
CREATE INDEX IF NOT EXISTS idx_visits_day ON visits (day);

CREATE TABLE IF NOT EXISTS points (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id     INTEGER NOT NULL,
  season_id TEXT    NOT NULL,
  key       TEXT    NOT NULL,
  points    INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  UNIQUE (tg_id, key)
);

ALTER TABLE runs    ADD COLUMN gena    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs    ADD COLUMN bottles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs    ADD COLUMN camps   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN banned  INTEGER NOT NULL DEFAULT 0;

-- Историю визитов до сезона восстанавливаем из игроков и заплывов:
-- иначе все действующие игроки выглядели бы новичками в день выкладки.
INSERT OR IGNORE INTO visits (tg_id, day)
  SELECT tg_id, date(created_at, 'unixepoch', '+3 hours') FROM players;
INSERT OR IGNORE INTO visits (tg_id, day)
  SELECT tg_id, date(created_at, 'unixepoch', '+3 hours') FROM runs;
