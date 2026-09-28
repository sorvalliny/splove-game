import { mskDay, weekStart, isoWeekKey, WEEK_SEC, DAY_SEC } from './time';

export interface Cohort { total: number; kept: number }

export interface Metrics {
  dau: number; wau: number; mau: number; stickiness: number | null; chatSize: number | null;
  retention: { d1: Cohort | null; d7: Cohort | null; d30: Cohort | null };
  funnel: { opened: number; played: number; camp1: number; camp4: number };
  runsPerPlayerDay: number | null;
  rejectedShare: number | null;
  quests: { active: number; done: number; rate: number | null; weekPoints: number };
}

/** Метры, с которых засчитывается лагерь: первый на 400 м, четвёртый на 1900 м. */
const CAMP1_M = 400;
const CAMP4_M = 1900;
const QUESTS_PER_WEEK = 3;

const one = async <T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T> =>
  (await db.prepare(sql).bind(...args).first<T>())!;

const count = async (db: D1Database, sql: string, ...args: unknown[]): Promise<number> =>
  (await one<{ n: number }>(db, sql, ...args)).n;

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/**
 * Удержание по объединённой когорте: игроки, чей первый день попадает в [сегодня-30, сегодня-N],
 * удержан тот, кто пришёл ровно в день первый+N. Дневные когорты при 70 игроках слишком малы.
 */
async function retention(db: D1Database, today: string, n: number): Promise<Cohort | null> {
  const row = await one<{ total: number; kept: number }>(
    db,
    `WITH first AS (SELECT tg_id, MIN(day) AS f FROM visits GROUP BY tg_id)
     SELECT COUNT(*) AS total,
            COALESCE(SUM(EXISTS(
              SELECT 1 FROM visits v WHERE v.tg_id = first.tg_id AND v.day = date(first.f, '+' || ?2 || ' days')
            )), 0) AS kept
     FROM first
     WHERE f BETWEEN date(?1, '-30 days') AND date(?1, '-' || ?2 || ' days')`,
    today, n,
  );
  return row.total > 0 ? row : null;
}

export async function collectMetrics(db: D1Database, now: number, chatSize: number | null): Promise<Metrics> {
  const today = mskDay(now);
  const since7 = now - 7 * DAY_SEC;
  const wStart = weekStart(now);
  const week = isoWeekKey(now);

  const dau = await count(db, 'SELECT COUNT(*) AS n FROM visits WHERE day = ?', today);
  const wau = await count(db, "SELECT COUNT(DISTINCT tg_id) AS n FROM visits WHERE day BETWEEN date(?1, '-6 days') AND ?1", today);
  const mau = await count(db, "SELECT COUNT(DISTINCT tg_id) AS n FROM visits WHERE day BETWEEN date(?1, '-29 days') AND ?1", today);

  const funnel = {
    opened: await count(db, 'SELECT COUNT(DISTINCT tg_id) AS n FROM visits'),
    played: await count(db, 'SELECT COUNT(DISTINCT tg_id) AS n FROM runs WHERE rejected IS NULL'),
    camp1: await count(db, 'SELECT COUNT(*) AS n FROM (SELECT tg_id FROM runs WHERE rejected IS NULL GROUP BY tg_id HAVING MAX(meters) >= ?)', CAMP1_M),
    camp4: await count(db, 'SELECT COUNT(*) AS n FROM (SELECT tg_id FROM runs WHERE rejected IS NULL GROUP BY tg_id HAVING MAX(meters) >= ?)', CAMP4_M),
  };

  const perDay = await one<{ runs: number; pd: number }>(
    db,
    `SELECT COUNT(*) AS runs, COUNT(DISTINCT tg_id || '|' || date(created_at, 'unixepoch', '+3 hours')) AS pd
     FROM runs WHERE rejected IS NULL AND created_at >= ?`,
    since7,
  );
  const rej = await one<{ total: number; rejected: number }>(
    db,
    'SELECT COUNT(*) AS total, COALESCE(SUM(rejected IS NOT NULL), 0) AS rejected FROM runs WHERE created_at >= ?',
    since7,
  );

  const active = await count(
    db,
    'SELECT COUNT(DISTINCT tg_id) AS n FROM runs WHERE rejected IS NULL AND created_at >= ?1 AND created_at < ?2',
    wStart, wStart + WEEK_SEC,
  );
  const pts = await one<{ n: number; p: number }>(
    db,
    "SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS p FROM points WHERE key LIKE 'q:%:' || ? || ':%'",
    week,
  );

  return {
    dau, wau, mau, stickiness: ratio(dau, mau), chatSize,
    retention: { d1: await retention(db, today, 1), d7: await retention(db, today, 7), d30: await retention(db, today, 30) },
    funnel,
    runsPerPlayerDay: ratio(perDay.runs, perDay.pd),
    rejectedShare: ratio(rej.rejected, rej.total),
    quests: { active, done: pts.n, rate: ratio(pts.n, QUESTS_PER_WEEK * active), weekPoints: pts.p },
  };
}

const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);
const cohortPct = (c: Cohort | null): string => (c ? pct(c.kept / c.total) : '—');
const dec = (x: number | null): string => (x === null ? '—' : x.toFixed(1).replace('.', ','));

/** Отчёт для продюсера: только числа, без имён игроков. */
export function formatMetrics(m: Metrics): string {
  const of = m.chatSize ? ` из ${m.chatSize}` : '';
  const f = m.funnel;
  return [
    `Охват: DAU ${m.dau} · WAU ${m.wau} · MAU ${m.mau}${of}`,
    `Липкость DAU/MAU: ${pct(m.stickiness)}`,
    `Удержание: D1 ${cohortPct(m.retention.d1)} · D7 ${cohortPct(m.retention.d7)} · D30 ${cohortPct(m.retention.d30)}`,
    `Воронка: открыли ${f.opened} → играли ${f.played} → 1-й лагерь ${f.camp1} → 4-й лагерь ${f.camp4} → финиш —`,
    `Заплывов на игрока в день: ${dec(m.runsPerPlayerDay)}`,
    `Задания недели: выполнено ${pct(m.quests.rate)} (${m.quests.done}/${m.quests.active * QUESTS_PER_WEEK}) · баллов ${m.quests.weekPoints.toLocaleString('ru')}`,
    `Отклонено заплывов за 7 дней: ${m.rejectedShare === null ? '—' : dec(m.rejectedShare * 100) + '%'}`,
  ].join('\n');
}
