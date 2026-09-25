import type { TgUser } from '../telegram/verify';

export interface Player {
  tg_id: number;
  name: string;
  username: string | null;
  photo_url: string | null;
  is_member: number;
  member_checked_at: number | null;
  track: string | null;
  created_at: number;
  last_seen_at: number;
}

const MEMBER_TTL_SEC = 60 * 60 * 24;

const fullName = (u: TgUser): string => [u.first_name, u.last_name].filter(Boolean).join(' ');

export async function getPlayer(db: D1Database, tgId: number): Promise<Player | null> {
  return db.prepare('SELECT * FROM players WHERE tg_id = ?').bind(tgId).first<Player>();
}

/**
 * Создаёт игрока или обновляет то, что приходит из Telegram.
 * Членство намеренно не трогается: оно живёт своим сроком и снимается только setMembership.
 */
export async function upsertPlayer(db: D1Database, u: TgUser, now: number): Promise<Player> {
  await db
    .prepare(
      `INSERT INTO players (tg_id, name, username, photo_url, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(tg_id) DO UPDATE SET
         name = ?2, username = ?3, photo_url = ?4, last_seen_at = ?5`,
    )
    .bind(u.id, fullName(u), u.username ?? null, u.photo_url ?? null, now)
    .run();

  const row = await getPlayer(db, u.id);
  if (!row) throw new Error(`игрок ${u.id} не сохранился`);
  return row;
}

export const needsMemberCheck = (checkedAt: number | null, now: number): boolean =>
  checkedAt === null || now - checkedAt > MEMBER_TTL_SEC;

export async function setMembership(
  db: D1Database,
  tgId: number,
  isMember: boolean,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE players SET is_member = ?, member_checked_at = ? WHERE tg_id = ?')
    .bind(isMember ? 1 : 0, now, tgId)
    .run();
}
