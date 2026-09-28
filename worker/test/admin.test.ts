import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { upsertPlayer } from '../src/db/players';

const ADMIN = 956875;
const sent: any[] = [];

const message = (text: string, from = ADMIN, chatType = 'private') => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatType === 'private' ? from : -100, type: chatType }, from: { id: from, first_name: 'X' }, text },
});

const hook = (body: unknown) =>
  SELF.fetch('https://example.com/tg/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-hook-secret' },
    body: JSON.stringify(body),
  });

const banned = async (id: number) =>
  (await env.DB.prepare('SELECT banned FROM players WHERE tg_id = ?').bind(id).first<{ banned: number }>())?.banned;

beforeEach(async () => {
  sent.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    sent.push(init?.body ? JSON.parse(init.body as string) : null);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }));
  await env.DB.prepare('DELETE FROM points').run();
  await env.DB.prepare('DELETE FROM visits').run();
  await env.DB.prepare('DELETE FROM bests').run();
  await env.DB.prepare('DELETE FROM runs').run();
  await env.DB.prepare('DELETE FROM players').run();
  await upsertPlayer(env.DB, { id: 123, first_name: 'Аня', username: 'anya' }, 1000);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('доступ к админ-командам', () => {
  it.each(['/metrics', '/season', '/ban 123', '/unban 123'])('не админ в личке: %s молча игнорируется', async (cmd) => {
    const res = await hook(message(cmd, 777));
    expect(res.status).toBe(200);
    expect(sent.length).toBe(0);
    expect(await banned(123)).toBe(0);
  });

  it('админ в группе: команда молча игнорируется', async () => {
    await hook(message('/ban 123', ADMIN, 'supergroup'));
    expect(sent.length).toBe(0);
    expect(await banned(123)).toBe(0);
  });

  it('админ в личке получает ответ', async () => {
    await hook(message('/ban 123'));
    expect(sent.length).toBe(1);
  });
});

describe('/ban и /unban', () => {
  it('бан ставит banned и называет игрока', async () => {
    await hook(message('/ban 123'));
    expect(await banned(123)).toBe(1);
    expect(sent[0].text).toContain('Аня');
  });

  it('разбан снимает флаг', async () => {
    await hook(message('/ban 123'));
    await hook(message('/unban 123'));
    expect(await banned(123)).toBe(0);
    expect(sent[1].text).toContain('Аня');
  });

  it('нечисловой id получает подсказку и ничего не меняет', async () => {
    await hook(message('/ban abc'));
    expect(sent[0].text).toContain('/ban');
    expect(await banned(123)).toBe(0);
  });

  it('без id — подсказка', async () => {
    await hook(message('/ban'));
    expect(sent[0].text).toContain('/ban');
  });

  it('неизвестный игрок — понятный ответ', async () => {
    await hook(message('/ban 999'));
    expect(sent[0].text).toContain('Нет такого игрока');
  });

  it('id вида «123abc» числом не считается', async () => {
    await hook(message('/ban 123abc'));
    expect(await banned(123)).toBe(0);
  });

  it('забаненный исчезает из таблиц, разбаненный возвращается', async () => {
    const { insertRun, applyBest, getBoard } = await import('../src/db/runs');
    const id = await insertRun(env.DB, {
      tgId: 123, level: 'normal', bank: 500, onboard: 0, meters: 600, durationMs: 60_000,
      oarsLost: 0, startedAt: 1_000_000, rejected: null,
    }, 2000);
    await applyBest(env.DB, 123, 'normal', 500, 600, id, 2000);
    expect((await getBoard(env.DB, 'normal', 10)).length).toBe(1);
    await hook(message('/ban 123'));
    expect((await getBoard(env.DB, 'normal', 10)).length).toBe(0);
    await hook(message('/unban 123'));
    expect((await getBoard(env.DB, 'normal', 10)).length).toBe(1);
  });
});
