import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer } from '../src/db/players';
import {
  insertRun, findRunByStart, overlapsPrevious, countRunsSince,
  applyBest, getBests, getBoard, getRank,
} from '../src/db/runs';

const player = (id: number, name: string) => ({ id, first_name: name });

const run = (over: Partial<Parameters<typeof insertRun>[1]> = {}) => ({
  tgId: 1, level: 'normal' as const, bank: 300, onboard: 0, meters: 500,
  durationMs: 60_000, oarsLost: 2, startedAt: 1_000_000, rejected: null, ...over,
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
  await upsertPlayer(env.DB, player(1, 'Виктор'), 1000);
  await upsertPlayer(env.DB, player(2, 'Гена'), 1000);
});

describe('заплывы', () => {
  it('заплыв сохраняется и находится по метке старта', async () => {
    const id = await insertRun(env.DB, run(), 2000);
    const found = await findRunByStart(env.DB, 1, 1_000_000);
    expect(found?.id).toBe(id);
  });

  it('повторная отправка того же заплыва не создаёт второй записи', async () => {
    await insertRun(env.DB, run(), 2000);
    await expect(insertRun(env.DB, run(), 3000)).rejects.toThrow();
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs').first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('заплывы не могут пересекаться во времени', async () => {
    await insertRun(env.DB, run({ startedAt: 1_000_000, durationMs: 60_000 }), 2000);
    expect(await overlapsPrevious(env.DB, 1, 1_030_000, 10_000)).toBe(true);
    expect(await overlapsPrevious(env.DB, 1, 1_060_000, 10_000)).toBe(false);
  });

  it('допуск в две секунды на расхождение часов прощается', async () => {
    await insertRun(env.DB, run({ startedAt: 1_000_000, durationMs: 60_000 }), 2000);
    expect(await overlapsPrevious(env.DB, 1, 1_058_500, 10_000)).toBe(false);
  });

  it('пересечение ищется по ближайшему старту, а не по последней записи', async () => {
    await insertRun(env.DB, run({ startedAt: 5_000_000, durationMs: 60_000 }), 9000);
    await insertRun(env.DB, run({ startedAt: 1_000_000, durationMs: 60_000 }), 9100);
    expect(await overlapsPrevious(env.DB, 1, 1_030_000, 10_000)).toBe(true);
  });

  it('суточные заплывы считаются', async () => {
    await insertRun(env.DB, run({ startedAt: 1 }), 1000);
    await insertRun(env.DB, run({ startedAt: 2 }), 90_000);
    expect(await countRunsSince(env.DB, 1, 0)).toBe(2);
    expect(await countRunsSince(env.DB, 1, 50_000)).toBe(1);
  });
});

describe('рекорды', () => {
  it('первый заплыв становится рекордом', async () => {
    const id = await insertRun(env.DB, run(), 2000);
    expect(await applyBest(env.DB, 1, 'normal', 300, 500, id, 2000)).toBe(true);
    expect((await getBests(env.DB, 1)).normal?.bank).toBe(300);
  });

  it('больший банк бьёт рекорд', async () => {
    const a = await insertRun(env.DB, run(), 2000);
    await applyBest(env.DB, 1, 'normal', 300, 500, a, 2000);
    const b = await insertRun(env.DB, run({ startedAt: 2_000_000 }), 3000);
    expect(await applyBest(env.DB, 1, 'normal', 301, 10, b, 3000)).toBe(true);
    expect((await getBests(env.DB, 1)).normal?.bank).toBe(301);
  });

  it('тот же банк с большими метрами тоже бьёт рекорд', async () => {
    const a = await insertRun(env.DB, run(), 2000);
    await applyBest(env.DB, 1, 'normal', 300, 500, a, 2000);
    const b = await insertRun(env.DB, run({ startedAt: 2_000_000 }), 3000);
    expect(await applyBest(env.DB, 1, 'normal', 300, 501, b, 3000)).toBe(true);
    expect((await getBests(env.DB, 1)).normal?.meters).toBe(501);
  });

  it('худший заплыв рекорд не трогает', async () => {
    const a = await insertRun(env.DB, run(), 2000);
    await applyBest(env.DB, 1, 'normal', 300, 500, a, 2000);
    const b = await insertRun(env.DB, run({ startedAt: 2_000_000 }), 3000);
    expect(await applyBest(env.DB, 1, 'normal', 300, 499, b, 3000)).toBe(false);
    expect((await getBests(env.DB, 1)).normal?.meters).toBe(500);
  });

  it('рекорды на разных уровнях живут независимо', async () => {
    const a = await insertRun(env.DB, run(), 2000);
    const b = await insertRun(env.DB, run({ level: 'hard', startedAt: 2_000_000 }), 3000);
    await applyBest(env.DB, 1, 'normal', 300, 500, a, 2000);
    await applyBest(env.DB, 1, 'hard', 50, 100, b, 3000);
    const bests = await getBests(env.DB, 1);
    expect(bests.normal?.bank).toBe(300);
    expect(bests.hard?.bank).toBe(50);
    expect(bests.easy).toBeUndefined();
  });
});

describe('таблица рейтинга', () => {
  const seed = async () => {
    const a = await insertRun(env.DB, run({ tgId: 1, startedAt: 1 }), 1000);
    const b = await insertRun(env.DB, run({ tgId: 2, startedAt: 2 }), 1000);
    await applyBest(env.DB, 1, 'normal', 300, 500, a, 1000);
    await applyBest(env.DB, 2, 'normal', 300, 500, b, 2000);
  };

  it('при полном равенстве выше тот, кто установил рекорд раньше', async () => {
    await seed();
    const board = await getBoard(env.DB, 'normal', 20);
    expect(board.map((r) => r.name)).toEqual(['Виктор', 'Гена']);
    expect(await getRank(env.DB, 'normal', 300, 500, 2000)).toBe(2);
  });

  it('больший банк поднимает выше', async () => {
    await seed();
    const c = await insertRun(env.DB, run({ tgId: 2, startedAt: 3 }), 3000);
    await applyBest(env.DB, 2, 'normal', 900, 10, c, 3000);
    const board = await getBoard(env.DB, 'normal', 20);
    expect(board[0].name).toBe('Гена');
    expect(await getRank(env.DB, 'normal', 900, 10, 3000)).toBe(1);
  });

  it('таблица обрезается до запрошенной длины', async () => {
    await seed();
    expect((await getBoard(env.DB, 'normal', 1)).length).toBe(1);
  });

  it('пустая таблица не падает', async () => {
    expect(await getBoard(env.DB, 'easy', 20)).toEqual([]);
    expect(await getRank(env.DB, 'easy', 10, 10, 1)).toBe(1);
  });
});
