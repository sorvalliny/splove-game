export interface Chat {
  chat_id: number;
  title: string | null;
  kind: string;
  active: number;
  added_at: number;
  greeted_at: number | null;
}

/**
 * Запоминает чат, куда добавили бота.
 * Возвращает true, если чат появился впервые или вернулся после удаления, —
 * по этому признаку бот решает, здороваться ли.
 */
export async function registerChat(
  db: D1Database, chatId: number, title: string | null, kind: string, now: number,
): Promise<boolean> {
  const prev = await db
    .prepare('SELECT active, greeted_at FROM chats WHERE chat_id = ?')
    .bind(chatId)
    .first<{ active: number; greeted_at: number | null }>();

  await db
    .prepare(
      `INSERT INTO chats (chat_id, title, kind, active, added_at)
       VALUES (?1, ?2, ?3, 1, ?4)
       ON CONFLICT(chat_id) DO UPDATE SET title = ?2, kind = ?3, active = 1`,
    )
    .bind(chatId, title, kind, now)
    .run();

  return !prev || prev.active === 0 || prev.greeted_at === null;
}

export async function markGreeted(db: D1Database, chatId: number, now: number): Promise<void> {
  await db.prepare('UPDATE chats SET greeted_at = ? WHERE chat_id = ?').bind(now, chatId).run();
}

export async function deactivateChat(db: D1Database, chatId: number, _now: number): Promise<void> {
  await db.prepare('UPDATE chats SET active = 0 WHERE chat_id = ?').bind(chatId).run();
}

export async function activeChats(db: D1Database): Promise<Chat[]> {
  const { results } = await db
    .prepare('SELECT * FROM chats WHERE active = 1 ORDER BY added_at')
    .all<Chat>();
  return results;
}

/**
 * Группа превратилась в супергруппу — у неё новый идентификатор.
 * Без переноса проверка членства молча перестала бы работать для всех сразу.
 */
export async function migrateChat(
  db: D1Database, fromId: number, toId: number, now: number,
): Promise<void> {
  const old = await db
    .prepare('SELECT title, kind, added_at, greeted_at FROM chats WHERE chat_id = ?')
    .bind(fromId)
    .first<{ title: string | null; kind: string; added_at: number; greeted_at: number | null }>();

  await db.batch([
    db.prepare(
      `INSERT INTO chats (chat_id, title, kind, active, added_at, greeted_at)
       VALUES (?1, ?2, 'supergroup', 1, ?3, ?4)
       ON CONFLICT(chat_id) DO UPDATE SET active = 1, title = ?2`,
    ).bind(toId, old?.title ?? null, old?.added_at ?? now, old?.greeted_at ?? null),
    db.prepare('DELETE FROM chats WHERE chat_id = ?').bind(fromId),
  ]);
}
