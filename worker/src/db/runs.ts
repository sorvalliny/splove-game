import type { Level } from '../game/plausible';
import type { RunStats } from '../game/stats';

export interface RunRow {
  id: number;
  tg_id: number;
  level: Level;
  bank: number;
  onboard: number;
  meters: number;
  duration_ms: number;
  oars_lost: number;
  rejected: string | null;
  started_at: number;
  created_at: number;
  mode: 'free' | 'week';
  week: string | null;
  finished: number;
  time_ms: number | null;
}

export interface NewRun {
  tgId: number;
  level: Level;
  bank: number;
  onboard: number;
  meters: number;
  durationMs: number;
  oarsLost: number;
  startedAt: number;
  rejected: string | null;
  stats?: RunStats;
  mode?: 'free' | 'week';
  week?: string | null;
  finished?: boolean;
  timeMs?: number | null;
}

export interface Best {
  level: Level;
  bank: number;
  meters: number;
  run_id: number;
  updated_at: number;
}

export interface BoardRow {
  tg_id: number;
  name: string;
  photo_url: string | null;
  bank: number;
  meters: number;
  updated_at: number;
}

/** Порядок таблицы: банк, потом метры, потом кто раньше установил. */
const BOARD_ORDER = 'ORDER BY b.bank DESC, b.meters DESC, b.updated_at ASC';

export async function insertRun(db: D1Database, run: NewRun, now: number): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO runs (tg_id, level, bank, onboard, meters, duration_ms, oars_lost, rejected,
                         started_at, created_at, gena, bottles, camps, sanchez, mode, week, finished, time_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
       RETURNING id`,
    )
    .bind(run.tgId, run.level, run.bank, run.onboard, run.meters, run.durationMs,
          run.oarsLost, run.rejected, run.startedAt, now,
          run.stats?.gena ?? 0, run.stats?.bottles ?? 0, run.stats?.camps ?? 0, run.stats?.sanchez ?? 0,
          run.mode ?? 'free', run.week ?? null, run.finished ? 1 : 0, run.timeMs ?? null)
    .first<{ id: number }>();
  if (!res) throw new Error('заплыв не сохранился');
  return res.id;
}

export const findRunByStart = (db: D1Database, tgId: number, startedAt: number): Promise<RunRow | null> =>
  db.prepare('SELECT * FROM runs WHERE tg_id = ? AND started_at = ?').bind(tgId, startedAt).first<RunRow>();

/**
 * Пересекается ли новый заплыв с ближайшим предыдущим по времени.
 * Ищем именно ближайший старт, а не последнюю запись: заплыв из офлайн-очереди
 * может прийти позже более нового онлайнового.
 */
export async function overlapsPrevious(
  db: D1Database, tgId: number, startedAt: number, toleranceMs = 2000,
): Promise<boolean> {
  const prev = await db
    .prepare('SELECT started_at, duration_ms FROM runs WHERE tg_id = ? AND started_at <= ? ORDER BY started_at DESC LIMIT 1')
    .bind(tgId, startedAt)
    .first<{ started_at: number; duration_ms: number }>();
  if (!prev) return false;
  return startedAt < prev.started_at + prev.duration_ms - toleranceMs;
}

export async function countRunsSince(db: D1Database, tgId: number, since: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM runs WHERE tg_id = ? AND created_at >= ?')
    .bind(tgId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Рекорд бьётся, когда пара (банк, метры) лексикографически больше прежней. */
export async function applyBest(
  db: D1Database, tgId: number, level: Level,
  bank: number, meters: number, runId: number, now: number,
): Promise<boolean> {
  const prev = await db
    .prepare('SELECT bank, meters FROM bests WHERE tg_id = ? AND level = ?')
    .bind(tgId, level)
    .first<{ bank: number; meters: number }>();

  if (prev && !(bank > prev.bank || (bank === prev.bank && meters > prev.meters))) return false;

  await db
    .prepare(
      `INSERT INTO bests (tg_id, level, bank, meters, run_id, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(tg_id, level) DO UPDATE SET bank = ?3, meters = ?4, run_id = ?5, updated_at = ?6`,
    )
    .bind(tgId, level, bank, meters, runId, now)
    .run();
  return true;
}

export async function getBests(db: D1Database, tgId: number): Promise<Partial<Record<Level, Best>>> {
  const { results } = await db
    .prepare('SELECT level, bank, meters, run_id, updated_at FROM bests WHERE tg_id = ?')
    .bind(tgId)
    .all<Best>();
  return Object.fromEntries(results.map((b) => [b.level, b]));
}

export async function getBoard(db: D1Database, level: Level, limit: number): Promise<BoardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.tg_id, p.name, p.photo_url, b.bank, b.meters, b.updated_at
       FROM bests b JOIN players p ON p.tg_id = b.tg_id
       WHERE b.level = ?1 AND p.banned = 0 ${BOARD_ORDER} LIMIT ?2`,
    )
    .bind(level, limit)
    .all<BoardRow>();
  return results;
}

/** Место результата в таблице: сколько рекордов строго выше него, плюс один. */
export async function getRank(
  db: D1Database, level: Level, bank: number, meters: number, updatedAt: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM bests b JOIN players p ON p.tg_id = b.tg_id
       WHERE b.level = ?1 AND p.banned = 0 AND (
         b.bank > ?2
         OR (b.bank = ?2 AND b.meters > ?3)
         OR (b.bank = ?2 AND b.meters = ?3 AND b.updated_at < ?4)
       )`,
    )
    .bind(level, bank, meters, updatedAt)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export interface TimeRow { tg_id: number; name: string; photo_url: string | null; time_ms: number; updated_at: number }

/** Рекорд времени: меньше — лучше; при равенстве остаётся прежний (кто раньше, тот выше). */
export async function applyBestTime(
  db: D1Database, tgId: number, level: Level, timeMs: number, runId: number, now: number,
): Promise<boolean> {
  const prev = await db
    .prepare('SELECT time_ms FROM best_times WHERE tg_id = ? AND level = ?')
    .bind(tgId, level)
    .first<{ time_ms: number }>();
  if (prev && timeMs >= prev.time_ms) return false;

  await db
    .prepare(
      `INSERT INTO best_times (tg_id, level, time_ms, run_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(tg_id, level) DO UPDATE SET time_ms = ?3, run_id = ?4, updated_at = ?5`,
    )
    .bind(tgId, level, timeMs, runId, now)
    .run();
  return true;
}

export async function getBestTimes(
  db: D1Database, tgId: number,
): Promise<Partial<Record<Level, { time_ms: number; updated_at: number }>>> {
  const { results } = await db
    .prepare('SELECT level, time_ms, updated_at FROM best_times WHERE tg_id = ?')
    .bind(tgId)
    .all<{ level: Level; time_ms: number; updated_at: number }>();
  return Object.fromEntries(results.map((r) => [r.level, { time_ms: r.time_ms, updated_at: r.updated_at }]));
}

export async function getTimeBoard(db: D1Database, level: Level, limit: number): Promise<TimeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.tg_id, p.name, p.photo_url, b.time_ms, b.updated_at
       FROM best_times b JOIN players p ON p.tg_id = b.tg_id
       WHERE b.level = ?1 AND p.banned = 0
       ORDER BY b.time_ms ASC, b.updated_at ASC, b.tg_id ASC LIMIT ?2`,
    )
    .bind(level, limit)
    .all<TimeRow>();
  return results;
}

/** Место по времени: сколько результатов строго лучше, плюс один. Забаненные не считаются. */
export async function getTimeRank(db: D1Database, level: Level, timeMs: number, updatedAt: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM best_times b JOIN players p ON p.tg_id = b.tg_id
       WHERE b.level = ?1 AND p.banned = 0 AND (b.time_ms < ?2 OR (b.time_ms = ?2 AND b.updated_at < ?3))`,
    )
    .bind(level, timeMs, updatedAt)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}
