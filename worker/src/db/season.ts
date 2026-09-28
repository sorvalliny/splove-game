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
              COALESCE(SUM(sanchez), 0) AS sanchez,
              COUNT(DISTINCT date(created_at, 'unixepoch', '+3 hours')) AS days
       FROM runs
       WHERE tg_id = ?1 AND rejected IS NULL AND created_at >= ?2 AND created_at < ?3`,
    )
    .bind(tgId, fromSec, toSec)
    .first<WeekProgress>();
  return row ?? { gena: 0, camps: 0, bottles: 0, meters: 0, days: 0, sanchez: 0 };
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

export interface PointsRow { tg_id: number; name: string; username: string | null; points: number; last_at: number }

/** Сумма баллов по игрокам без забаненных: при равенстве выше тот, кто набрал раньше. */
const TOTALS = `
  SELECT pt.tg_id AS tg_id, SUM(pt.points) AS points, MAX(pt.at) AS last_at
  FROM points pt JOIN players p ON p.tg_id = pt.tg_id
  WHERE p.banned = 0 AND (?1 IS NULL OR pt.season_id = ?1)
  GROUP BY pt.tg_id`;

export async function totalsBoard(db: D1Database, limit: number, seasonId: string | null = null): Promise<PointsRow[]> {
  const { results } = await db
    .prepare(
      `SELECT t.tg_id, p.name, p.username, t.points, t.last_at
       FROM (${TOTALS}) t JOIN players p ON p.tg_id = t.tg_id
       ORDER BY t.points DESC, t.last_at ASC, t.tg_id ASC LIMIT ?2`,
    )
    .bind(seasonId, limit)
    .all<PointsRow>();
  return results;
}

export interface MyTotals { total: number; seasonPoints: number; rank: number | null }

export async function myTotals(db: D1Database, tgId: number, seasonId: string | null): Promise<MyTotals> {
  const mine = await db
    .prepare('SELECT COALESCE(SUM(points), 0) AS total, MAX(at) AS last_at FROM points WHERE tg_id = ?')
    .bind(tgId)
    .first<{ total: number; last_at: number | null }>();
  const season = seasonId === null ? { s: 0 } : await db
    .prepare('SELECT COALESCE(SUM(points), 0) AS s FROM points WHERE tg_id = ?1 AND season_id = ?2')
    .bind(tgId, seasonId)
    .first<{ s: number }>();
  const banned = await db.prepare('SELECT banned FROM players WHERE tg_id = ?').bind(tgId).first<{ banned: number }>();

  const total = mine?.total ?? 0;
  const seasonPoints = season?.s ?? 0;
  if (total === 0 || banned?.banned === 1) return { total, seasonPoints, rank: null };

  const ahead = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${TOTALS}) WHERE points > ?2 OR (points = ?2 AND last_at < ?3)`)
    .bind(null, total, mine!.last_at)
    .first<{ n: number }>();
  return { total, seasonPoints, rank: (ahead?.n ?? 0) + 1 };
}

export interface Champion { seasonId: string; title: string; name: string }

/** Чемпион закончившегося сезона — лидер по баллам этого сезона. Отдельной таблицы нет. */
export async function champions(db: D1Database, now: number): Promise<Champion[]> {
  const ended = (await getSeasons(db)).filter((s) => s.ends_at <= now);
  const out: Champion[] = [];
  for (const s of ended) {
    const [top] = await totalsBoard(db, 1, s.id);
    if (top) out.push({ seasonId: s.id, title: s.title, name: top.name });
  }
  return out;
}
