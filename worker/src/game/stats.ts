export interface RunStats { gena: number; bottles: number; camps: number }

export const ZERO_STATS: RunStats = { gena: 0, bottles: 0, camps: 0 };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Бутылки лежат с шагом от 300 px, то есть не чаще, чем раз в 27 м. */
const METERS_PER_BOTTLE = 27;
/** Гену выпускают раз в 11000–18000 px, это от 1000 м. */
const METERS_PER_GENA = 1000;
/** Первый лагерь на 400 м, дальше каждые 500 м (FIRST_CAMP_M и CAMP_GAP_M в index.html). */
const FIRST_CAMP_M = 400;
const CAMP_GAP_M = 500;

const maxCamps = (meters: number): number =>
  meters >= FIRST_CAMP_M ? Math.floor((meters - FIRST_CAMP_M) / CAMP_GAP_M) + 1 : 0;

/**
 * Статистика приходит от клиента и годится только для заданий. Нарушено любое правило —
 * обнуляем её целиком, а сам заплыв засчитывается как обычно: мошенник теряет только баллы.
 */
export function sanitizeStats(raw: unknown, meters: number): RunStats {
  if (!raw || typeof raw !== 'object') return ZERO_STATS;
  const { gena, bottles, camps } = raw as Record<string, unknown>;
  if (!isCount(gena) || !isCount(bottles) || !isCount(camps)) return ZERO_STATS;

  if (bottles > Math.floor(meters / METERS_PER_BOTTLE) + 2) return ZERO_STATS;
  if (gena > Math.floor(meters / METERS_PER_GENA) + 1) return ZERO_STATS;
  if (camps > maxCamps(meters)) return ZERO_STATS;

  return { gena, bottles, camps };
}
