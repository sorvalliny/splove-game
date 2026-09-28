import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createHmac } from 'node:crypto';
import { upsertPlayer } from '../src/db/players';
import { insertRun } from '../src/db/runs';
import { boosterKindFor, weekSeed } from '../src/season/week';
import { weekIndex, weekStart, WEEK_SEC } from '../src/season/time';

const TOKEN = (env as unknown as { BOT_TOKEN: string }).BOT_TOKEN;
const ME = 956875;
const W41 = '2026-W41';

function initData(id = ME, name = 'Виктор'): string {
  const all = { user: JSON.stringify({ id, first_name: name }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k as keyof typeof all]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...all, hash }).toString();
}

const at = (iso: string) => vi.setSystemTime(new Date(`${iso}+03:00`));
const sec = (iso: string) => Math.floor(new Date(`${iso}+03:00`).getTime() / 1000);

const post = (path: string, body: unknown = {}, init: string | null = initData()) =>
  SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init ? { 'x-telegram-init-data': init } : {}) },
    body: JSON.stringify(body),
  });

const run = (over: Record<string, unknown> = {}) => post('/api/runs', {
  level: 'normal', bank: 300, onboard: 40, meters: 500, durationMs: 60_000, oarsLost: 0,
  startedAt: Date.now() - 60_000, mode: 'week', week: W41, ...over,
});

const count = async (table: string, where = '1=1') =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())!.n;

beforeEach(async () => {
  for (const t of ['boosters', 'points', 'visits', 'bests', 'runs', 'memberships', 'players']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});
afterEach(() => vi.useRealTimers());

describe('заплыв недели: POST /api/runs', () => {
  it('сохраняется как заплыв недели, не трогает таблицы сложностей, даёт участие и бустер', async () => {
    at('2026-10-06T12:00:00');
    const d = (await (await run()).json<any>()).data;
    expect(d.rejected).toBeNull();
    expect(d.rank).toBe(1);
    expect(d.isRecord).toBe(true);
    expect(d.best.bank).toBe(300);
    expect(d.weekly).toEqual({ points: 50, booster: boosterKindFor(ME, W41) });

    const row = await env.DB.prepare('SELECT mode, week FROM runs').first<any>();
    expect(row).toEqual({ mode: 'week', week: W41 });
    expect(await count('bests')).toBe(0);
    const pts = await env.DB.prepare('SELECT key, points FROM points').first<any>();
    expect(pts).toEqual({ key: 'w:autumn-2026:2026-W41:play', points: 50 });
    expect(await count('boosters')).toBe(1);
  });

  it('второй заплыв недели участия и бустера не удваивает, рекорд только при улучшении', async () => {
    at('2026-10-06T12:00:00');
    await run({ startedAt: Date.now() - 120_000 });
    const worse = (await (await run({ bank: 100 })).json<any>()).data;
    expect(worse.isRecord).toBe(false);
    expect(worse.weekly).toEqual({ points: 0, booster: null });
    const better = (await (await run({ bank: 900, startedAt: Date.now() })).json<any>()).data;
    expect(better.isRecord).toBe(true);
    expect(await count('points', "key LIKE 'w:%'")).toBe(1);
    expect(await count('boosters')).toBe(1);
  });

  it('чужой ключ недели считается обычным заплывом', async () => {
    at('2026-10-06T12:00:00');
    await run({ week: '2026-W40' });
    expect((await env.DB.prepare('SELECT mode, week FROM runs').first<any>())).toEqual({ mode: 'free', week: null });
    expect(await count('bests')).toBe(1);
    expect(await count('points', "key LIKE 'w:%'")).toBe(0);
  });

  it('отклонённый заплыв недели баллов и бустера не даёт', async () => {
    at('2026-10-06T12:00:00');
    const d = (await (await run({ meters: 300_000 })).json<any>()).data;
    expect(d.rejected).toBe('too_fast');
    expect(await count('points', "key LIKE 'w:%'")).toBe(0);
    expect(await count('boosters')).toBe(0);
  });

  it('до старта сезона заплыв записывается, а баллов и бустера нет', async () => {
    at('2026-09-29T12:00:00');
    const d = (await (await run({ week: '2026-W40' })).json<any>()).data;
    expect(d.rejected).toBeNull();
    expect(d.weekly).toEqual({ points: 0, booster: null });
    expect(await count('points')).toBe(0);
    expect(await count('boosters')).toBe(0);
  });

  it('повтор заплыва после обрыва начисляет участие и бустер', async () => {
    at('2026-10-06T12:00:00');
    await upsertPlayer(env.DB, { id: ME, first_name: 'Виктор' }, 1000);
    const startedAt = Date.now() - 60_000;
    await insertRun(env.DB, {
      tgId: ME, level: 'normal', bank: 300, onboard: 40, meters: 500, durationMs: 60_000, oarsLost: 0,
      startedAt, rejected: null, mode: 'week', week: W41,
    }, Math.floor(Date.now() / 1000));
    expect(await count('points')).toBe(0);
    const d = (await (await run({ startedAt })).json<any>()).data;
    expect(d.weekly.points).toBe(50);
    expect(await count('points', "key LIKE 'w:%'")).toBe(1);
    expect(await count('boosters')).toBe(1);
  });
});

describe('POST /api/week', () => {
  it('до заплывов: ключ, зерно, конец недели, пустая таблица, нули', async () => {
    at('2026-10-06T12:00:00');
    const now = sec('2026-10-06T12:00:00');
    const d = (await (await post('/api/week')).json<any>()).data;
    expect(d.weekKey).toBe(W41);
    expect(d.seed).toBe(weekSeed(weekIndex(now)));
    expect(d.level).toBe('normal');
    expect(d.endsAt).toBe(weekStart(now) + WEEK_SEC);
    expect(d.board).toEqual([]);
    expect(d.me).toBeNull();
    expect(d.boosters).toEqual({ shield: 0, x2: 0, life: 0 });
  });

  it('таблица недели: своя строка помечена, чужих id нет, бустер виден', async () => {
    at('2026-10-06T12:00:00');
    await run({ bank: 700 });
    await upsertPlayer(env.DB, { id: 5, first_name: 'Аня' }, 1000);
    await insertRun(env.DB, {
      tgId: 5, level: 'normal', bank: 900, onboard: 0, meters: 500, durationMs: 60_000, oarsLost: 0,
      startedAt: 1, rejected: null, mode: 'week', week: W41,
    }, sec('2026-10-06T10:00:00'));
    const d = (await (await post('/api/week')).json<any>()).data;
    expect(d.board).toEqual([
      { name: 'Аня', bank: 900, isMe: false },
      { name: 'Виктор', bank: 700, isMe: true },
    ]);
    expect(d.me).toEqual({ bank: 700, rank: 2 });
    expect(JSON.stringify(d.board)).not.toContain('tg_id');
    expect(Object.values(d.boosters).reduce((a: number, b: any) => a + b, 0)).toBe(1);
  });

  it('открытие пишет визит; без подписи 401', async () => {
    at('2026-10-06T12:00:00');
    await post('/api/week');
    expect(await count('visits')).toBe(1);
    expect((await post('/api/week', {}, null)).status).toBe(401);
  });
});

describe('POST /api/booster/use', () => {
  const grant = async () => {
    at('2026-10-06T12:00:00');
    await run();
    return boosterKindFor(ME, W41);
  };

  it('списывает бустер, второй раз — 409 без бустера', async () => {
    const kind = await grant();
    const ok = await post('/api/booster/use', { kind });
    expect(ok.status).toBe(200);
    expect((await ok.json<any>()).data).toEqual({ kind });
    const again = await post('/api/booster/use', { kind });
    expect(again.status).toBe(409);
    expect((await again.json<any>()).error.code).toBe('no_booster');
  });

  it('неизвестный вид — 400', async () => {
    await grant();
    expect((await post('/api/booster/use', { kind: 'nuke' })).status).toBe(400);
    expect((await post('/api/booster/use', {})).status).toBe(400);
  });

  it('без подписи 401', async () => {
    expect((await post('/api/booster/use', { kind: 'shield' }, null)).status).toBe(401);
  });
});
