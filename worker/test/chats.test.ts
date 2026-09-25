import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { registerChat, deactivateChat, migrateChat, activeChats, markGreeted } from '../src/db/chats';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM chats').run();
});

describe('чаты бота', () => {
  it('добавление в группу запоминается', async () => {
    const fresh = await registerChat(env.DB, -100, 'Сплав', 'supergroup', 1000);
    expect(fresh).toBe(true);
    expect((await activeChats(env.DB)).map((c) => c.chat_id)).toEqual([-100]);
  });

  it('повторное добавление не считается новым', async () => {
    await registerChat(env.DB, -100, 'Сплав', 'supergroup', 1000);
    await markGreeted(env.DB, -100, 1000);
    expect(await registerChat(env.DB, -100, 'Сплав', 'supergroup', 2000)).toBe(false);
  });

  it('удаление бота выключает чат', async () => {
    await registerChat(env.DB, -100, 'Сплав', 'supergroup', 1000);
    await deactivateChat(env.DB, -100, 2000);
    expect(await activeChats(env.DB)).toEqual([]);
  });

  it('возврат бота включает чат обратно', async () => {
    await registerChat(env.DB, -100, 'Сплав', 'supergroup', 1000);
    await deactivateChat(env.DB, -100, 2000);
    await registerChat(env.DB, -100, 'Сплав', 'supergroup', 3000);
    expect((await activeChats(env.DB)).length).toBe(1);
  });

  it('превращение группы в супергруппу переносит запись', async () => {
    await registerChat(env.DB, -5327135658, 'Тест', 'group', 1000);
    await markGreeted(env.DB, -5327135658, 1000);
    await migrateChat(env.DB, -5327135658, -1005327135658, 2000);
    const all = await activeChats(env.DB);
    expect(all.map((c) => c.chat_id)).toEqual([-1005327135658]);
    expect(all[0].greeted_at).toBe(1000);
  });

  it('перенос в уже существующий чат не плодит дублей', async () => {
    await registerChat(env.DB, -1, 'Старый', 'group', 1000);
    await registerChat(env.DB, -2, 'Новый', 'supergroup', 1000);
    await migrateChat(env.DB, -1, -2, 2000);
    expect((await activeChats(env.DB)).length).toBe(1);
  });
});
