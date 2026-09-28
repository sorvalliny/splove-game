export interface RunStats { gena: number; bottles: number; camps: number; sanchez: number }

export const ZERO_STATS: RunStats = { gena: 0, bottles: 0, camps: 0, sanchez: 0 };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Бутылки лежат с шагом от 300 px, то есть не чаще, чем раз в 27 м. */
const METERS_PER_BOTTLE = 27;
/** Первый Гена лежит на 6000 px от старта (≈545 м), дальше шаг от 11000 px, то есть от 1000 м. */
const FIRST_GENA_M = 540;
const METERS_PER_GENA = 1000;
/** Первый лагерь на 400 м, дальше каждые 500 м (FIRST_CAMP_M и CAMP_GAP_M в index.html). */
const FIRST_CAMP_M = 400;
const CAMP_GAP_M = 500;

/** Первый костёр Санчеза не раньше второго лагеря плюс расстояние до него: с запасом 1800 м, дальше шаг от 2000 м. */
const FIRST_SANCHEZ_M = 1800;
const METERS_PER_SANCHEZ = 2000;
const maxSanchez = (meters: number): number =>
  meters >= FIRST_SANCHEZ_M ? Math.floor((meters - FIRST_SANCHEZ_M) / METERS_PER_SANCHEZ) + 1 : 0;

const maxGena = (meters: number): number =>
  meters >= FIRST_GENA_M ? Math.floor((meters - FIRST_GENA_M) / METERS_PER_GENA) + 1 : 0;

const maxCamps = (meters: number): number =>
  meters >= FIRST_CAMP_M ? Math.floor((meters - FIRST_CAMP_M) / CAMP_GAP_M) + 1 : 0;

/**
 * Статистика приходит от клиента и годится только для заданий. Нарушено любое правило —
 * обнуляем её целиком, а сам заплыв засчитывается как обычно.
 *
 * Граница честно узкая: подделка в пределах этих потолков проходит, потому что метры и время
 * тоже присылает клиент. Полностью закрывает её только серверная перепроверка заплыва, пока
 * призёров проверяют вручную.
 */
export function sanitizeStats(raw: unknown, meters: number): RunStats {
  if (!raw || typeof raw !== 'object') return ZERO_STATS;
  const { gena, bottles, camps, sanchez = 0 } = raw as Record<string, unknown>; // sanchez нет у старых клиентов
  if (!isCount(gena) || !isCount(bottles) || !isCount(camps) || !isCount(sanchez)) return ZERO_STATS;

  if (bottles > Math.floor(meters / METERS_PER_BOTTLE) + 2) return ZERO_STATS;
  if (gena > maxGena(meters)) return ZERO_STATS;
  if (camps > maxCamps(meters)) return ZERO_STATS;
  if (sanchez > maxSanchez(meters)) return ZERO_STATS;

  return { gena, bottles, camps, sanchez };
}
