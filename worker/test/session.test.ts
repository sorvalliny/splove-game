import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createHmac } from 'node:crypto';

const TOKEN = (env as unknown as { BOT_TOKEN: string }).BOT_TOKEN;
const user = JSON.stringify({ id: 956875, first_name: 'Виктор', username: 'sorval' });

function initData(fields: Record<string, string> = {}): string {
  const all = { user, auth_date: String(Math.floor(Date.now() / 1000)), ...fields };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...all, hash }).toString();
}

const memberReply = (status: string) =>
  vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { status } })));

const call = (init?: string) =>
  SELF.fetch('https://example.com/api/session', {
    method: 'POST',
    headers: init ? { 'x-telegram-init-data': init } : {},
  });

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM players').run();
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/session', () => {
  it('участник чата получает профиль', async () => {
    vi.stubGlobal('fetch', memberReply('member'));
    const res = await call(initData());
    const body = await res.json<any>();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.player.name).toBe('Виктор');
    expect(body.data.player.isMember).toBe(true);
  });

  it('членство спрашивается у Telegram один раз, потом берётся из базы', async () => {
    const spy = memberReply('member');
    vi.stubGlobal('fetch', spy);
    await call(initData());
    await call(initData());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('не участник получает отказ с понятным кодом', async () => {
    vi.stubGlobal('fetch', memberReply('left'));
    const res = await call(initData());
    expect(res.status).toBe(403);
    expect((await res.json<any>()).error.code).toBe('not_a_member');
  });

  it('битая подпись получает 401', async () => {
    const res = await call('user=%7B%22id%22%3A1%7D&hash=deadbeef');
    expect(res.status).toBe(401);
    expect((await res.json<any>()).error.code).toBe('bad_init_data');
  });

  it('без заголовка авторизации получает 401', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json<any>()).error.code).toBe('no_init_data');
  });

  it('ответ несёт заголовки CORS для страницы игры', async () => {
    vi.stubGlobal('fetch', memberReply('member'));
    const res = await call(initData());
    expect(res.headers.get('access-control-allow-origin')).toBe('https://sorvalliny.github.io');
  });

  it('предполётный запрос проходит без авторизации', async () => {
    const res = await SELF.fetch('https://example.com/api/session', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('x-telegram-init-data');
  });

  it('неизвестная ручка отвечает конвертом, а не голым текстом', async () => {
    const res = await SELF.fetch('https://example.com/api/nope', { method: 'POST' });
    expect(res.status).toBe(404);
    expect((await res.json<any>()).error.code).toBe('not_found');
  });

  it('health отвечает без авторизации', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect((await res.json<any>()).data.up).toBe(true);
  });
});
