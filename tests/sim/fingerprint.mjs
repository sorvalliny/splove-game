import { loadGame, step, metersOf } from './harness.mjs';

export const STAGE0_SEEDS = [123456, 1, 2, 3, 7, 42];
/** Первый лагерь на 400 м: до 380 м ступень гарантированно нулевая. */
const STAGE0_LIMIT_M = 380;

/** Слепок состояния: если хоть одно число разошлось, симуляция изменилась. */
export function snapshot(t) {
  const G = t.G;
  const k = G.k;
  return {
    s: k.s, x: k.x, ang: k.ang, onb: G.onb, bank: G.bank, hmel: G.hmel,
    oars: k.oars.join(''), objs: G.objs.length, camps: G.camps.length,
    objSum: G.objs.reduce((a, o) => a + o.s + o.x, 0),
  };
}

/** Прогоняет заплыв без управления до 380 м и возвращает число шагов и слепок. */
export function stageZeroRun(t, seed, level = 'easy') {
  t.setLevel(level);
  t.reset(seed);
  t.setState('play');
  let steps = 0;
  while (metersOf(t) < STAGE0_LIMIT_M && steps < 30000) {
    step(t, 1);
    steps++;
  }
  return { steps, stage: t.G.stage ?? 0, snapshot: snapshot(t) };
}

/** Каждый заплыв на чистой загрузке игры: часы симуляции сбрасывает только кнопка «На воду». */
export function captureStage0() {
  return STAGE0_SEEDS.flatMap((seed) =>
    ['easy', 'normal', 'hard'].map((level) => {
      const { t } = loadGame();
      return { seed, level, ...stageZeroRun(t, seed, level) };
    }));
}
