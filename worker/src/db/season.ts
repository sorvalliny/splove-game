import type { Season } from '../season/state';
import type { WeekProgress } from '../season/quests';
import { mskDay } from '../season/time';

export async function getSeasons(db: D1Database): Promise<Season[]> {
  const { results } = await db.prepare('SELECT id, title, starts_at, ends_at FROM seasons ORDER BY starts_at').all<Season>();
  return results;
}

/** Прогресс по принятым заплывам в окне [fromSec, toSec) по серверному времени записи. */
export async function weekProgress(
  db: D1Database, tgId: number, fromSec: number, toSec: number,
): Promise<WeekProgress> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(gena), 0)    AS gena,
              COALESCE(MAX(camps), 0)   AS camps,
              COALESCE(SUM(bottles), 0) AS bottles,
              COALESCE(SUM(meters), 0)  AS meters,
              COUNT(DISTINCT date(created_at, 'unixepoch', '+3 hours')) AS days
       FROM runs
       WHERE tg_id = ?1 AND rejected IS NULL AND created_at >= ?2 AND created_at < ?3`,
    )
    .bind(tgId, fromSec, toSec)
    .first<WeekProgress>();
  return row ?? { gena: 0, camps: 0, bottles: 0, meters: 0, days: 0 };
}

/** Начисление идемпотентно: ключ уникален для игрока. Возвращает true, только если строка вставлена. */
export async function addPoints(
  db: D1Database, tgId: number, seasonId: string, key: string, points: number, now: number,
): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO points (tg_id, season_id, key, points, at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(tgId, seasonId, key, points, now)
    .run();
  return res.meta.changes === 1;
}

/** Один визит в день на игрока (день по Москве): из этого считаются DAU, MAU и удержание. */
export async function recordVisit(db: D1Database, tgId: number, now: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO visits (tg_id, day) VALUES (?1, ?2)').bind(tgId, mskDay(now)).run();
}
