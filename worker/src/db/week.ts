import { boosterKindFor, BOOSTER_KINDS, type BoosterKind } from '../season/week';

export interface WeekRow { tg_id: number; name: string; bank: number; at: number }

/** Лучший банк на игрока среди принятых заплывов недели; забаненные скрыты. */
const RANKED = `
  WITH best AS (
    SELECT r.tg_id, MAX(r.bank) AS bank
    FROM runs r JOIN players p ON p.tg_id = r.tg_id
    WHERE r.mode = 'week' AND r.week = ?1 AND r.rejected IS NULL AND p.banned = 0
    GROUP BY r.tg_id),
  ranked AS (
    SELECT b.tg_id, b.bank,
      (SELECT MIN(r.created_at) FROM runs r
       WHERE r.tg_id = b.tg_id AND r.mode = 'week' AND r.week = ?1 AND r.rejected IS NULL AND r.bank = b.bank) AS at
    FROM best b)`;

export async function weekBoard(db: D1Database, weekKey: string, limit: number): Promise<WeekRow[]> {
  const { results } = await db
    .prepare(
      `${RANKED}
       SELECT k.tg_id, p.name, k.bank, k.at FROM ranked k JOIN players p ON p.tg_id = k.tg_id
       ORDER BY k.bank DESC, k.at ASC, k.tg_id ASC LIMIT ?2`,
    )
    .bind(weekKey, limit)
    .all<WeekRow>();
  return results;
}

export async function myWeek(db: D1Database, tgId: number, weekKey: string): Promise<{ bank: number; rank: number } | null> {
  const mine = await db
    .prepare(`${RANKED} SELECT bank, at FROM ranked WHERE tg_id = ?2`)
    .bind(weekKey, tgId)
    .first<{ bank: number; at: number }>();
  if (!mine) return null;
  const ahead = await db
    .prepare(
      `${RANKED}
       SELECT COUNT(*) AS n FROM ranked
       WHERE bank > ?2 OR (bank = ?2 AND at < ?3) OR (bank = ?2 AND at = ?3 AND tg_id < ?4)`,
    )
    .bind(weekKey, mine.bank, mine.at, tgId)
    .first<{ n: number }>();
  return { bank: mine.bank, rank: (ahead?.n ?? 0) + 1 };
}

/** Один бустер за игрока и неделю. Возвращает вид, только если бустер выдан сейчас. */
export async function grantBooster(db: D1Database, tgId: number, weekKey: string, now: number): Promise<BoosterKind | null> {
  const kind = boosterKindFor(tgId, weekKey);
  const res = await db
    .prepare('INSERT OR IGNORE INTO boosters (tg_id, kind, earned_key, earned_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(tgId, kind, `b:${weekKey}`, now)
    .run();
  return res.meta.changes === 1 ? kind : null;
}

export async function boostersOf(db: D1Database, tgId: number): Promise<Record<BoosterKind, number>> {
  const { results } = await db
    .prepare('SELECT kind, COUNT(*) AS n FROM boosters WHERE tg_id = ? AND used_at IS NULL GROUP BY kind')
    .bind(tgId)
    .all<{ kind: BoosterKind; n: number }>();
  const out = Object.fromEntries(BOOSTER_KINDS.map((k) => [k, 0])) as Record<BoosterKind, number>;
  for (const r of results) out[r.kind] = r.n;
  return out;
}

/** Списывает самый старый бустер вида. Атомарно: при гонке двух запросов спишется один. */
export async function useBooster(db: D1Database, tgId: number, kind: BoosterKind, now: number): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE boosters SET used_at = ?3
       WHERE id = (SELECT id FROM boosters WHERE tg_id = ?1 AND kind = ?2 AND used_at IS NULL ORDER BY id LIMIT 1)
         AND used_at IS NULL`,
    )
    .bind(tgId, kind, now)
    .run();
  return res.meta.changes === 1;
}
