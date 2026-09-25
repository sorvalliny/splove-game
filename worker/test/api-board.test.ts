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

const post = (path: string, body: unknown, init = initData()) =>
  SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': init },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, result: { status: 'member' } }))));
});
afterEach(() => vi.unstubAllGlobals());

const T0 = Date.now() - 10 * 60 * 1000;
const run = (over = {}) => ({
  level: 'normal', bank: 300, onboard: 0, meters: 500,
  durationMs: 60_000, oarsLost: 1, startedAt: T0, ...over,
});

describe('POST /api/board', () => {
  it('пустая таблица возвращается без ошибки', async () => {
    const body = await (await post('/api/board', { level: 'hard' })).json<any>();
    expect(body.ok).toBe(true);
    expect(body.data.board).toEqual([]);
    expect(body.data.me).toBeNull();
  });

  it('таблица показывает сыгравших', async () => {
    await post('/api/runs', run());
    const body = await (await post('/api/board', { level: 'normal' })).json<any>();
    expect(body.data.board[0].name).toBe('Виктор');
    expect(body.data.board[0].bank).toBe(300);
  });

  it('своя строка приходит отдельно с местом', async () => {
    await post('/api/runs', run());
    const body = await (await post('/api/board', { level: 'normal' })).json<any>();
    expect(body.data.me.rank).toBe(1);
    expect(body.data.me.bank).toBe(300);
  });

  it('игрок без рекорда на уровне получает пустую свою строку', async () => {
    await post('/api/runs', run());
    const body = await (await post('/api/board', { level: 'easy' })).json<any>();
    expect(body.data.me).toBeNull();
  });

  it('чужой уровень отклоняется', async () => {
    const res = await post('/api/board', { level: 'кошмар' });
    expect(res.status).toBe(400);
  });
});
