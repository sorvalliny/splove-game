import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createHmac } from 'node:crypto';
import { upsertPlayer } from '../src/db/players';
import { insertRun } from '../src/db/runs';
import { addPoints } from '../src/db/season';

const TOKEN = (env as unknown as { BOT_TOKEN: string }).BOT_TOKEN;
const ME = 956875;

function initData(id = ME, name = 'Виктор'): string {
  const all = {
    user: JSON.stringify({ id, first_name: name }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k as keyof typeof all]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...all, hash }).toString();
}

const at = (iso: string) => vi.setSystemTime(new Date(`${iso}+03:00`));
const sec = (iso: string) => Math.floor(new Date(`${iso}+03:00`).getTime() / 1000);

const call = (init: string | null = initData()) =>
  SELF.fetch('https://example.com/api/season', {
    method: 'POST',
    headers: init ? { 'x-telegram-init-data': init } : {},
  });

const getData = async () => (await (await call()).json<any>()).data;

const player = (id: number, name: string) => upsertPlayer(env.DB, { id, first_name: name }, 1000);
const give = (id: number, pts: number, key: string, now: number, season = 'autumn-2026') =>
  addPoints(env.DB, id, season, key, pts, now);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM points').run();
  await env.DB.prepare('DELETE FROM visits').run();
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
});
afterEach(() => vi.useRealTimers());

describe('POST /api/season', () => {
  it('до старта: сезон «до», заданий и таблицы нет, границы года отданы', async () => {
    at('2026-09-28T12:00:00');
    const d = await getData();
    expect(d.season).toMatchObject({ id: 'autumn-2026', title: 'Осень', state: 'before', day: 0, startsAt: 1790802000 });
    expect(d.quests).toEqual([]);
    expect(d.board).toEqual([]);
    expect(d.year).toEqual({ startsAt: 1790802000, endsAt: 1822338000 });
    expect(d.me).toEqual({ total: 0, seasonPoints: 0, rank: null });
    expect(d.now).toBe(sec('2026-09-28T12:00:00'));
  });

  it('открытие пишет визит', async () => {
    at('2026-10-05T12:00:00');
    await call();
    const row = await env.DB.prepare('SELECT day FROM visits').first<{ day: string }>();
    expect(row?.day).toBe('2026-10-05');
  });

  it('во время сезона: день, длина и три задания недели с прогрессом', async () => {
    at('2026-10-05T12:00:00');                        // неделя W41: camp3, bottles10, km2
    const d = await getData();
    expect(d.season).toMatchObject({ state: 'active', day: 5, days: 92 });
    expect(d.quests.map((q: any) => q.id)).toEqual(['camp3', 'bottles10', 'km2']);
    expect(d.quests[0]).toMatchObject({ progress: 0, goal: 3, done: false, points: 200 });
  });

  it('прогресс задания растёт от заплывов недели и не превышает цель', async () => {
    at('2026-10-05T12:00:00');
    await player(ME, 'Виктор');
    await insertRun(env.DB, {
      tgId: ME, level: 'normal', bank: 1, onboard: 0, meters: 2500, durationMs: 60_000, oarsLost: 0,
      startedAt: 1, rejected: null, stats: { gena: 0, bottles: 14, camps: 5 },
    }, sec('2026-10-05T11:00:00'));
    const q = Object.fromEntries((await getData()).quests.map((x: any) => [x.id, x]));
    expect(q.camp3).toMatchObject({ progress: 3, done: true });
    expect(q.bottles10).toMatchObject({ progress: 10, done: true });
    expect(q.km2).toMatchObject({ progress: 2000, done: true });
  });

  it('таблица: своя строка помечена isMe, чужих tg_id и username нет', async () => {
    at('2026-10-05T12:00:00');
    await player(ME, 'Виктор');
    await player(2, 'Гена');
    await give(ME, 300, 'a', sec('2026-10-05T11:00:00'));
    await give(2, 500, 'b', sec('2026-10-05T11:00:00'));
    const d = await getData();
    expect(d.board).toEqual([
      { name: 'Гена', points: 500, isMe: false },
      { name: 'Виктор', points: 300, isMe: true },
    ]);
    expect(d.me).toEqual({ total: 300, seasonPoints: 300, rank: 2 });
    expect(JSON.stringify(d.board)).not.toContain('tg_id');
  });

  it('при равных баллах выше тот, кто набрал их раньше', async () => {
    at('2026-10-05T12:00:00');
    await player(ME, 'Виктор');
    await player(2, 'Гена');
    await give(ME, 400, 'a', sec('2026-10-05T11:30:00'));
    await give(2, 400, 'b', sec('2026-10-05T11:00:00'));
    const d = await getData();
    expect(d.board.map((r: any) => r.name)).toEqual(['Гена', 'Виктор']);
    expect(d.me.rank).toBe(2);
  });

  it('при равных баллах и равном времени порядок стабилен: по возрастанию id', async () => {
    at('2026-10-05T12:00:00');
    await player(ME, 'Виктор');
    await player(5, 'Аня');
    const t = sec('2026-10-05T11:00:00');
    await give(ME, 400, 'a', t);
    await give(5, 400, 'b', t);
    const names = async () => (await getData()).board.map((r: any) => r.name);
    expect(await names()).toEqual(['Аня', 'Виктор']);
    expect(await names()).toEqual(['Аня', 'Виктор']);
  });

  it('забаненный пропадает из таблицы и не сдвигает место', async () => {
    at('2026-10-05T12:00:00');
    await player(ME, 'Виктор');
    await player(2, 'Гена');
    await give(2, 900, 'b', sec('2026-10-05T10:00:00'));
    await give(ME, 300, 'a', sec('2026-10-05T11:00:00'));
    expect((await getData()).me.rank).toBe(2);

    await env.DB.prepare('UPDATE players SET banned = 1 WHERE tg_id = 2').run();
    const d = await getData();
    expect(d.board.map((r: any) => r.name)).toEqual(['Виктор']);
    expect(d.me.rank).toBe(1);
  });

  it('чемпионы сезона считаются на лету и появляются после его конца', async () => {
    await player(ME, 'Виктор');
    await player(2, 'Гена');
    await give(ME, 300, 'a', sec('2026-10-05T11:00:00'));
    await give(2, 700, 'b', sec('2026-11-05T11:00:00'));

    at('2026-12-30T12:00:00');
    expect((await getData()).champions).toEqual([]);

    at('2027-01-02T12:00:00');
    const d = await getData();
    expect(d.champions).toEqual([{ seasonId: 'autumn-2026', title: 'Осень', name: 'Гена' }]);
    expect(d.season).toMatchObject({ id: 'winter-2027', state: 'active', day: 2 });
    expect(d.me.seasonPoints).toBe(0);
    expect(d.me.total).toBe(300);
  });

  it('без подписи Telegram — 401', async () => {
    const res = await call(null);
    expect(res.status).toBe(401);
  });
});
