import { activeSeason } from './state';
import { isoWeekKey } from './time';
import { getSeasons, addPoints } from '../db/season';
import type { Level } from '../game/plausible';

/** Баллы за мастерство: не чаще раза в неделю на каждую сложность. */
export const SKILL_POINTS = { finish: 100, record: 50 } as const;

const LEVEL_TITLES: Record<Level, string> = { easy: 'Прогулке', normal: 'Сплаве', hard: 'Шторме' };

export interface SkillAward { id: 'finish' | 'record'; title: string; points: number }

/**
 * Первый финиш недели на сложности +100, первый личный рекорд недели (очки или время) +50.
 * Потолок по неделе держит ключ; начисление идемпотентно, повтор запроса ничего не удвоит.
 */
export async function awardSkill(
  db: D1Database, tgId: number, at: number, level: Level, did: { finished: boolean; record: boolean },
): Promise<SkillAward[]> {
  if (!did.finished && !did.record) return [];
  const season = activeSeason(at, await getSeasons(db));
  if (!season) return [];

  const week = isoWeekKey(at);
  const where = `«${LEVEL_TITLES[level]}»`;
  const out: SkillAward[] = [];
  const give = async (id: SkillAward['id'], title: string) => {
    const key = `m:${season.id}:${week}:${id}:${level}`;
    if (await addPoints(db, tgId, season.id, key, SKILL_POINTS[id], at)) out.push({ id, title, points: SKILL_POINTS[id] });
  };
  if (did.finished) await give('finish', `Финиш на ${where}`);
  if (did.record) await give('record', `Личный рекорд на ${where}`);
  return out;
}
