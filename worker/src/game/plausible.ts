export const LEVELS = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVELS)[number];

export interface RunInput {
  level: Level;
  bank: number;
  onboard: number;
  meters: number;
  durationMs: number;
  oarsLost: number;
  startedAt: number;
}

export type Rejection =
  | 'bad_numbers'
  | 'bad_level'
  | 'bad_clock'
  | 'too_short'
  | 'too_fast'
  | 'too_rich';

/**
 * Потолок скорости. Течение и гребля трёх вёсел на «Шторме» с бонусом капитана дают
 * (40+30)*1.15 + 3*(44+16)*1.15*1.9 = 473.8 px/с, при 11 px на метр это 43.1 м/с.
 * Текила добавляет разовый импульс, поэтому порог взят с запасом и применяется
 * к средней скорости за заплыв, а не к мгновенной.
 */
export const MAX_MPS = 55;

/**
 * Потолок очков на метр. Бутылки лежат с шагом не меньше 300*U px, это 27.3 м;
 * самая дорогая — текила, 180 очков, с Геной 360, то есть до 13.2 очка на метр.
 * Плюс до 3 очков за сам метр при обоих множителях. Порог взят с двукратным запасом
 * и калибруется по реальным заплывам после первой недели.
 */
export const MAX_POINTS_PER_METER = 30;

const MIN_DURATION_MS = 5_000;
const CLOCK_AHEAD_MS = 5 * 60 * 1000;
const CLOCK_BEHIND_MS = 30 * 24 * 3600 * 1000;

const isCount = (n: unknown): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Возвращает причину отказа либо null, если заплыв выглядит честным. */
export function checkRun(run: RunInput, now: number): Rejection | null {
  const counts = [run.bank, run.onboard, run.meters, run.durationMs, run.oarsLost];
  if (!counts.every(isCount) || !Number.isInteger(run.startedAt)) return 'bad_numbers';
  if (!LEVELS.includes(run.level)) return 'bad_level';

  if (run.startedAt > now + CLOCK_AHEAD_MS) return 'bad_clock';
  if (run.startedAt < now - CLOCK_BEHIND_MS) return 'bad_clock';

  if (run.durationMs < MIN_DURATION_MS) return 'too_short';
  if (run.meters > (MAX_MPS * run.durationMs) / 1000) return 'too_fast';
  if (run.bank + run.onboard > MAX_POINTS_PER_METER * run.meters) return 'too_rich';

  return null;
}
