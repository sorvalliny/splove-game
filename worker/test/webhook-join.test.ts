import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const sent: any[] = [];
beforeEach(async () => {
  sent.length = 0;
  await env.DB.prepare('DELETE FROM chats').run();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

const hook = (body: unknown) =>
  SELF.fetch('https://example.com/tg/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-hook-secret' },
    body: JSON.stringify(body),
  });

const joined = (chatId: number, status = 'member', kind = 'supergroup') => ({
  update_id: 1,
  my_chat_member: {
    chat: { id: chatId, title: 'Сплав', type: kind },
    new_chat_member: { status },
  },
});

describe('бота добавили в чат', () => {
  it('чат запоминается и бот здоровается один раз', async () => {
    await hook(joined(-100));
    expect(sent.length).toBe(1);
    expect(sent[0].body.chat_id).toBe(-100);

    sent.length = 0;
    await hook(joined(-100));
    expect(sent.length).toBe(0);
  });

  it('удаление бота выключает чат и молчит', async () => {
    await hook(joined(-100));
    sent.length = 0;
    await hook(joined(-100, 'left'));
    expect(sent.length).toBe(0);
    const row = await env.DB.prepare('SELECT active FROM chats WHERE chat_id = -100').first<{ active: number }>();
    expect(row?.active).toBe(0);
  });

  it('личный чат с ботом в список групп не попадает', async () => {
    await hook(joined(956875, 'member', 'private'));
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM chats').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('превращение в супергруппу переносит чат без потери', async () => {
    await hook(joined(-5327135658, 'member', 'group'));
    await hook({
      update_id: 2,
      message: {
        chat: { id: -5327135658, type: 'group' },
        migrate_to_chat_id: -1005327135658,
      },
    });
    const rows = await env.DB.prepare('SELECT chat_id FROM chats WHERE active = 1').all<{ chat_id: number }>();
    expect(rows.results.map((r) => r.chat_id)).toEqual([-1005327135658]);
  });
});
