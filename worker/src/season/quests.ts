import { getSeasons, weekProgress, addPoints } from '../db/season';
import { activeSeason } from './state';
import { isoWeekKey, weekIndex, weekStart, WEEK_SEC } from './time';

export type Metric = 'gena' | 'camps' | 'bottles' | 'meters' | 'days';

export interface Quest { id: string; title: string; points: number; goal: number; metric: Metric }

export interface WeekProgress { gena: number; camps: number; bottles: number; meters: number; days: number }

export const POOL: Quest[] = [
  { id: 'gena',      title: 'Подобрать Гену',          points: 150, goal: 1,    metric: 'gena' },
  { id: 'camp3',     title: 'Дойти до 3-го лагеря',    points: 200, goal: 3,    metric: 'camps' },
  { id: 'bottles10', title: 'Собрать 10 бутылок',      points: 100, goal: 10,   metric: 'bottles' },
  { id: 'km2',       title: 'Проплыть 2 км за неделю', points: 150, goal: 2000, metric: 'meters' },
  { id: 'days3',     title: 'Сыграть в 3 разных дня',  points: 200, goal: 3,    metric: 'days' },
];

export const PER_WEEK = 3;

/** Три подряд идущих задания набора по кругу; у всех игроков одни и те же. */
export function questsForWeek(weekIdx: number): Quest[] {
  const start = ((weekIdx % POOL.length) + POOL.length) % POOL.length;
  return Array.from({ length: PER_WEEK }, (_, i) => POOL[(start + i) % POOL.length]);
}

export const valueOf = (q: Quest, p: WeekProgress): number => p[q.metric];

export const isDone = (q: Quest, p: WeekProgress): boolean => valueOf(q, p) >= q.goal;

/**
 * Начисляет баллы за выполненные задания текущей недели и возвращает только что выполненные.
 * Окно прогресса не заходит раньше старта сезона: заплывы до 1 октября в зачёт не идут.
 */
export async function awardQuests(db: D1Database, tgId: number, now: number): Promise<Quest[]> {
  const season = activeSeason(now, await getSeasons(db));
  if (!season) return [];

  const wStart = weekStart(now);
  const progress = await weekProgress(db, tgId, Math.max(wStart, season.starts_at), wStart + WEEK_SEC);
  const week = isoWeekKey(now);

  const fresh: Quest[] = [];
  for (const q of questsForWeek(weekIndex(now))) {
    if (!isDone(q, progress)) continue;
    if (await addPoints(db, tgId, season.id, `q:${season.id}:${week}:${q.id}`, q.points, now)) fresh.push(q);
  }
  return fresh;
}
