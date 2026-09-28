/** Время сезона живёт по Москве (UTC+3, без перехода на летнее). Все аргументы — секунды UTC. */
export const MSK_OFFSET_SEC = 3 * 3600;
export const DAY_SEC = 86400;
export const WEEK_SEC = 7 * DAY_SEC;

/** Понедельник 2026-09-28, 00:00 по Москве: точка отсчёта индекса недели. */
export const WEEK_EPOCH = 1790542800;

/** Московская дата как UTC-полночь: с ней удобно работать методами getUTC*. */
const mskMidnight = (sec: number): Date => {
  const shifted = new Date((sec + MSK_OFFSET_SEC) * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

export const mskDay = (sec: number): string => mskMidnight(sec).toISOString().slice(0, 10);

/** ISO-неделя московской даты: неделя принадлежит тому году, в котором лежит её четверг. */
export function isoWeekKey(sec: number): string {
  const d = mskMidnight(sec);
  const thursday = new Date(d.getTime() + (4 - (d.getUTCDay() || 7)) * DAY_SEC * 1000);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - jan1) / (DAY_SEC * 1000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const weekIndex = (sec: number): number => Math.floor((sec - WEEK_EPOCH) / WEEK_SEC);

export const weekStart = (sec: number): number => WEEK_EPOCH + weekIndex(sec) * WEEK_SEC;
