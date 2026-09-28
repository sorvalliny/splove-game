import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer } from '../src/db/players';
import { insertRun } from '../src/db/runs';
import { weekSeed, boosterKindFor, BOOSTER_KINDS, WEEK_POINTS } from '../src/season/week';
import { weekBoard, myWeek, grantBooster, boostersOf, useBooster } from '../src/db/week';

const sec = (iso: string): number => Math.floor(new Date(`${iso}+03:00`).getTime() / 1000);
const W41 = '2026-W41';

let started = 1_000_000;
const weekRun = (id: number, bank: number, iso: string, over: Record<string, unknown> = {}) =>
  insertRun(env.DB, {
    tgId: id, level: 'normal', bank, onboard: 0, meters: 500, durationMs: 60_000, oarsLost: 0,
    startedAt: (started += 100_000), rejected: null, mode: 'week', week: W41, ...over,
  } as Parameters<typeof insertRun>[1], sec(iso));

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM boosters').run();
  await env.DB.prepare('DELETE FROM points').run();
  await env.DB.prepare('DELETE FROM visits').run();
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM memberships').run();
  await env.DB.prepare('DELETE FROM players').run();
  for (const id of [1, 2, 3, 4]) await upsertPlayer(env.DB, { id, first_name: `Игрок${id}` }, 1000);
});

describe('зерно и настройки недели', () => {
  it('зерно стабильно, целое и разное по неделям', () => {
    expect(weekSeed(1)).toBe(weekSeed(1));
    expect(Number.isInteger(weekSeed(1))).toBe(true);
    expect(weekSeed(1)).toBeGreaterThanOrEqual(0);
    expect(weekSeed(1)).toBeLessThan(2 ** 32);
    const seeds = new Set(Array.from({ length: 60 }, (_, i) => weekSeed(i)));
    expect(seeds.size).toBe(60);
  });

  it('баллы недели: участие и три призовых места по убыванию', () => {
    expect(WEEK_POINTS.play).toBe(50);
    expect(WEEK_POINTS.top).toEqual([300, 200, 100]);
  });

  it('вид бустера зависит от игрока и недели детерминированно', () => {
    expect(boosterKindFor(1, W41)).toBe(boosterKindFor(1, W41));
    expect(BOOSTER_KINDS).toContain(boosterKindFor(1, W41));
    const kinds = new Set<string>();
    for (let id = 1; id <= 60; id++) kinds.add(boosterKindFor(id, W41));
    expect(kinds.size).toBe(3);                    // встречаются все три вида
  });
});

describe('таблица недели', () => {
  it('лучший банк игрока за неделю, по убыванию, при равенстве раньше набравший выше', async () => {
    await weekRun(1, 300, '2026-10-06T10:00:00');
    await weekRun(1, 900, '2026-10-07T10:00:00');   // лучший у игрока 1
    await weekRun(2, 900, '2026-10-06T09:00:00');   // столько же, но раньше
    await weekRun(3, 500, '2026-10-06T11:00:00');
    const board = await weekBoard(env.DB, W41, 10);
    expect(board.map((r) => [r.tg_id, r.bank])).toEqual([[2, 900], [1, 900], [3, 500]]);
  });

  it('обычные заплывы, чужая неделя и отклонённые не считаются', async () => {
    await weekRun(1, 800, '2026-10-06T10:00:00', { mode: 'free', week: null });
    await weekRun(2, 800, '2026-10-06T10:00:00', { week: '2026-W40' });
    await weekRun(3, 800, '2026-10-06T10:00:00', { rejected: 'too_fast' });
    expect(await weekBoard(env.DB, W41, 10)).toEqual([]);
  });

  it('забаненный скрыт и не сдвигает место', async () => {
    await weekRun(1, 900, '2026-10-06T10:00:00');
    await weekRun(2, 500, '2026-10-06T10:00:00');
    expect((await myWeek(env.DB, 2, W41))?.rank).toBe(2);
    await env.DB.prepare('UPDATE players SET banned = 1 WHERE tg_id = 1').run();
    expect((await weekBoard(env.DB, W41, 10)).map((r) => r.tg_id)).toEqual([2]);
    expect((await myWeek(env.DB, 2, W41))?.rank).toBe(1);
  });

  it('свой результат и место; без заплывов недели null', async () => {
    await weekRun(1, 900, '2026-10-06T10:00:00');
    await weekRun(2, 500, '2026-10-06T10:00:00');
    expect(await myWeek(env.DB, 2, W41)).toEqual({ bank: 500, rank: 2 });
    expect(await myWeek(env.DB, 3, W41)).toBeNull();
  });

  it('лимит топа соблюдается', async () => {
    for (const id of [1, 2, 3, 4]) await weekRun(id, id * 100, '2026-10-06T10:00:00');
    expect((await weekBoard(env.DB, W41, 3)).length).toBe(3);
  });
});

describe('бустеры', () => {
  it('за неделю выдаётся один бустер, повтор тот же вид и не удваивает', async () => {
    const first = await grantBooster(env.DB, 1, W41, 1000);
    const again = await grantBooster(env.DB, 1, W41, 2000);
    expect(first).toBe(boosterKindFor(1, W41));
    expect(again).toBeNull();
    const total = Object.values(await boostersOf(env.DB, 1)).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });

  it('каждая неделя даёт свой бустер', async () => {
    await grantBooster(env.DB, 1, '2026-W41', 1000);
    await grantBooster(env.DB, 1, '2026-W42', 2000);
    expect(Object.values(await boostersOf(env.DB, 1)).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('use списывает один бустер этого вида и только один при гонке', async () => {
    await grantBooster(env.DB, 1, W41, 1000);
    const kind = boosterKindFor(1, W41);
    const [a, b] = await Promise.all([useBooster(env.DB, 1, kind, 3000), useBooster(env.DB, 1, kind, 3000)]);
    expect([a, b].filter(Boolean).length).toBe(1);
    expect((await boostersOf(env.DB, 1))[kind]).toBe(0);
  });

  it('use без бустера возвращает false, чужой бустер не списывается', async () => {
    await grantBooster(env.DB, 1, W41, 1000);
    const kind = boosterKindFor(1, W41);
    expect(await useBooster(env.DB, 2, kind, 3000)).toBe(false);
    expect((await boostersOf(env.DB, 1))[kind]).toBe(1);
  });
});
