import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer } from '../src/db/players';
import { insertRun } from '../src/db/runs';
import { addPoints } from '../src/db/season';
import { collectMetrics, formatMetrics } from '../src/season/metrics';

const sec = (iso: string): number => Math.floor(new Date(`${iso}+03:00`).getTime() / 1000);
const NOW = sec('2026-10-10T12:00:00');          // суббота, неделя W41: camp3, bottles10, km2

const visit = (id: number, day: string) =>
  env.DB.prepare('INSERT OR IGNORE INTO visits (tg_id, day) VALUES (?, ?)').bind(id, day).run();

let started = 1_000_000;
const run = (id: number, iso: string, meters: number, rejected: string | null = null) =>
  insertRun(env.DB, {
    tgId: id, level: 'normal', bank: 1, onboard: 0, meters, durationMs: 60_000, oarsLost: 0,
    startedAt: (started += 100_000), rejected,
  }, sec(iso));

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM points').run();
  await env.DB.prepare('DELETE FROM visits').run();
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
  for (const id of [1, 2, 3, 4, 5]) await upsertPlayer(env.DB, { id, first_name: `Игрок${id}` }, 1000);
});

async function seed() {
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-08', '2026-10-10']) await visit(1, d);
  for (const d of ['2026-10-01', '2026-10-05']) await visit(2, d);
  for (const d of ['2026-10-09', '2026-10-10']) await visit(3, d);
  await visit(4, '2026-10-10');
  for (const d of ['2026-09-01', '2026-10-10']) await visit(5, d);

  await run(1, '2026-10-08T10:00:00', 1000);
  await run(1, '2026-10-10T10:00:00', 2000);
  await run(2, '2026-10-05T10:00:00', 300);
  await run(3, '2026-10-10T10:00:00', 450);
  await run(4, '2026-10-09T10:00:00', 999, 'too_fast');

  await addPoints(env.DB, 1, 'autumn-2026', 'q:autumn-2026:2026-W41:camp3', 200, sec('2026-10-10T10:00:00'));
  await addPoints(env.DB, 1, 'autumn-2026', 'q:autumn-2026:2026-W41:km2', 150, sec('2026-10-10T10:00:00'));
}

describe('collectMetrics', () => {
  it('охват: DAU, WAU, MAU и липкость', async () => {
    await seed();
    const m = await collectMetrics(env.DB, NOW, 70);
    expect(m.dau).toBe(4);
    expect(m.wau).toBe(5);
    expect(m.mau).toBe(5);
    expect(m.stickiness).toBeCloseTo(0.8);
    expect(m.chatSize).toBe(70);
  });

  it('удержание считается по объединённой когорте, а D30 без зрелых игроков — null', async () => {
    await seed();
    const m = await collectMetrics(env.DB, NOW, 70);
    expect(m.retention.d1).toEqual({ total: 3, kept: 2 });
    expect(m.retention.d7).toEqual({ total: 2, kept: 1 });
    expect(m.retention.d30).toBeNull();
  });

  it('воронка: открыли → сыграли → 1-й лагерь → 4-й лагерь', async () => {
    await seed();
    const m = await collectMetrics(env.DB, NOW, 70);
    expect(m.funnel).toEqual({ opened: 5, played: 3, camp1: 2, camp4: 1 });
  });

  it('заплывов на игрока в день за неделю и доля отклонённых', async () => {
    await seed();
    const m = await collectMetrics(env.DB, NOW, 70);
    expect(m.runsPerPlayerDay).toBeCloseTo(1);
    expect(m.rejectedShare).toBeCloseTo(0.2);
  });

  it('задания недели: активные, выполнено, баллы', async () => {
    await seed();
    const m = await collectMetrics(env.DB, NOW, 70);
    expect(m.quests.active).toBe(3);
    expect(m.quests.done).toBe(2);
    expect(m.quests.rate).toBeCloseTo(2 / 9);
    expect(m.quests.weekPoints).toBe(350);
  });

  it('пустая база не даёт NaN и не падает', async () => {
    const m = await collectMetrics(env.DB, NOW, 70);
    expect(m.dau).toBe(0);
    expect(m.stickiness).toBeNull();
    expect(m.retention).toEqual({ d1: null, d7: null, d30: null });
    expect(m.runsPerPlayerDay).toBeNull();
    expect(m.rejectedShare).toBeNull();
    expect(m.quests.rate).toBeNull();
    expect(formatMetrics(m)).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('formatMetrics', () => {
  it('содержит все разделы и не содержит имён игроков', async () => {
    await seed();
    const text = formatMetrics(await collectMetrics(env.DB, NOW, 70));
    for (const part of ['DAU 4', 'WAU 5', 'MAU 5 из 70', 'Липкость', 'Удержание', 'D1 67%', 'D7 50%', 'D30 —',
      'Воронка', 'открыли 5', '4-й лагерь 1', 'финиш —', 'Заплывов на игрока', 'Задания', 'Отклонено']) {
      expect(text).toContain(part);
    }
    expect(text).not.toContain('Игрок');
  });

  it('без размера чата слово «из» не выводится', async () => {
    const text = formatMetrics(await collectMetrics(env.DB, NOW, null));
    expect(text).not.toContain(' из ');
  });
});
