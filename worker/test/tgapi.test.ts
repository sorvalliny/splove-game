import { describe, it, expect, vi, afterEach } from 'vitest';
import { isChatMember } from '../src/telegram/api';

const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));

afterEach(() => vi.unstubAllGlobals());

describe('проверка членства через Bot API', () => {
  it.each(['creator', 'administrator', 'member'])('%s считается участником', async (status) => {
    vi.stubGlobal('fetch', reply({ ok: true, result: { status } }));
    expect(await isChatMember('T', '-1', 1)).toBe(true);
  });

  it.each(['left', 'kicked', 'restricted'])('%s участником не считается', async (status) => {
    vi.stubGlobal('fetch', reply({ ok: true, result: { status } }));
    expect(await isChatMember('T', '-1', 1)).toBe(false);
  });

  it('отказ Telegram трактуется как «не участник»', async () => {
    vi.stubGlobal('fetch', reply({ ok: false, description: 'chat not found' }));
    expect(await isChatMember('T', '-1', 1)).toBe(false);
  });

  it('недоступная сеть не роняет запрос', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('сеть'); }));
    expect(await isChatMember('T', '-1', 1)).toBe(false);
  });

  it('непонятный ответ не роняет запрос', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('не json')));
    expect(await isChatMember('T', '-1', 1)).toBe(false);
  });

  it('идентификатор чата уезжает в запрос экранированным', async () => {
    const spy = reply({ ok: true, result: { status: 'member' } });
    vi.stubGlobal('fetch', spy);
    await isChatMember('T', '-5327135658', 956875);
    expect(spy.mock.calls[0][0]).toContain('chat_id=-5327135658');
    expect(spy.mock.calls[0][0]).toContain('user_id=956875');
  });
});
