-- Сколько раз в заплыве выпили ухи у Дяди Санчеза: нужно для задания недели.
ALTER TABLE runs ADD COLUMN sanchez INTEGER NOT NULL DEFAULT 0;
