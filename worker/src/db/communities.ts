export interface Community {
  id: string;
  title: string;
  code: string;
  expires_at: number | null;
  max_members: number | null;
}

export type JoinResult =
  | { ok: true; community: string }
  | { ok: false; reason: 'unknown_code' | 'expired' | 'full' };

const normalize = (code: string): string => code.trim().toLowerCase();

export const findByCode = (db: D1Database, code: string): Promise<Community | null> =>
  db.prepare('SELECT * FROM communities WHERE code = ?').bind(normalize(code)).first<Community>();

export async function membersCount(db: D1Database, communityId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM memberships WHERE community_id = ?')
    .bind(communityId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Вход по коду из ссылки-приглашения.
 * Уже вошедший проходит всегда: потолок не должен выкидывать своих же.
 */
export async function joinByCode(
  db: D1Database, tgId: number, code: string, now: number,
): Promise<JoinResult> {
  const community = await findByCode(db, code);
  if (!community) return { ok: false, reason: 'unknown_code' };

  const already = await db
    .prepare('SELECT 1 FROM memberships WHERE tg_id = ? AND community_id = ?')
    .bind(tgId, community.id)
    .first();
  if (already) return { ok: true, community: community.id };

  if (community.expires_at !== null && now > community.expires_at) {
    return { ok: false, reason: 'expired' };
  }
  if (community.max_members !== null && (await membersCount(db, community.id)) >= community.max_members) {
    return { ok: false, reason: 'full' };
  }

  await db
    .prepare('INSERT OR IGNORE INTO memberships (tg_id, community_id, joined_at) VALUES (?, ?, ?)')
    .bind(tgId, community.id, now)
    .run();

  return { ok: true, community: community.id };
}

export async function isInAnyCommunity(db: D1Database, tgId: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM memberships WHERE tg_id = ? LIMIT 1').bind(tgId).first();
  return row !== null;
}

export async function communityOf(db: D1Database, tgId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT community_id FROM memberships WHERE tg_id = ? ORDER BY joined_at LIMIT 1')
    .bind(tgId)
    .first<{ community_id: string }>();
  return row?.community_id ?? null;
}
