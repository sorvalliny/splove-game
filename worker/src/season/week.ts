/** Баллы недели: настраиваются здесь, в одном месте. */
export const WEEK_POINTS = { play: 50, top: [300, 200, 100] } as const;

export const BOOSTER_KINDS = ['shield', 'x2', 'life'] as const;
export type BoosterKind = (typeof BOOSTER_KINDS)[number];

export const BOOSTER_TITLES: Record<BoosterKind, string> = {
  shield: 'Щит: первый удар за заплыв не отнимает ни весло, ни очки',
  x2: 'Удвоение: очки ×2 до первого лагеря',
  life: 'Запасное возвращение в лагерь',
};

/** Зерно трассы недели: одно на всех игроков, разное по неделям. */
export const weekSeed = (weekIdx: number): number => Math.imul(weekIdx + 1000, 0x9e3779b1) >>> 0;

/** Вид бустера детерминирован от игрока и недели: повторный запрос даёт тот же. */
export function boosterKindFor(tgId: number, weekKey: string): BoosterKind {
  let h = 2166136261;
  for (const ch of `${tgId}:${weekKey}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return BOOSTER_KINDS[h % BOOSTER_KINDS.length];
}
