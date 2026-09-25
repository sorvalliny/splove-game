import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const sent: any[] = [];
const captureFetch = () =>
  vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  });

const update = (text: string, chatId = -5327135658, type = 'group') => ({
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: chatId, type },
    from: { id: 956875, first_name: 'Виктор' },
    text,
  },
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

  it('в личке на /start приходит кнопка с игрой', async () => {
    const res = await hook(update('/start', 956875, 'private'));
    expect(res.status).toBe(200);
    const btn = sent[0].body.reply_markup.inline_keyboard[0][0];
    expect(btn.web_app.url).toContain('sorvalliny.github.io/splove-game');
  });

  // Кнопка с Mini App в группе не работает: Telegram принимает её только в личке.
  it('в группе на /start приходит ссылка на бота, а не кнопка Mini App', async () => {
    const res = await hook(update('/start'));
    expect(res.status).toBe(200);
    const btn = sent[0].body.reply_markup.inline_keyboard[0][0];
    expect(btn.web_app).toBeUndefined();
    expect(btn.url).toBe('https://t.me/splove_game_bot?start=splav');
  });

  it('обращение с упоминанием бота тоже понимается', async () => {
    await hook(update('/start@splove_game_bot'));
    expect(sent.length).toBe(1);
  });

  it('переход по приглашению записывает игрока в сообщество', async () => {
    await env.DB.prepare('DELETE FROM memberships').run();
    await hook(update('/start splav', 956875, 'private'));
    const row = await env.DB.prepare(
      "SELECT 1 FROM memberships WHERE tg_id = 956875 AND community_id = 'splav'",
    ).first();
    expect(row).not.toBeNull();
  });

  it('негодное приглашение получает понятный отказ', async () => {
    await hook(update('/start нетакого', 956875, 'private'));
    expect(sent[0].body.text).toContain('Такого приглашения нет');
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

describe('правила', () => {
  it('/rules присылает правила', async () => {
    await hook(update('/rules'));
    expect(sent[0].body.text).toContain('Вёсла — это жизни');
  });

  it('/rules работает и в личке', async () => {
    await hook(update('/rules', 956875, 'private'));
    expect(sent[0].body.text).toContain('Гена с гитарой');
  });

  it('кнопка называется «Вёсла на воду»', async () => {
    await hook(update('/start'));
    expect(sent[0].body.reply_markup.inline_keyboard[0][0].text).toContain('Вёсла на воду');
  });
});
