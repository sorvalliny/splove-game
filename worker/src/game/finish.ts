import { MAX_MPS, STORM_LIMIT_MS, type Level } from './plausible';

/** Дистанции финиша в метрах; такая же таблица FINISH_M лежит в игре. */
export const FINISH_M: Record<Level, number> = { easy: 3000, normal: 4000, hard: 5000 };

/** Запас на расхождение времени симуляции и времени заплыва по часам телефона. */
const TIME_SLACK_MS = 2000;

/**
 * Финиш принимается только когда сходится всё: дистанция пройдена, время целое и не быстрее физики,
 * не дольше самого заплыва, а на «Шторме» укладывается в лимит. Иначе финиш молча снимается,
 * а сам заплыв засчитывается как обычный.
 */
export function acceptFinish(
  level: Level, meters: number, durationMs: number, finished: unknown, timeMs: unknown,
): timeMs is number {
  if (finished !== true) return false;
  if (typeof timeMs !== 'number' || !Number.isInteger(timeMs) || timeMs < 1) return false;
  if (meters < FINISH_M[level]) return false;
  if (timeMs > durationMs + TIME_SLACK_MS) return false;
  if (timeMs < (FINISH_M[level] / MAX_MPS) * 1000) return false;
  if (level === 'hard' && timeMs > STORM_LIMIT_MS) return false;
  return true;
}
