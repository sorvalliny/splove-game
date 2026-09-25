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
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
  asMember();
});
afterEach(() => vi.unstubAllGlobals());

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

  it('не участник чата заплыв не отправит', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { status: 'left' } }))));
    const res = await sendRun();
    expect(res.status).toBe(403);
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
