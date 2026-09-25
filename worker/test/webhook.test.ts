import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';

const sent: any[] = [];
const captureFetch = () =>
  vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  });

const update = (text: string, chatId = -5327135658) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: 'group' }, text },
});

const hook = (body: unknown, secret = 'test-hook-secret') =>
  SELF.fetch('https://example.com/tg/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(body),
  });

beforeEach(() => { sent.length = 0; vi.stubGlobal('fetch', captureFetch()); });
afterEach(() => vi.unstubAllGlobals());

describe('вебхук бота', () => {
  it('запрос без правильного секрета отвергается', async () => {
    const res = await hook(update('/start'), 'чужой');
    expect(res.status).toBe(401);
    expect(sent.length).toBe(0);
  });

  it('на /start приходит кнопка с игрой', async () => {
    const res = await hook(update('/start', 956875));
    expect(res.status).toBe(200);
    expect(sent[0].url).toContain('/sendMessage');
    const btn = sent[0].body.reply_markup.inline_keyboard[0][0];
    expect(btn.web_app.url).toContain('sorvalliny.github.io/splove-game');
  });

  it('на «топ» приходит таблица', async () => {
    const res = await hook(update('топ'));
    expect(res.status).toBe(200);
    expect(sent[0].body.text).toContain('Прогулка');
  });

  it('обычное сообщение бот игнорирует', async () => {
    await hook(update('всем привет'));
    expect(sent.length).toBe(0);
  });

  it('непонятное обновление не роняет вебхук', async () => {
    const res = await hook({ update_id: 2 });
    expect(res.status).toBe(200);
  });
});
