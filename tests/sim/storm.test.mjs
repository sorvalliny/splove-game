import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './harness.mjs';

const boot = (level, seed = 5) => {
  const { t, sent } = loadGame();
  t.setLevel(level);
  t.reset(seed);
  t.setState('play');
  return { t, sent };
};

/** Один шаг без препятствий: река чистая, лодка стоит на стрежне. */
const calm = (t, n = 1) => { for (let i = 0; i < n; i++) { t.G.objs = []; t.update(t.SIM_DT); } };

test('ветер и дождь только на «Шторме»', () => {
  assert.equal(boot('easy').t.G.storm ?? null, null);
  assert.equal(boot('normal').t.G.storm ?? null, null);
  const gusts = boot('hard').t.G.storm.gusts;
  assert.ok(gusts.length >= 20, `порывов ${gusts.length}`);
});

test('порывы детерминированы от зерна и различаются между зёрнами', () => {
  // Объекты из разных загрузок игры живут в разных окружениях, поэтому сравниваем через JSON.
  const a = JSON.stringify(boot('hard', 7).t.G.storm.gusts);
  const b = JSON.stringify(boot('hard', 7).t.G.storm.gusts);
  const c = JSON.stringify(boot('hard', 8).t.G.storm.gusts);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('порыв: пауза 10–18 с, длительность 3–5 с, оба направления встречаются', () => {
  const dirs = new Set();
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = boot('hard', seed).t.G.storm.gusts;
    for (let i = 0; i < g.length; i++) {
      assert.ok(g[i].len >= 3 && g[i].len <= 5, `длительность ${g[i].len}`);
      assert.ok(g[i].dir === 1 || g[i].dir === -1);
      dirs.add(g[i].dir);
      if (i > 0) {
        const gap = g[i].start - (g[i - 1].start + g[i - 1].len);
        assert.ok(gap >= 10 - 1e-9 && gap <= 18 + 1e-9, `пауза ${gap}`);
      }
    }
    assert.ok(g[0].start >= 10 && g[0].start <= 18, `первый порыв в ${g[0].start} с`);
  }
  assert.equal(dirs.size, 2);
});

test('предупреждение приходит за 1,5 секунды до порыва, раньше нет', () => {
  const { t } = boot('hard', 3);
  const g = t.G.storm.gusts[0];
  const texts = () => t.G.texts.map((x) => x.txt ?? x.s).join('|');
  while (t.simT < g.start - 1.6) calm(t);
  assert.doesNotMatch(texts(), /Порыв/);
  while (t.simT < g.start - 1.4) calm(t);
  assert.match(String(t.G.texts.map((x) => JSON.stringify(x)).join('|')), /Порыв (слева|справа)/);
});

test('порыв сносит лодку в сторону порыва', () => {
  const { t } = boot('hard', 3);
  const { t: quiet } = boot('hard', 3);
  quiet.G.storm.gusts = [];
  const g = t.G.storm.gusts[0];
  const settle = (game) => { game.G.k.x = game.cx(game.G.k.s); };
  settle(t); settle(quiet);
  while (t.simT < g.start + g.len) {
    calm(t); calm(quiet);
  }
  const drift = (t.G.k.x - t.cx(t.G.k.s)) - (quiet.G.k.x - quiet.cx(quiet.G.k.s));
  assert.ok(Math.sign(drift) === g.dir, `снос ${drift}, направление ${g.dir}`);
  assert.ok(Math.abs(drift) > 5 * t.U, `снос слишком мал: ${drift}`);
});

test('дождь ослабляет управление на 15% только на «Шторме»', () => {
  const av = (level) => {
    const { t } = boot(level, 5);
    t.held.set('x', 1);
    t.G.k.av = 0;
    calm(t);
    return t.G.k.av;
  };
  const normal = av('normal');
  const hard = av('hard');
  assert.ok(normal > 0);
  assert.ok(Math.abs(hard / normal - 0.85) < 0.02, `отношение ${hard / normal}`);
});

test('лимит 330 секунд: время вышло — заплыв закончен без финиша, очки сдаются', () => {
  const { t, sent } = boot('hard', 5);
  t.G.finishAt = Infinity;
  t.G.onb = 200;
  t.G.bank = 50;
  let guard = 0;
  while (t.state === 'play' && guard++ < 45000) calm(t);
  assert.equal(t.state, 'over');
  assert.ok(t.simT >= 330 && t.simT < 331, `время ${t.simT}`);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].finished, false);
  assert.equal(sent[0].timeMs, null);
  assert.equal(sent[0].onboard, 0, 'очки на воде сданы');
  assert.ok(sent[0].bank >= 250);
});

test('на «Прогулке» и «Сплаве» лимита времени нет', () => {
  for (const level of ['easy', 'normal']) {
    const { t } = boot(level, 5);
    t.G.finishAt = Infinity;
    calm(t, 120 * 335);
    assert.equal(t.state, 'play', level);
  }
});

test('выше ступень — сильнее порыв', () => {
  const { t } = boot('hard', 3);
  const g = t.G.storm.gusts[0];
  const drift = (stage) => {
    const { t: x } = boot('hard', 3);
    x.G.stage = stage;
    x.G.k.x = x.cx(x.G.k.s);
    const x0 = x.G.k.x - x.cx(x.G.k.s);
    while (x.simT < g.start + g.len) calm(x);
    return Math.abs(x.G.k.x - x.cx(x.G.k.s) - x0);
  };
  assert.ok(drift(10) > drift(0), 'на 10-й ступени ветер сильнее');
  assert.ok(t.G.storm);
});

test('в тот же тик, когда время вышло, финиша нет: побеждает лимит времени', () => {
  const { t, sent } = boot('hard', 5);
  t.setSimT(329.9995);
  t.G.finishAt = t.G.k.s + 0.001;     // линия сразу за носом: пересечётся в этом же шаге
  t.G.objs = [];
  t.update(t.SIM_DT * 2);             // simT переходит 330 и линия пересекается в одном тике
  assert.equal(t.state, 'over');
  assert.equal(sent[0].finished, false);
});

test('предупреждение о порыве называет сторону, откуда дует: снос вправо — порыв слева', () => {
  const { t } = boot('hard', 3);
  const g = t.G.storm.gusts[0];
  while (t.simT < g.start - 1.4) { t.G.objs = []; t.update(t.SIM_DT); }
  const text = t.G.texts.map((x) => x.s).join('|');
  assert.match(text, g.dir > 0 ? /Порыв слева/ : /Порыв справа/);
});

