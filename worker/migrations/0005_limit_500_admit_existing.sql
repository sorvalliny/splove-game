-- Чат сплава — около 70 человек, потолок в 50 отрезал бы лишних.
UPDATE communities SET max_members = 500 WHERE id = 'splav';

-- Заходившие в игру до починки проверки членства получали отказ и теряли результаты.
INSERT OR IGNORE INTO memberships (tg_id, community_id, joined_at)
SELECT tg_id, 'splav', created_at FROM players;
