# Сезон, задания и метрики: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** К 1 октября 2026 запустить сезон «Осень»: сезонные баллы, три задания в неделю, таймер и прогресс сезона на главном экране, сбор визитов; затем `/metrics` и админ-команды.

**Architecture:** Всё считается на воркере (Cloudflare Workers + D1). Клиент добавляет к заплыву счётчики `stats`, показывает карточку сезона и получает данные из нового `POST /api/season`. Чистая логика времени, сезона и заданий живёт в `src/season/` и покрыта юнит-тестами; SQL в `src/db/season.ts`.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), vitest + `@cloudflare/vitest-pool-workers`, клиент — ES-модули без сборки.

Спецификация: `docs/superpowers/specs/2026-09-28-splove-season-design.md`. Она главнее плана при расхождении.

**Общие правила.** Тесты воркера: `cd worker && npx vitest run`. Тестовая база общая, файлы идут по очереди; в `beforeEach` чистим таблицы, которые трогаем. Миграции из `worker/migrations/` подхватываются тестами автоматически при запуске. Коммиты по формату `feat:`/`fix:`/`test:`, без атрибуции. Клиентский тест запускается `node --test tests/client/`.

## Поправки по ревью плана (обязательны, приоритетнее текста задач)

1. **Время в тестах.** Использовать `vi.setSystemTime(...)` без `vi.useFakeTimers()` (или `vi.useFakeTimers({ toFake: ['Date'] })`): полные фейковые таймеры могут повесить ввод-вывод D1 и fetch в пуле воркеров. В `afterEach` вызывать `vi.useRealTimers()`. `initData` собирать уже после установки времени: подпись Telegram допускает `auth_date` не старше суток.
2. **Игроки и очистка.** Заплывы имеют внешний ключ на `players`, а D1 его проверяет: в тестах сначала создавать игрока (`upsertPlayer`). Каждый новый тестовый файл, который трогает `runs`, `points`, `visits`, чистит в `beforeEach` в таком порядке: `points`, `visits`, `bests`, `runs`, `players`. У `points` и `visits` внешних ключей нет, их остатки переживают файлы.
3. **Ключ начисления включает сезон:** `q:<season_id>:<ISO-неделя>:<id>`. Неделя W53 (28 декабря – 3 января) делится между осенью и зимой, без сезона в ключе задание 30 декабря блокировало бы то же задание 1 января. Окно прогресса зимней части недели начинается с `max(начало недели, начало сезона)`. Спецификация обновлена.
4. **Task 12:** `vitest.config.ts` и `Env` не создаются, а меняются; в `Player` (`db/players.ts`) добавить `banned`, если код его читает.
5. **Task 10:** `initSeason()` вызывается один раз после всего блока с `wireRuns` (их четыре ветки в конце `index.html`), а не «после `wireRuns`».
6. **Task 9:** перед правкой снять базовый отпечаток `__simProbe(123456, 3000)` и сравнить после.
7. **Task 5 и 8:** SQL для места и чемпионов: подзапрос `SELECT tg_id, SUM(points) p, MAX(at) last_at FROM points JOIN players ... WHERE banned = 0 GROUP BY tg_id`, место = `1 + COUNT(*)` строк подзапроса с `p > mine OR (p = mine AND last_at < mine_last)`; чемпион сезона — та же выборка с `WHERE season_id = ?`, `ORDER BY p DESC, last_at ASC LIMIT 1`.

## Карта файлов

| Файл | Ответственность |
|---|---|
| `worker/migrations/0006_season.sql` | Таблицы `seasons`, `visits`, `points`, колонки `runs.gena/bottles/camps`, `players.banned`, бэкфилл визитов |
| `worker/src/season/time.ts` | Москва: день, ISO-неделя, индекс недели, начало недели |
| `worker/src/season/state.ts` | `seasonView(now, seasons)`: до / идёт / закончился, день и длина сезона |
| `worker/src/season/quests.ts` | Набор заданий, выбор трёх на неделю, прогресс, начисление |
| `worker/src/game/stats.ts` | Проверка правдоподобия `stats` заплыва |
| `worker/src/db/season.ts` | SQL: сезоны, визиты, баллы, таблица, место, чемпионы, прогресс недели |
| `worker/src/routes/season.ts` | `POST /api/season` |
| `worker/src/routes/admin.ts` | `/metrics`, `/season`, `/ban`, `/unban` (уровень 2) |
| `worker/src/season/metrics.ts` | Подсчёт метрик (уровень 2) |
| `js/season-format.js` | Чистая функция таймера |
| `js/season.js` | Карточка сезона на главном и экран «Сезон» |
| `index.html` | Счётчики `G.st`, снимок на лагере, `stats` в заплыве, разметка карточки |

---

## УРОВЕНЬ 1: к 1 октября

### Task 1: Миграция 0006

**Files:**
- Create: `worker/migrations/0006_season.sql`
- Create: `worker/test/season-migration.test.ts`

- [ ] **Step 1: Тест схемы (красный)**

```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('миграция 0006', () => {
  it('четыре сезона подряд без дыр, осень стартует 1 октября 2026 по Москве', async () => {
    const { results } = await env.DB.prepare('SELECT id, starts_at, ends_at FROM seasons ORDER BY starts_at').all<any>();
    expect(results.map((r) => r.id)).toEqual(['autumn-2026', 'winter-2027', 'spring-2027', 'summer-2027']);
    expect(results[0].starts_at).toBe(1790802000);
    for (let i = 1; i < results.length; i++) expect(results[i].starts_at).toBe(results[i - 1].ends_at);
    expect(results[3].ends_at).toBe(1822338000);
  });

  it('у заплыва есть колонки статистики, у игрока banned, по умолчанию нули', async () => {
    const cols = (t: string) => env.DB.prepare(`PRAGMA table_info(${t})`).all<any>().then((r) => r.results.map((c) => c.name));
    expect(await cols('runs')).toEqual(expect.arrayContaining(['gena', 'bottles', 'camps']));
    expect(await cols('players')).toContain('banned');
  });

  it('ключ начисления уникален для игрока', async () => {
    await env.DB.prepare('DELETE FROM points').run();
    const ins = () => env.DB.prepare("INSERT OR IGNORE INTO points (tg_id, season_id, key, points, at) VALUES (1,'autumn-2026','q:x',10,1)").run();
    expect((await ins()).meta.changes).toBe(1);
    expect((await ins()).meta.changes).toBe(0);
  });
});
```

- [ ] **Step 2:** `npx vitest run test/season-migration.test.ts` — падает (нет таблиц).

- [ ] **Step 3: Миграция.** Содержимое SQL из раздела «Данные» спецификации целиком: `seasons` с четырьмя строками, `visits` (без внешних ключей) с индексом `idx_visits_day` и бэкфиллом из `players.created_at` и `runs.created_at` через `date(x,'unixepoch','+3 hours')`, `points` с `UNIQUE (tg_id, key)` и без внешних ключей, три `ALTER TABLE runs ADD COLUMN ... INTEGER NOT NULL DEFAULT 0`, `ALTER TABLE players ADD COLUMN banned INTEGER NOT NULL DEFAULT 0`. Порядок: сначала `ALTER`, потом бэкфилл.

- [ ] **Step 4:** Тест из шага 1 зелёный; полный `npx vitest run` без регрессий.

- [ ] **Step 5:** `git add worker/migrations/0006_season.sql worker/test/season-migration.test.ts && git commit -m "feat: миграция сезона, визитов и баллов"`

### Task 2: Московское время

**Files:**
- Create: `worker/src/season/time.ts`, `worker/test/season-time.test.ts`

Интерфейс:

```ts
export const MSK_OFFSET_SEC = 3 * 3600;
export const WEEK_SEC = 7 * 86400;
export const WEEK_EPOCH = 1790542800;            // понедельник 2026-09-28 00:00 МСК
export const mskDay = (sec: number): string;     // 'YYYY-MM-DD' по Москве
export const isoWeekKey = (sec: number): string; // '2026-W40', ISO-неделя московской даты
export const weekIndex = (sec: number): number;  // floor((sec - WEEK_EPOCH) / WEEK_SEC)
export const weekStart = (sec: number): number;  // WEEK_EPOCH + weekIndex * WEEK_SEC
```

- [ ] **Step 1: Тесты (красные).** Проверить: `mskDay(1790802000) === '2026-10-01'`; `mskDay(1790802000 - 1) === '2026-09-30'` (граница дня по Москве, а не по UTC); `isoWeekKey(1790802000) === '2026-W40'`; неделя с 28.12.2026 по 03.01.2027 даёт `2026-W53` и на обеих границах (`2026-12-28 00:00 МСК`, `2027-01-03 23:59 МСК`), а `2027-01-04` даёт `2027-W01`; `weekIndex(WEEK_EPOCH) === 0`, `weekIndex(WEEK_EPOCH + WEEK_SEC - 1) === 0`, `weekIndex(WEEK_EPOCH + WEEK_SEC) === 1`, `weekIndex(WEEK_EPOCH - 1) === -1`; `weekStart(1790802000) === WEEK_EPOCH`.
- [ ] **Step 2:** Запуск, падает (модуля нет).
- [ ] **Step 3: Реализация.** ISO-неделя: взять московскую дату как UTC-полночь `d`, сдвинуть на четверг той же недели (`d + (4 - (d.getUTCDay() || 7)) дней`), год — год этого четверга, номер недели — `ceil(((четверг - 1 января) / 86400000 + 1) / 7)`, формат `${год}-W${номер с нулём слева}`.
- [ ] **Step 4:** Зелёный.
- [ ] **Step 5:** commit `feat: московские сутки и недели`.

### Task 3: Состояние сезона

**Files:**
- Create: `worker/src/season/state.ts`, `worker/test/season-state.test.ts`

Интерфейс:

```ts
export interface Season { id: string; title: string; starts_at: number; ends_at: number }
export type SeasonState = 'before' | 'active' | 'ended';
export interface SeasonView {
  id: string; title: string; state: SeasonState;
  startsAt: number; endsAt: number; day: number; days: number;
}
export function seasonView(now: number, seasons: Season[]): SeasonView | null;
export function yearBounds(seasons: Season[]): { startsAt: number; endsAt: number } | null;
export function activeSeason(now: number, seasons: Season[]): Season | null;
```

Правила: `starts_at <= now < ends_at` — идёт (`day = floor((now - starts)/86400) + 1`, `days = round((ends - starts)/86400)`); иначе если есть будущий — ближайший будущий, `state = 'before'`, `day = 0`; иначе последний закончившийся, `state = 'ended'`, `day = days`. Пустой список даёт `null`.

- [ ] **Step 1: Тесты (красные).** Данные — четыре сезона из миграции. Кейсы: `now = 1790802000 - 1` → `before`, осень, `day 0`; `now = 1790802000` → `active`, `day 1`, `days 92`; конец осени `now = 1798750800 - 1` → `active`, `day 92`; ровно `1798750800` → зима `active`, `day 1`, `days 90`; после `1822338000` → `ended`, лето; пустой список → `null`; `yearBounds` возвращает `1790802000` и `1822338000`; `activeSeason` вне сезона даёт `null`.
- [ ] **Step 2:** Падает. **Step 3:** Реализация. **Step 4:** Зелёный.
- [ ] **Step 5:** commit `feat: состояние сезона`.

### Task 4: Проверка `stats` и запись в заплыв

**Files:**
- Create: `worker/src/game/stats.ts`, `worker/test/stats.test.ts`
- Modify: `worker/src/db/runs.ts` (`NewRun`, `insertRun`, `getBoard`, `getRank`), `worker/test/runs.test.ts` (новый кейс)

Интерфейс:

```ts
export interface RunStats { gena: number; bottles: number; camps: number }
export const ZERO_STATS: RunStats = { gena: 0, bottles: 0, camps: 0 };
export function sanitizeStats(raw: unknown, meters: number): RunStats;
```

Правила: любое поле — неотрицательное целое; `bottles <= floor(meters/27) + 2`; `gena <= floor(meters/1000) + 1`; `camps <= (meters >= 400 ? floor((meters - 400)/500) + 1 : 0)`. Что-либо нарушено или `raw` не объект — вернуть `ZERO_STATS`.

- [ ] **Step 1: Тесты (красные).** Честные данные проходят как есть; `bottles = meters/27 + 3` обнуляет всё; `camps = 3` при `meters = 1000` обнуляет (допустим 2); `camps = 1` при `meters = 400` проходит, при `399` обнуляет; дробное, отрицательное, строка, `null`, `undefined` дают нули.
- [ ] **Step 2:** Падает. **Step 3:** Реализация `sanitizeStats`.
- [ ] **Step 4: `db/runs.ts`.** `NewRun` получает необязательное `stats?: RunStats`; `insertRun` пишет `gena, bottles, camps` (по умолчанию нули). `getBoard` добавляет `AND p.banned = 0`. `getRank` считает через `JOIN players p ON p.tg_id = bests.tg_id` и тот же фильтр. Тест в `runs.test.ts`: заплыв со статистикой сохраняет колонки; забаненный не в `getBoard` и не сдвигает `getRank`.
- [ ] **Step 5:** `npx vitest run` целиком зелёный, commit `feat: статистика заплыва и фильтр забаненных`.

### Task 5: Задания и начисление

**Files:**
- Create: `worker/src/season/quests.ts`, `worker/src/db/season.ts`, `worker/test/quests.test.ts`

`quests.ts`:

```ts
export interface Quest { id: string; title: string; points: number; goal: number; metric: 'gena'|'camps'|'bottles'|'meters'|'days' }
export const POOL: Quest[] = [
  { id: 'gena',      title: 'Подобрать Гену',          points: 150, goal: 1,    metric: 'gena' },
  { id: 'camp3',     title: 'Дойти до 3-го лагеря',    points: 200, goal: 3,    metric: 'camps' },
  { id: 'bottles10', title: 'Собрать 10 бутылок',      points: 100, goal: 10,   metric: 'bottles' },
  { id: 'km2',       title: 'Проплыть 2 км за неделю', points: 150, goal: 2000, metric: 'meters' },
  { id: 'days3',     title: 'Сыграть в 3 разных дня',  points: 200, goal: 3,    metric: 'days' },
];
export const questsForWeek = (weekIdx: number): Quest[];  // 3 подряд по кругу с индекса ((weekIdx % 5) + 5) % 5
export interface WeekProgress { gena: number; camps: number; bottles: number; meters: number; days: number }
export const isDone = (q: Quest, p: WeekProgress): boolean;
export async function awardQuests(db: D1Database, tgId: number, now: number): Promise<Quest[]>; // новые выполненные
```

`db/season.ts` (первая часть):

```ts
export const getSeasons = (db): Promise<Season[]>;   // ORDER BY starts_at
export async function weekProgress(db, tgId, fromSec, toSec): Promise<WeekProgress>;
// SELECT COALESCE(SUM(gena),0), COALESCE(MAX(camps),0), COALESCE(SUM(bottles),0), COALESCE(SUM(meters),0),
//   COUNT(DISTINCT date(created_at,'unixepoch','+3 hours')) FROM runs
//   WHERE tg_id=? AND rejected IS NULL AND created_at>=? AND created_at<?
export async function addPoints(db, tgId, seasonId, key, points, now): Promise<boolean>; // INSERT OR IGNORE, true если строка вставлена (meta.changes === 1)
```

`awardQuests`: найти `activeSeason(now, seasons)` — нет сезона, вернуть `[]`. Окно прогресса: `from = max(weekStart(now), season.starts_at)`, `to = weekStart(now) + WEEK_SEC`. Для каждого из трёх заданий недели, если выполнено и `addPoints(..., 'q:' + isoWeekKey(now) + ':' + id, ...)` вставила строку, добавить в результат.

- [ ] **Step 1: Тесты (красные).** `questsForWeek(0)` — `gena, camp3, bottles10`; `questsForWeek(3)` — `km2, days3, gena` (по кругу); `questsForWeek(-1)` определён и даёт 3 разных; `isDone` для каждой метрики на границе цели. Интеграционные (D1 + перечень сезонов из миграции), время подставлять параметром `now`: вне сезона (`now = 1790802000 - 100`) баллов нет; внутри сезона заплыв с `gena = 1` в неделе, где есть `gena`, даёт +150 и строку с ключом `q:autumn-2026:2026-W40:gena`; повторный вызов ничего не добавляет; прогресс до 1 октября в той же неделе не считается (заплыв за час до старта сезона не идёт в зачёт); `days3` считает разные московские дни, а не заплывы; отклонённый заплыв (`rejected` не `NULL`) не идёт в прогресс. Для шага использовать `insertRun`/прямые `INSERT INTO runs` с заданным `created_at`.
- [ ] **Step 2:** Падает. **Step 3:** Реализация. **Step 4:** Зелёный.
- [ ] **Step 5:** commit `feat: задания недели и начисление сезонных баллов`.

### Task 6: Заплыв начисляет баллы

**Files:**
- Modify: `worker/src/routes/runs.ts`, `worker/test/api-runs.test.ts`

Изменения:
1. `parseBody` пропускает необязательное `stats` как есть (`unknown`).
2. Перед вставкой: `const stats = sanitizeStats(raw.stats, body.meters)`; передать в `insertRun`.
3. После вставки и `applyBest`, если `!rejected`, `newQuests = await awardQuests(env.DB, tgId, nowSec)`.
4. На пути «уже записан» (`known`): если `known.rejected === null`, тоже вызвать `awardQuests`.
5. Ответ `outcome(...)` получает поле `newQuests: [{ id, title, points }]` (пусто, если нет).

- [ ] **Step 1: Тесты (красные)** в `api-runs.test.ts` (в `beforeEach` добавить `DELETE FROM points`, `DELETE FROM visits`): подпись каждого игрока формируется существующей функцией `initData`. Внутри сезона заплыв со `stats: { gena: 1, bottles: 0, camps: 0 }` возвращает `newQuests` с заданием, если оно в неделе (проверять через `questsForWeek(weekIndex(now))` и подобрать значения так, чтобы выполнялось задание недели, а не жёстко «gena»); повтор того же заплыва (тот же `startedAt`) даёт пустой `newQuests` и не удваивает баллы; заплыв с нарушающей правдоподобие `stats` сохраняется, а статистика в базе нулевая; отклонённый заплыв (`too_fast`) баллов не даёт. Так как тесты идут по реальному `Date.now()` (сегодня 28.09.2026, сезон стартует 1.10), для проверки «внутри сезона» подменять время: `vi.useFakeTimers()` и `vi.setSystemTime(new Date('2026-10-05T12:00:00+03:00'))` в этих кейсах; внутри Miniflare `Date.now()` подхватывает подмену.
- [ ] **Step 2:** Падает. **Step 3:** Реализация. **Step 4:** Зелёный, вся сюита.
- [ ] **Step 5:** commit `feat: заплыв начисляет баллы за задания`.

### Task 7: Визиты

**Files:**
- Modify: `worker/src/db/season.ts`, `worker/src/routes/session.ts`, `worker/test/session.test.ts`

`recordVisit(db, tgId, now)`: `INSERT OR IGNORE INTO visits (tg_id, day) VALUES (?, ?)` с `mskDay(now)`.

- [ ] **Step 1: Тесты (красные).** Два вызова `/api/session` в один день дают одну строку `visits`; вызов в другой московский день (`vi.setSystemTime`) даёт вторую; граница 23:59 и 00:01 по Москве идёт в разные дни. В `beforeEach` `session.test.ts` добавить `DELETE FROM visits`.
- [ ] **Step 2:** Падает. **Step 3:** Вызов `recordVisit` в `handleSession` после `authorize`. **Step 4:** Зелёный.
- [ ] **Step 5:** commit `feat: запись визитов при открытии игры`.

### Task 8: API `/api/season`

**Files:**
- Modify: `worker/src/db/season.ts` (таблица, место, чемпионы, итоги)
- Create: `worker/src/routes/season.ts`, `worker/test/api-season.test.ts`
- Modify: `worker/src/index.ts` (маршрут `'/api/season': handleSeason`)

`db/season.ts` (вторая часть):

```ts
export interface PointsRow { tg_id: number; name: string; username: string | null; points: number; last_at: number }
export async function totalsBoard(db, limit): Promise<PointsRow[]>;
// SELECT p.tg_id, p.name, p.username, SUM(pt.points) points, MAX(pt.at) last_at
// FROM points pt JOIN players p ON p.tg_id = pt.tg_id WHERE p.banned = 0
// GROUP BY pt.tg_id ORDER BY points DESC, last_at ASC LIMIT ?
export async function myTotals(db, tgId, seasonId | null): Promise<{ total: number; seasonPoints: number; rank: number | null }>;
// rank: количество игроков (banned=0) с большей суммой или равной суммой и меньшим last_at, плюс один; null, если у игрока нет баллов
export async function champions(db, now): Promise<{ seasonId; title; name }[]>;
// для каждого сезона с ends_at <= now: игрок с наибольшей SUM(points) этого сезона, banned=0, тай-брейк как выше
```

Ответ `handleSeason` строго по спецификации: `now`, `season` (`seasonView`), `year`, `me`, `quests` (пусто при `state = 'before'`, иначе три задания недели с `progress`/`goal`/`done`/`points`; `progress` — значение метрики, обрезанное сверху целью), `board` (топ-10, поля `name`, `points`, `isMe`, без `tg_id` и `username`), `champions`. Внутри: `recordVisit`. Нет ни одного сезона — `season: null`, остальное пустое.

- [ ] **Step 1: Тесты (красные).** До старта (`setSystemTime` на 28.09): `season.state === 'before'`, `quests` пуст, `board` пуст. Во время сезона: `state 'active'`, `day` и `days`, три задания с `done`; после начисления в `board` есть игрок с `isMe: true`; ответ не содержит поля `tg_id`. Тай-брейк: при равных баллах выше тот, кто набрал раньше. `banned = 1` пропадает из `board` и не сдвигает `me.rank`. `champions` пуст до конца сезона и содержит победителя после (`setSystemTime` на 02.01.2027). Запись визита создаёт строку в `visits`. Без подписи Telegram 401.
- [ ] **Step 2:** Падает. **Step 3:** Реализация и маршрут. **Step 4:** Зелёный, вся сюита.
- [ ] **Step 5:** commit `feat: API сезона`.

### Task 9: Клиент — счётчики и статистика заплыва

**Files:**
- Modify: `index.html` (`reset`, `collect`, обработчик лагеря, `continueRun`, `finishRun`), `js/runs.js` (без изменений API, `stats` идёт в теле `run` целиком)

Изменения в `index.html`:
1. В `reset(seed)` к `G` добавить `st:{gena:0,bottles:0,camps:0}, stSnap:{gena:0,bottles:0}`.
2. В `collect(o)`: для `beer`, `wine`, `teq` — `G.st.bottles++`; для `gena` — `G.st.gena++`.
3. В обработчике лагеря (`cp.done=1`): `G.st.camps++; G.stSnap={gena:G.st.gena,bottles:G.st.bottles}`.
4. В `continueRun`: `G.st.gena=G.stSnap.gena; G.st.bottles=G.stSnap.bottles` (`camps` не трогаем).
5. В `finishRun`: в объект добавить `stats:{...G.st}`.
6. Люк для проверки: `globalThis.__sim` не нужен; проверка Node-харнессом из scratchpad-подхода (стаб DOM, полный скрипт в `node:vm`, `viewport 1519×784`).

- [ ] **Step 1: Проверка до правки (красная).** Харнесс-скрипт: `reset(1)`, симуляция без управления, вызов `collect({type:'beer',...})` дважды и `collect({type:'gena',...})`, чтение `G.st` — до правки `G.st` не определён.
- [ ] **Step 2:** Внести изменения 1–5.
- [ ] **Step 3: Проверка (зелёная).** Тот же харнесс: после двух пива и Гены `G.st = {gena:1,bottles:2,camps:0}`; после прохождения первого лагеря `camps === 1` и `stSnap` равен текущему; имитация `continueRun` возвращает `gena`/`bottles` к снимку, `camps` остаётся. Прогон 20 сидов без исключений.
- [ ] **Step 4:** Сеяная воспроизводимость не нарушена: `__simProbe(123456, 3000)` (если люк есть) даёт тот же отпечаток, что до правки, — счётчики не обращаются к `rnd()`.
- [ ] **Step 5:** commit `feat: счётчики заплыва для заданий`.

### Task 10: Клиент — карточка сезона на главном экране

**Files:**
- Create: `js/season-format.js`, `js/season.js`, `tests/client/season-format.test.mjs`
- Modify: `js/api.js` (`export const season = () => call('/api/season');`), `index.html` (разметка `#seasonCard` в `#menu` над кнопками, CSS, вызов `initSeason()` после `wireRuns`)

`season-format.js`:

```js
/** Оставшееся время: «2д 03:14:22», «03:14:22» без дней, «00:00:00» при нуле и меньше. */
export function formatCountdown(ms) {}
```

Тест (красный, потом зелёный): `formatCountdown(0) === '00:00:00'`; `-5` → `'00:00:00'`; `1000` → `'00:00:01'`; `3661000` → `'01:01:01'`; `(2*86400 + 3*3600 + 14*60 + 22)*1000` → `'2д 03:14:22'`; `86400000` → `'1д 00:00:00'`.

`season.js`: `initSeason()` — если не `inTelegram()`, выйти; `await season()`; если ошибка — карточку не показывать. Смещение часов `offset = data.now*1000 - Date.now()`. Состояние `before`: строка «Осень стартует через …» и подпись «Задания откроются 1 октября» (дата берётся из `season.startsAt`), таймер обновляется раз в секунду по `Date.now()+offset`; когда время вышло — один раз перезапросить `/api/season`. Состояние `active`: «Осень · день D из N», полоса `<div>` шириной `D/N*100%`, ниже «Твои баллы: X · место R» (если нет баллов — «Баллов пока нет»). Состояние `ended`: «Сезон закончился». Значения экранировать так же, как в `board.js` (`esc`).

- [ ] **Step 1:** Тест форматирования красный (модуля нет). **Step 2:** Реализация `formatCountdown`, зелёный (`node --test tests/client/`).
- [ ] **Step 3:** Разметка, CSS (в стиле `#board`: те же шрифты и цвета, карточка со скруглением, полоса с золотой заливкой) и `season.js`. **Step 4:** Проверить вручную после выкладки в Telegram (в браузере вне Telegram карточка намеренно скрыта). До выкладки — просмотр разметки через `node --check` для модулей.
- [ ] **Step 5:** commit `feat: карточка сезона на главном экране`.

### Task 11: Выкладка уровня 1

- [ ] **Step 1:** `cd worker && npx vitest run` — вся сюита зелёная; `npx tsc --noEmit 2>&1 | grep '^src'` — пусто.
- [ ] **Step 2:** Код-ревью (`code-reviewer`) диффа уровня 1; правки критичного и важного.
- [ ] **Step 3:** Резервная копия: `npx wrangler d1 export splove --remote --output ~/Projects/_backup/splove-d1-before-0006.sql`.
- [ ] **Step 4:** Миграция на боевой базе **до** воркера: `npx wrangler d1 migrations apply splove --remote`, затем проверка `SELECT COUNT(*) FROM seasons` (4), `SELECT COUNT(*) FROM visits` (не меньше числа игроков).
- [ ] **Step 5:** `npx wrangler deploy`; проверка `POST /api/season` без подписи даёт 401; коммит и `git push`; дождаться обновления GitHub Pages (`curl` по маркеру `#seasonCard`).
- [ ] **Step 6:** Виктору: открыть игру в Telegram, увидеть таймер до 1 октября.

---

## УРОВЕНЬ 2: 2–3 октября

### Task 12: Админ-доступ

**Files:**
- Modify: `worker/wrangler.toml` (`ADMIN_IDS = "956875"`, `CHAT_SIZE = "70"`), `worker/src/index.ts` (`Env`), `worker/src/routes/webhook.ts`
- Create: `worker/src/routes/admin.ts`, `worker/test/admin.test.ts`, `worker/vitest.config.ts` (bindings `ADMIN_IDS`, `CHAT_SIZE`)

`admin.ts`: `isAdmin(msg, env)` — `chat.type === 'private'` и `from.id` из списка `ADMIN_IDS` (через запятую). `handleAdmin(cmd, args, msg, env, now): Promise<Response | null>` — `null`, если команда не админская; для админской от не-админа возвращает `new Response('ok')` без ответа в чат. В `handleWebhook` вызвать до общей обработки команд.

- [ ] **Step 1: Тесты (красные).** Не-админ и админ в группе получают тишину и `sendMessage` не вызывается; админ в личке получает ответ; `/ban abc` даёт понятную ошибку в чат; `/ban 123` ставит `banned = 1` у существующего игрока, у несуществующего сообщает «нет такого игрока»; `/unban 123` снимает; после бана игрок пропал из `/api/season` и таблиц уровней (проверено в Task 4 и 8, здесь — сквозная проверка команды).
- [ ] **Step 2:** Падает. **Step 3:** `/ban`, `/unban` и каркас. **Step 4:** Зелёный.
- [ ] **Step 5:** commit `feat: админ-доступ и бан`.

### Task 13: `/metrics` и `/season` для админа

**Files:**
- Create: `worker/src/season/metrics.ts`, `worker/test/metrics.test.ts`
- Modify: `worker/src/routes/admin.ts`

`metrics.ts`: `collectMetrics(db, now, chatSize)` возвращает объект, `formatMetrics(m)` — текст по образцу спецификации. Определения:
- `dau` — `COUNT(*) FROM visits WHERE day = today`; `wau` — `COUNT(DISTINCT tg_id)` за `[today-6, today]`; `mau` — за `[today-29, today]`; `stickiness = dau / mau` (при `mau = 0` — `null`).
- Удержание `retention(N)` — объединённая когорта: `WITH first AS (SELECT tg_id, MIN(day) f FROM visits GROUP BY tg_id) ... WHERE f BETWEEN date(today,'-30 days') AND date(today,'-N days')`, удержан, если существует визит `day = date(f, '+N days')`; `null`, если в когорте нет игроков.
- Воронка: открыли (`COUNT(DISTINCT tg_id) FROM visits`), сыграли (игроки с принятым заплывом), 1-й лагерь (`MAX(meters) >= 400` по игроку), 4-й (`>= 1900`), финиш — `null` («—»).
- Заплывов на игрока в день за 7 дней: `COUNT(*) / COUNT(DISTINCT tg_id || '|' || date(created_at,'unixepoch','+3 hours'))` по принятым заплывам.
- Задания: активных на неделе (есть принятый заплыв с начала недели), выполнено (`COUNT(*) FROM points WHERE key LIKE 'q:<неделя>:%'`), доля `= выполнено / (3 * активных)`; баллы за неделю — `SUM(points)` по тому же ключу.
- Отклонено за 7 дней: доля `rejected IS NOT NULL`.

`/season` (админ): топ-10 `totalsBoard` с именами, `@username` и баллами.

- [ ] **Step 1: Тесты (красные).** На подготовленных `visits`/`runs`/`points`: DAU, WAU, MAU и липкость с известными числами; удержание D1 на объединённой когорте (два игрока, один вернулся); `null` без зрелых когорт; воронка по порогам 400 и 1900; доли; форматирование содержит «DAU», «Липкость», «Воронка», не содержит имён; пустая база не падает и не даёт `NaN`.
- [ ] **Step 2:** Падает. **Step 3:** Реализация и подключение команд. **Step 4:** Зелёный.
- [ ] **Step 5:** commit `feat: /metrics и /season для админа`.

### Task 14: Экран «Сезон» и всплывашка заданий

**Files:**
- Modify: `js/season.js`, `js/runs.js`, `index.html` (разметка `#season`, CSS)

- Нажатие на карточку открывает экран «Сезон»: три задания с полосками прогресса и баллами, топ-10 по баллам (своя строка подсвечена), титулы прошлых чемпионов (если есть), кнопка «Назад».
- В `onRunEnd` при непустом `newQuests` дописать в текст результата «Задание выполнено: …, +N баллов».
- [ ] **Step 1:** Разметка и стили в духе `#board`. **Step 2:** Отрисовка из данных `/api/season` с экранированием. **Step 3:** Показ `newQuests`. **Step 4:** Проверка вручную в Telegram (Виктор) и `node --check`. **Step 5:** commit `feat: экран сезона и уведомление о заданиях`.

### Task 15: Выкладка уровня 2

- [ ] **Step 1:** Полный прогон тестов и `tsc` по `src`. **Step 2:** `code-reviewer` по диффу уровня 2, включая проверку админ-доступа (`security-reviewer`: команды, ввод `/ban`). **Step 3:** `npx wrangler deploy`, `git push`. **Step 4:** Виктору: написать боту `/metrics` в личке и проверить ответ; в чате команда должна молчать.

---

## Самопроверка плана

- Спецификация покрыта: миграция (Task 1), даты и недели (2–3), статистика (4, 9), задания (5–6), визиты (7), API (8), главный экран с таймером и прогрессом (10), админ и метрики (12–13), экран сезона (14).
- Ключ идемпотентности `q:<неделя>:<id>` и окно прогресса с `max(начало недели, старт сезона)` соответствуют спецификации; источник времени — `created_at`.
- Названия согласованы: `awardQuests`, `questsForWeek`, `seasonView`, `sanitizeStats`, `recordVisit`, `totalsBoard`, `G.st`, `G.stSnap`.
- Сроки: уровень 1 (задачи 1–11) обязателен к 1 октября, уровень 2 — 2–3 октября.
