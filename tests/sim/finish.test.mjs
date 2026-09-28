import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, step } from './harness.mjs';

const boot = (level = 'normal') => {
  const { t, sent } = loadGame();
  t.setLevel(level);
  t.beginRun('free', null);
  return { t, sent };
};

/** Подводит лодку к финишу и шагает, пока заплыв не закончится. */
function toFinish(t, metersBefore = 30) {
  const G = t.G;
  G.k.s = G.finishAt - metersBefore * 11 * t.U;
  G.k.prevS = G.k.s;
  G.objs = [];
  let guard = 0;
  while (t.state === 'play' && guard++ < 20000) { t.update(t.SIM_DT); G.objs = []; }
}

test('дистанция финиша зависит от сложности: 3, 4 и 5 км', () => {
  for (const [level, m] of [['easy', 3000], ['normal', 4000], ['hard', 5000]]) {
    const { t } = boot(level);
    assert.equal(Math.round((t.G.finishAt - t.G.k.s0) / (11 * t.U)), m, level);
    assert.equal(t.FINISH_M[level], m);
  }
});

test('пересечение линии завершает заплыв: очки сдаются в лагерь, время равно времени симуляции', () => {
  const { t, sent } = boot('normal');
  t.G.onb = 250;
  t.G.bank = 100;
  for (let i = 0; i < 240; i++) t.update(t.SIM_DT);   // две секунды игры до финиша
  toFinish(t);
  assert.equal(t.state, 'finish');
  // Очки за метры по дороге к линии тоже копятся, поэтому сумма не меньше 100 + 250.
  assert.ok(t.G.bank >= 350, `банк ${t.G.bank}`);
  assert.equal(t.G.onb, 0, 'очки на воде сданы автоматически');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].finished, true);
  assert.equal(sent[0].timeMs, Math.round(t.simT * 1000));
  assert.ok(sent[0].meters >= 4000, `метры ${sent[0].meters}`);
  assert.equal(sent[0].bank, t.G.bank, 'в заплыв уходит банк уже со сданными очками');
  assert.equal(sent[0].onboard, 0);
});

test('финиш не считается лагерем', () => {
  const { t, sent } = boot('easy');
  const before = t.G.st.camps;
  toFinish(t);
  assert.equal(t.G.st.camps, before);
  assert.equal(sent[0].stats.camps, before);
});

test('заплыв уходит один раз, повторные шаги его не дублируют', () => {
  const { t, sent } = boot('easy');
  toFinish(t);
  for (let i = 0; i < 300; i++) t.update(t.SIM_DT);
  assert.equal(sent.length, 1);
  assert.equal(t.state, 'finish');
});

test('возврат в лагерь время не обнуляет', () => {
  const { t, sent } = boot('easy');
  for (let i = 0; i < 600; i++) t.update(t.SIM_DT);     // пять секунд
  const played = t.simT;
  t.G.lastCamp = { s: t.G.k.s - 100, name: 'Тест' };
  t.G.camps = [];
  t.setCont(2);
  t.continueRun();
  toFinish(t);
  assert.ok(sent[0].timeMs >= Math.round(played * 1000), 'время включает всё сыгранное до возврата');
});

test('без финиша заплыв не помечается финишировавшим', () => {
  const { t, sent } = boot('easy');
  t.finishRun(500);
  assert.equal(sent[0].finished, false);
  assert.equal(sent[0].timeMs, null);
});

test('заплыв недели тоже имеет финиш на 4 км', () => {
  const { t } = loadGame(undefined, { weekInfo: () => ({ seed: 11, key: '2026-W41' }) });
  t.beginRun('week', null);
  assert.equal(Math.round((t.G.finishAt - t.G.k.s0) / (11 * t.U)), 4000);
});
