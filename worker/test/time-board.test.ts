import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createHmac } from 'node:crypto';
import { upsertPlayer } from '../src/db/players';
import { insertRun, applyBestTime, getTimeBoard, getTimeRank } from '../src/db/runs';

const TOKEN = (env as unknown as { BOT_TOKEN: string }).BOT_TOKEN;

function initData(id = 956875): string {
  const all = { user: JSON.stringify({ id, first_name: 'Я' }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k as keyof typeof all]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...all, hash }).toString();
}

const board = (body: unknown) => SELF.fetch('https://example.com/api/board', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData() },
  body: JSON.stringify(body),
});

let started = 1_000_000;
async function finish(id: number, timeMs: number, now: number, level: 'easy' | 'normal' | 'hard' = 'normal') {
  const runId = await insertRun(env.DB, {
    tgId: id, level, bank: 100, onboard: 0, meters: 4000, durationMs: 250_000, oarsLost: 0,
    startedAt: (started += 100_000), rejected: null, finished: true, timeMs,
  }, now);
  return applyBestTime(env.DB, id, level, timeMs, runId, now);
}

beforeEach(async () => {
  for (const t of ['best_times', 'points', 'visits', 'bests', 'runs', 'memberships', 'players']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  for (const [id, name] of [[1, 'Аня'], [2, 'Боря'], [3, 'Вера']] as const) {
    await upsertPlayer(env.DB, { id, first_name: name }, 1000);
  }
});

describe('рекорды времени', () => {
  it('меньше время — рекорд, больше или равно — нет', async () => {
    expect(await finish(1, 200_000, 2000)).toBe(true);
    expect(await finish(1, 210_000, 3000)).toBe(false);
    expect(await finish(1, 200_000, 4000)).toBe(false);
    expect(await finish(1, 190_000, 5000)).toBe(true);
  });

  it('две одновременные записи не портят рекорд: остаётся лучшее время', async () => {
    const mk = (startedAt: number, timeMs: number) => insertRun(env.DB, {
      tgId: 1, level: 'normal', bank: 1, onboard: 0, meters: 4000, durationMs: 250_000, oarsLost: 0,
      startedAt, rejected: null, finished: true, timeMs,
    }, 2000);
    const a = await mk(5_000_000, 200_000);
    const b = await mk(6_000_000, 190_000);
    await Promise.all([
      applyBestTime(env.DB, 1, 'normal', 200_000, a, 2000),
      applyBestTime(env.DB, 1, 'normal', 190_000, b, 2000),
    ]);
    const best = () => env.DB.prepare('SELECT time_ms FROM best_times WHERE tg_id = 1').first<any>();
    expect((await best()).time_ms).toBe(190_000);
    await applyBestTime(env.DB, 1, 'normal', 205_000, a, 3000);
    expect((await best()).time_ms).toBe(190_000);
  });

  it('таблица по возрастанию времени, при равенстве раньше финишировавший выше', async () => {
    await finish(1, 200_000, 3000);
    await finish(2, 190_000, 4000);
    await finish(3, 200_000, 2000);
    const rows = await getTimeBoard(env.DB, 'normal', 10);
    expect(rows.map((r) => [r.tg_id, r.time_ms])).toEqual([[2, 190_000], [3, 200_000], [1, 200_000]]);
  });

  it('сложности не смешиваются, забаненные скрыты и не сдвигают место', async () => {
    await finish(1, 190_000, 3000);
    await finish(2, 200_000, 3000);
    await finish(3, 100_000, 3000, 'easy');
    expect((await getTimeBoard(env.DB, 'normal', 10)).map((r) => r.tg_id)).toEqual([1, 2]);
    expect(await getTimeRank(env.DB, 'normal', 200_000, 3000)).toBe(2);
    await env.DB.prepare('UPDATE players SET banned = 1 WHERE tg_id = 1').run();
    expect((await getTimeBoard(env.DB, 'normal', 10)).map((r) => r.tg_id)).toEqual([2]);
    expect(await getTimeRank(env.DB, 'normal', 200_000, 3000)).toBe(1);
  });
});

describe('POST /api/board с видом «время»', () => {
  it('по умолчанию таблица очков, как раньше', async () => {
    const d = (await (await board({ level: 'normal' })).json<any>()).data;
    expect(d.kind).toBe('points');
  });

  it('время: строки, своё место и время', async () => {
    await upsertPlayer(env.DB, { id: 956875, first_name: 'Я' }, 1000);
    await finish(1, 190_000, 3000);
    await finish(956875, 210_000, 3000);
    const d = (await (await board({ level: 'normal', kind: 'time' })).json<any>()).data;
    expect(d.kind).toBe('time');
    expect(d.board.map((r: any) => r.time_ms)).toEqual([190_000, 210_000]);
    expect(d.me).toEqual({ timeMs: 210_000, rank: 2 });
  });

  it('без финиша своё место — null', async () => {
    await finish(1, 190_000, 3000);
    const d = (await (await board({ level: 'normal', kind: 'time' })).json<any>()).data;
    expect(d.me).toBeNull();
  });

  it('неизвестный вид — 400', async () => {
    expect((await board({ level: 'normal', kind: 'нет' })).status).toBe(400);
  });
});
