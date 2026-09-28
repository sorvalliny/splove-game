import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, step } from './harness.mjs';

const boot = (opts) => {
  const { t, sent } = loadGame(undefined, opts);
  t.setLevel('normal');
  return { t, sent };
};
const pick = (t, type) => t.collect({ type, x: 0, s: 0, pick: 1, seed: 1 });

test('щит гасит первый удар: весло и очки целы, второй удар обычный', () => {
  const { t } = boot();
  t.beginRun('free', 'shield');
  t.G.onb = 500;
  t.hit({});
  assert.equal(t.G.k.oars.join(''), '111', 'весло цело');
  assert.equal(t.G.onb, 500, 'очки целы');
  assert.equal(t.G.k.shield, 0, 'щит потрачен');

  t.G.k.inv = 0;
  t.hit({});
  assert.notEqual(t.G.k.oars.join(''), '111', 'второй удар отнял весло');
  assert.ok(t.G.onb < 500, 'и сжёг очки');
});

test('без щита первый удар обычный', () => {
  const { t } = boot();
  t.beginRun('free', null);
  t.G.onb = 500;
  t.hit({});
  assert.notEqual(t.G.k.oars.join(''), '111');
});

test('удвоение: бутылка вдвое до первого лагеря, после лагеря обычно', () => {
  const { t } = boot();
  t.beginRun('free', 'x2');
  pick(t, 'beer');
  assert.equal(t.G.onb, 80, '40 ×2');

  let guard = 0;
  while (t.G.stage < 1 && guard++ < 120 * 900) step(t);
  assert.equal(t.G.stage, 1, 'лагерь пройден');
  const before = t.G.onb;
  pick(t, 'beer');
  assert.equal(t.G.onb - before, 40, 'после лагеря без удвоения');
});

test('запасное возвращение прибавляет попытку', () => {
  const { t } = boot();
  t.beginRun('free', null);
  const base = t.continuesLeft;
  t.beginRun('free', 'life');
  assert.equal(t.continuesLeft, base + 1);
});

test('бустер действует только на один заплыв: следующий старт без него', () => {
  const { t } = boot();
  t.beginRun('free', 'shield');
  assert.equal(t.G.k.shield, 1);
  t.beginRun('free', null);
  assert.equal(t.G.k.shield ?? 0, 0);
});

test('обычный заплыв без бустера начинается так же, как reset с тем же зерном', () => {
  const { t } = boot();
  const realRandom = Math.random;
  Math.random = () => 0.25;
  try {
    t.beginRun('free', null);
  } finally {
    Math.random = realRandom;
  }
  const a = t.G.k.s;
  t.reset((0.25 * 4294967296) >>> 0);
  assert.equal(t.G.k.s, a);
});

test('заплыв недели: зерно и сложность берутся из недели, в заплыве mode и week', () => {
  const { t, sent } = boot({ weekInfo: () => ({ seed: 777, key: '2026-W41' }) });
  t.setLevel('hard');
  t.beginRun('week', null);
  assert.equal(t.level, 'normal', 'неделя всегда на «Сплаве»');
  const s0 = t.G.k.s;
  t.reset(777);
  assert.equal(s0, t.G.k.s, 'то же зерно, что у reset(777)');

  t.beginRun('week', null);
  t.finishRun(500);
  assert.equal(sent[0].mode, 'week');
  assert.equal(sent[0].week, '2026-W41');
});

test('обычный заплыв уходит с mode free и без недели', () => {
  const { t, sent } = boot();
  t.beginRun('free', null);
  t.finishRun(500);
  assert.equal(sent[0].mode, 'free');
  assert.equal(sent[0].week, null);
});

test('заплыв недели без данных недели запускается как обычный', () => {
  const { t, sent } = boot();
  t.beginRun('week', null);
  t.finishRun(500);
  assert.equal(sent[0].mode, 'free');
});
