export interface Stats {
  runs: number;
  meters: number;
  oarsLost: number;
}

/** Накопительная статистика игрока. Считается на лету: заплывов тысячи, не миллионы. */
export async function getStats(db: D1Database, tgId: number): Promise<Stats> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS runs,
              COALESCE(SUM(meters), 0) AS meters,
              COALESCE(SUM(oars_lost), 0) AS oars
       FROM runs WHERE tg_id = ? AND rejected IS NULL`,
    )
    .bind(tgId)
    .first<{ runs: number; meters: number; oars: number }>();

  return { runs: row?.runs ?? 0, meters: row?.meters ?? 0, oarsLost: row?.oars ?? 0 };
}
