import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer } from '../src/db/players';
import { insertRun } from '../src/db/runs';
import { POOL, questsForWeek, isDone, awardQuests, type WeekProgress } from '../src/season/quests';

const msk = (iso: string): number => Math.floor(new Date(`${iso}+03:00`).getTime() / 1000);

const NOW_W40 = msk('2026-10-01T12:00:00');     // неделя 0: gena, camp3, bottles10
const BEFORE = 1790802000 - 100;                // до старта сезона

let startedAt = 1_000_000;
const play = (created: number, over: Record<string, unknown> = {}) => insertRun(env.DB, {
  tgId: 1, level: 'normal', bank: 100, onboard: 0, meters: 300, durationMs: 60_000, oarsLost: 0,
  startedAt: (startedAt += 100_000), rejected: null,
  stats: { gena: 0, bottles: 0, camps: 0 }, ...over,
} as Parameters<typeof insertRun>[1], created);

const points = () => env.DB.prepare('SELECT key, points FROM points ORDER BY id').all<{ key: string; points: number }>()
  .then((r) => r.results);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM points').run();
  await env.DB.prepare('DELETE FROM visits').run();
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
  await upsertPlayer(env.DB, { id: 1, first_name: 'Виктор' }, 1000);
});

describe('набор заданий недели', () => {
  it('по индексу недели берутся три подряд идущих по кругу', () => {
    expect(questsForWeek(0).map((q) => q.id)).toEqual(['gena', 'camp3', 'bottles10']);
    expect(questsForWeek(3).map((q) => q.id)).toEqual(['km2', 'days3', 'gena']);
  });

  it('отрицательный индекс даёт три разных задания', () => {
    const ids = questsForWeek(-1).map((q) => q.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('цель достигается ровно на границе', () => {
    const zero: WeekProgress = { gena: 0, camps: 0, bottles: 0, meters: 0, days: 0 };
    const byId = Object.fromEntries(POOL.map((q) => [q.id, q]));
    expect(isDone(byId.gena, { ...zero, gena: 1 })).toBe(true);
    expect(isDone(byId.camp3, { ...zero, camps: 2 })).toBe(false);
    expect(isDone(byId.camp3, { ...zero, camps: 3 })).toBe(true);
    expect(isDone(byId.bottles10, { ...zero, bottles: 9 })).toBe(false);
    expect(isDone(byId.km2, { ...zero, meters: 2000 })).toBe(true);
    expect(isDone(byId.days3, { ...zero, days: 3 })).toBe(true);
  });
});

describe('начисление баллов за задания', () => {
  it('вне сезона баллов нет', async () => {
    await play(BEFORE, { stats: { gena: 1, bottles: 0, camps: 0 } });
    expect(await awardQuests(env.DB, 1, BEFORE)).toEqual([]);
    expect(await points()).toEqual([]);
  });

  it('выполненное задание даёт баллы с ключом сезона и недели', async () => {
    await play(NOW_W40, { stats: { gena: 1, bottles: 0, camps: 0 } });
    const fresh = await awardQuests(env.DB, 1, NOW_W40);
    expect(fresh.map((q) => q.id)).toEqual(['gena']);
    expect(await points()).toEqual([{ key: 'q:autumn-2026:2026-W40:gena', points: 150 }]);
  });

  it('повторный вызов баллов не удваивает', async () => {
    await play(NOW_W40, { stats: { gena: 1, bottles: 0, camps: 0 } });
    await awardQuests(env.DB, 1, NOW_W40);
    expect(await awardQuests(env.DB, 1, NOW_W40)).toEqual([]);
    expect((await points()).length).toBe(1);
  });

  it('заплыв до старта сезона в той же неделе в зачёт не идёт', async () => {
    await play(msk('2026-09-30T23:00:00'), { stats: { gena: 1, bottles: 0, camps: 0 } });
    expect(await awardQuests(env.DB, 1, NOW_W40)).toEqual([]);
  });

  it('отклонённый заплыв в прогресс не входит', async () => {
    await play(NOW_W40, { rejected: 'too_fast', stats: { gena: 1, bottles: 0, camps: 0 } });
    expect(await awardQuests(env.DB, 1, NOW_W40)).toEqual([]);
  });

  it('«три дня» считает разные московские дни, а не заплывы', async () => {
    const now = msk('2026-10-21T12:00:00');       // неделя 3: km2, days3, gena
    await play(msk('2026-10-19T10:00:00'));
    await play(msk('2026-10-19T20:00:00'));
    await play(msk('2026-10-20T10:00:00'));
    expect((await awardQuests(env.DB, 1, now)).map((q) => q.id)).not.toContain('days3');

    await play(msk('2026-10-21T10:00:00'));
    expect((await awardQuests(env.DB, 1, now)).map((q) => q.id)).toContain('days3');
  });

  it('метры за неделю суммируются', async () => {
    const now = msk('2026-10-21T12:00:00');
    await play(msk('2026-10-19T10:00:00'), { meters: 1200 });
    expect(await awardQuests(env.DB, 1, now)).toEqual([]);
    await play(msk('2026-10-20T10:00:00'), { meters: 900 });
    expect((await awardQuests(env.DB, 1, now)).map((q) => q.id)).toEqual(['km2']);
  });
});
