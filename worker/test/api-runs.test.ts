import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createHmac } from 'node:crypto';

const TOKEN = (env as unknown as { BOT_TOKEN: string }).BOT_TOKEN;

function initData(id = 956875, name = 'Виктор'): string {
  const all = {
    user: JSON.stringify({ id, first_name: name }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k as keyof typeof all]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...all, hash }).toString();
}

const asMember = () =>
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, result: { status: 'member' } }))));

/** Метки старта берём от текущего времени: правило отклоняет всё старше тридцати суток. */
const T0 = Date.now() - 10 * 60 * 1000;

const base = {
  level: 'normal', bank: 300, onboard: 40, meters: 500,
  durationMs: 60_000, oarsLost: 2,
};

const post = (path: string, body: unknown, init = initData()) =>
  SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': init },
    body: JSON.stringify(body),
  });

const sendRun = (over: Record<string, unknown> = {}, init = initData()) =>
  post('/api/runs', { ...base, startedAt: Date.now() - 60_000, ...over }, init);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM best_times').run();
  await env.DB.prepare('DELETE FROM points').run();
  await env.DB.prepare('DELETE FROM visits').run();
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
  asMember();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('POST /api/runs', () => {
  it('честный заплыв засчитывается и даёт первое место', async () => {
    const body = await (await sendRun()).json<any>();
    expect(body.ok).toBe(true);
    expect(body.data.rejected).toBeNull();
    expect(body.data.rank).toBe(1);
    expect(body.data.isRecord).toBe(true);
    expect(body.data.best.bank).toBe(300);
  });

  it('второй заплыв хуже первого рекорд не меняет, но даёт дельту', async () => {
    await sendRun({ startedAt: T0 });
    const body = await (await sendRun({ bank: 200, startedAt: T0 + 120_000 })).json<any>();
    expect(body.data.isRecord).toBe(false);
    expect(body.data.best.bank).toBe(300);
    expect(body.data.delta).toBe(-100);
  });

  it('неправдоподобная скорость не засчитывается', async () => {
    const body = await (await sendRun({ meters: 999_999 })).json<any>();
    expect(body.ok).toBe(true);
    expect(body.data.rejected).toBe('too_fast');
    expect(body.data.best).toBeNull();
  });

  it('незасчитанный заплыв всё равно сохраняется в базе', async () => {
    await sendRun({ meters: 999_999 });
    const row = await env.DB.prepare("SELECT rejected FROM runs").first<{ rejected: string }>();
    expect(row?.rejected).toBe('too_fast');
  });

  it('пересекающиеся во времени заплывы не засчитываются', async () => {
    const t = T0;
    await sendRun({ startedAt: t });
    const body = await (await sendRun({ startedAt: t + 30_000 })).json<any>();
    expect(body.data.rejected).toBe('too_often');
  });

  it('быстрый честный рестарт проходит', async () => {
    const t = T0;
    // 300 м за 8 с — 37.5 м/с, в пределах возможного для байдарки
    await sendRun({ startedAt: t, durationMs: 8_000, meters: 300 });
    const body = await (await sendRun({ startedAt: t + 11_000, durationMs: 8_000, meters: 300 })).json<any>();
    expect(body.data.rejected).toBeNull();
  });

  it('повторная отправка того же заплыва возвращает прежний результат, а не ошибку', async () => {
    const t = T0;
    const first = await (await sendRun({ startedAt: t })).json<any>();
    const again = await (await sendRun({ startedAt: t })).json<any>();
    expect(again.ok).toBe(true);
    expect(again.data.rank).toBe(first.data.rank);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs').first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('битое тело запроса отклоняется ошибкой конверта', async () => {
    const res = await post('/api/runs', { level: 'normal' });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error.code).toBe('bad_request');
  });

  it('чужой уровень отклоняется ошибкой конверта', async () => {
    const res = await sendRun({ level: 'кошмар' });
    expect(res.status).toBe(400);
  });

  it('игрок вне чата заплыв отправить может: игра открыта для всех', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { status: 'left' } }))));
    const res = await sendRun();
    expect(res.status).toBe(200);
  });

  it('в ответе приходит таблица уровня', async () => {
    await sendRun();
    const body = await (await sendRun({ startedAt: T0 + 300_000 })).json<any>();
    expect(Array.isArray(body.data.board)).toBe(true);
    expect(body.data.board[0].name).toBe('Виктор');
  });
});

describe('POST /api/profile', () => {
  it('трек сохраняется и возвращается в сессии', async () => {
    await post('/api/profile', { track: 'bard' });
    const body = await (await post('/api/session', {})).json<any>();
    expect(body.data.player.track).toBe('bard');
  });

  it('чужой трек отклоняется', async () => {
    const res = await post('/api/profile', { track: 'шансон' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/session после заплывов', () => {
  it('сессия отдаёт рекорды и накопительную статистику', async () => {
    await sendRun({ startedAt: T0 });
    await sendRun({ level: 'hard', bank: 50, startedAt: T0 + 300_000 });
    const body = await (await post('/api/session', {})).json<any>();
    expect(body.data.bests.normal.bank).toBe(300);
    expect(body.data.bests.hard.bank).toBe(50);
    expect(body.data.stats.runs).toBe(2);
    expect(body.data.stats.meters).toBe(1000);
    expect(body.data.stats.oarsLost).toBe(4);
  });
});

describe('сезонные баллы за заплыв', () => {
  // Понедельник 5 октября 2026 — неделя W41, задания: camp3, bottles10, km2.
  const inSeason = () => vi.setSystemTime(new Date('2026-10-05T12:00:00+03:00'));
  const camp3Run = { meters: 1500, bank: 300, onboard: 40, stats: { gena: 0, bottles: 0, camps: 3 } };
  const savedStats = () =>
    env.DB.prepare('SELECT gena, bottles, camps FROM runs').first<Record<string, number>>();
  const pointsCount = async () =>
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM points').first<{ n: number }>())!.n;

  it('заплыв, выполняющий задание недели, сообщает о нём и начисляет баллы', async () => {
    inSeason();
    const body = await (await sendRun(camp3Run)).json<any>();
    expect(body.data.newQuests).toEqual([{ id: 'camp3', title: 'Дойти до 3-го лагеря', points: 200 }]);
    const row = await env.DB.prepare('SELECT key, points FROM points').first<any>();
    expect(row).toEqual({ key: 'q:autumn-2026:2026-W41:camp3', points: 200 });
  });

  it('повтор того же заплыва баллов не удваивает и новых заданий не сообщает', async () => {
    inSeason();
    const startedAt = Date.now() - 60_000;
    await sendRun({ ...camp3Run, startedAt });
    const again = await (await sendRun({ ...camp3Run, startedAt })).json<any>();
    expect(again.data.newQuests).toEqual([]);
    expect(await pointsCount()).toBe(1);
  });

  it('если первый запрос оборвался после записи заплыва, повтор всё равно начислит баллы', async () => {
    inSeason();
    const { upsertPlayer } = await import('../src/db/players');
    const { insertRun } = await import('../src/db/runs');
    await upsertPlayer(env.DB, { id: 956875, first_name: 'Виктор' }, 1000);
    const startedAt = Date.now() - 60_000;
    await insertRun(env.DB, {
      tgId: 956875, level: 'normal', bank: 300, onboard: 40, meters: 1500, durationMs: 60_000,
      oarsLost: 2, startedAt, rejected: null, stats: { gena: 0, bottles: 0, camps: 3 },
    }, Math.floor(Date.now() / 1000));
    expect(await pointsCount()).toBe(0);

    const retry = await (await sendRun({ ...camp3Run, startedAt })).json<any>();
    expect(retry.data.newQuests.map((q: any) => q.id)).toEqual(['camp3']);
    expect(await pointsCount()).toBe(1);
  });

  it('статистика не по правилам обнуляется, а сам заплыв засчитывается', async () => {
    inSeason();
    const body = await (await sendRun({ ...camp3Run, stats: { gena: 0, bottles: 0, camps: 9 } })).json<any>();
    expect(body.data.rejected).toBeNull();
    expect(body.data.newQuests).toEqual([]);
    expect(await savedStats()).toEqual({ gena: 0, bottles: 0, camps: 0 });
    expect(await pointsCount()).toBe(0);
  });

  it('отклонённый заплыв баллов не даёт', async () => {
    inSeason();
    const body = await (await sendRun({ ...camp3Run, meters: 200_000 })).json<any>();
    expect(body.data.rejected).toBe('too_fast');
    expect(body.data.newQuests).toEqual([]);
    expect(await pointsCount()).toBe(0);
  });

  it('до старта сезона баллов нет', async () => {
    vi.setSystemTime(new Date('2026-09-29T12:00:00+03:00'));
    const body = await (await sendRun(camp3Run)).json<any>();
    expect(body.data.newQuests).toEqual([]);
    expect(await pointsCount()).toBe(0);
  });
});

describe('финиш и время', () => {
  const finishRun = (over: Record<string, unknown> = {}) => sendRun({
    level: 'normal', meters: 4000, bank: 900, onboard: 0, durationMs: 200_000,
    finished: true, timeMs: 195_000, startedAt: Date.now() - 200_000, ...over,
  });
  const dbRow = () => env.DB.prepare('SELECT finished, time_ms FROM runs').first<any>();
  const bestTime = () => env.DB.prepare('SELECT time_ms FROM best_times').first<any>();

  it('принятый финиш сохраняет время, рекорд и место', async () => {
    const d = (await (await finishRun()).json<any>()).data;
    expect(d.rejected).toBeNull();
    expect(d.finish).toEqual({ timeMs: 195_000, isRecord: true, rank: 1 });
    expect(await dbRow()).toEqual({ finished: 1, time_ms: 195_000 });
    expect((await bestTime()).time_ms).toBe(195_000);
  });

  it('медленнее рекорда время не меняет, быстрее — обновляет', async () => {
    const t = Date.now();
    await finishRun({ startedAt: t - 900_000 });
    const slow = (await (await finishRun({ timeMs: 199_000, startedAt: t - 600_000 })).json<any>()).data;
    expect(slow.finish.isRecord).toBe(false);
    expect((await bestTime()).time_ms).toBe(195_000);
    const fast = (await (await finishRun({ timeMs: 180_000, startedAt: t - 300_000 })).json<any>()).data;
    expect(fast.finish).toMatchObject({ timeMs: 180_000, isRecord: true });
    expect((await bestTime()).time_ms).toBe(180_000);
  });

  it.each([
    ['быстрее физики (80 м/с)', { timeMs: 50_000 }],
    ['быстрее честного предела (47,6 м/с)', { timeMs: 84_000 }],
    ['не дотянул до финиша по метрам', { meters: 3999 }],
    ['время больше времени заплыва', { timeMs: 203_000 }],
    ['нулевое время', { timeMs: 0 }],
    ['дробное время', { timeMs: 195_000.5 }],
    ['время строкой', { timeMs: '195000' }],
  ])('финиш молча снимается: %s, заплыв остаётся', async (_n, over) => {
    const d = (await (await finishRun(over as Record<string, unknown>)).json<any>()).data;
    expect(d.rejected).toBeNull();
    expect(d.finish).toBeUndefined();
    expect((await dbRow()).finished).toBe(0);
    expect(await bestTime()).toBeNull();
  });

  it('на самом быстром честном темпе (46 м/с) финиш принимается', async () => {
    const d = (await (await finishRun({ timeMs: 86_900, durationMs: 90_000 })).json<any>()).data;
    expect(d.finish).toMatchObject({ timeMs: 86_900 });
  });

  it('на «Шторме» финиш дольше 330 секунд не принимается', async () => {
    const d = (await (await finishRun({ level: 'hard', meters: 5000, durationMs: 331_000, timeMs: 331_000 })).json<any>()).data;
    expect(d.finish).toBeUndefined();
    expect(await bestTime()).toBeNull();
  });

  it('на «Шторме» финиш в лимит принимается', async () => {
    const d = (await (await finishRun({ level: 'hard', meters: 5000, durationMs: 300_000, timeMs: 298_000 })).json<any>()).data;
    expect(d.finish).toMatchObject({ timeMs: 298_000, isRecord: true });
  });

  it('отклонённый заплыв финишем не считается', async () => {
    const d = (await (await finishRun({ meters: 400_000, durationMs: 200_000 })).json<any>()).data;
    expect(d.rejected).toBe('too_fast');
    expect(d.finish).toBeUndefined();
    expect(await bestTime()).toBeNull();
  });

  it('заплыв без финиша время не пишет', async () => {
    await sendRun({ level: 'normal', meters: 4000, bank: 900, durationMs: 200_000, startedAt: Date.now() - 200_000 });
    expect(await dbRow()).toEqual({ finished: 0, time_ms: null });
  });

  it('финиш в заплыве недели пишется в заплыв, но не в таблицу времени', async () => {
    vi.setSystemTime(new Date('2026-10-06T12:00:00+03:00'));
    await finishRun({ mode: 'week', week: '2026-W41', startedAt: Date.now() - 200_000 });
    expect(await dbRow()).toEqual({ finished: 1, time_ms: 195_000 });
    expect(await bestTime()).toBeNull();
  });

  it('«Шторм» с паузами (400 секунд по часам) принимается, а 700 секунд отклоняется', async () => {
    const t = Date.now();
    const ok = (await (await sendRun({ level: 'hard', durationMs: 400_000, meters: 1000, startedAt: t - 900_000 })).json<any>()).data;
    expect(ok.rejected).toBeNull();
    const bad = (await (await sendRun({ level: 'hard', durationMs: 700_000, meters: 1000, startedAt: t - 300_000 })).json<any>()).data;
    expect(bad.rejected).toBe('bad_numbers');
  });

  // Запрос мог оборваться между записью заплыва и записью рекорда: повтор довозит рекорд времени.
  it('повтор после обрыва записывает рекорд времени', async () => {
    const { upsertPlayer } = await import('../src/db/players');
    const { insertRun } = await import('../src/db/runs');
    await upsertPlayer(env.DB, { id: 956875, first_name: 'Виктор' }, 1000);
    const startedAt = Date.now() - 200_000;
    await insertRun(env.DB, {
      tgId: 956875, level: 'normal', bank: 900, onboard: 0, meters: 4000, durationMs: 200_000, oarsLost: 0,
      startedAt, rejected: null, finished: true, timeMs: 195_000,
    }, Math.floor(Date.now() / 1000));
    expect(await bestTime()).toBeNull();
    const d = (await (await finishRun({ startedAt })).json<any>()).data;
    expect(d.finish).toEqual({ timeMs: 195_000, isRecord: true, rank: 1 });
    expect((await bestTime()).time_ms).toBe(195_000);
  });
});
