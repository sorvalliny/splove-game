import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, step, metersOf } from './harness.mjs';

const fresh = (seed = 5, level = 'normal') => {
  const { t } = loadGame();
  t.setLevel(level);
  t.reset(seed);
  t.setState('play');
  return t;
};

/** Рассыпает объекты вдоль реки без движения лодки: сдвигаем её вперёд большими шагами. */
function sow(t, stage, { meters = 12000, seed = 5, level = 'normal' } = {}) {
  t.setLevel(level);
  t.reset(seed);
  t.setState('play');
  const G = t.G;
  G.stage = stage;
  const M = 11 * t.U;
  const startS = G.k.s;
  for (let s = startS; s < startS + meters * M; s += 300) {
    G.k.s = s;
    t.spawn();
  }
  return G.objs;
}

const obstacles = (objs) => objs.filter((o) => !o.pick && o.type !== 'lostoar');
const count = (objs, type) => objs.filter((o) => o.type === type).length;

// ---------- ступени ----------

test('ступень растёт при прохождении лагеря и не сбрасывается при возврате в лагерь', () => {
  const t = fresh(3, 'easy');
  assert.equal(t.G.stage, 0);
  let guard = 0;
  while (t.G.stage < 1 && guard++ < 120 * 900) step(t);
  assert.equal(t.G.stage, 1, 'после первого лагеря ступень 1');
  t.setCont(2);
  t.continueRun();
  assert.equal(t.G.stage, 1, 'возврат в лагерь ступень не сбрасывает');
});

test('препятствия чаще на высокой ступени и рост упирается в потолок', () => {
  const n0 = obstacles(sow(fresh(), 0)).length;
  const n10 = obstacles(sow(fresh(), 10)).length;
  const n20 = obstacles(sow(fresh(), 20)).length;
  assert.ok(n10 > n0 * 1.4, `ступень 10: ${n10}, ступень 0: ${n0}`);
  assert.equal(n20, n10, 'выше потолка рост прекращается');
});

test('течение быстрее на высокой ступени и тоже упирается в потолок', () => {
  const travel = (stage) => {
    const t = fresh();
    t.G.stage = stage;
    const s0 = t.G.k.s;
    for (let i = 0; i < 600; i++) t.update(t.SIM_DT); // без spawn: рек чистая, мешать нечему
    return t.G.k.s - s0;
  };
  const d0 = travel(0);
  const d10 = travel(10);
  assert.ok(d10 > d0, `ступень 10 проходит ${d10}, ступень 0 ${d0}`);
  assert.ok(Math.abs(travel(20) - d10) < 1e-9, 'выше потолка скорость не растёт');
});

// ---------- новые препятствия ----------

test('сети нет ниже ступени 3, гидроцикла ниже ступени 4', () => {
  for (const stage of [0, 1, 2]) {
    const objs = sow(fresh(), stage);
    assert.equal(count(objs, 'net'), 0, `сеть на ступени ${stage}`);
    assert.equal(count(objs, 'jet'), 0, `гидроцикл на ступени ${stage}`);
  }
  const s3 = sow(fresh(), 3);
  assert.ok(count(s3, 'net') > 0, 'сеть появляется на ступени 3');
  assert.equal(count(s3, 'jet'), 0, 'гидроцикла на ступени 3 ещё нет');
  const s4 = sow(fresh(), 4);
  assert.ok(count(s4, 'net') > 0 && count(s4, 'jet') > 0, 'на ступени 4 есть и то и другое');
});

test('доли новых препятствий близки к 12% и 10%', () => {
  const objs = sow(fresh(11), 4, { meters: 40000 });
  const obs = obstacles(objs);
  const share = (type) => count(objs, type) / obs.length;
  assert.ok(share('net') > 0.07 && share('net') < 0.17, `сеть ${share('net')}`);
  assert.ok(share('jet') > 0.05 && share('jet') < 0.15, `гидроцикл ${share('jet')}`);
});

test('у сети один проход не уже 60·U на любой сложности, остальное сплошное', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const t = fresh(9, level);
    const objs = sow(t, 3, { level, meters: 30000 });
    const nets = objs.filter((o) => o.type === 'net');
    assert.ok(nets.length > 0);
    const hit = t.DIFF[level].hit;
    const U = t.U;
    for (const net of nets) {
      const xs = net.c.map((c) => ({ dx: c[0], reach: c[2] * hit + 12 * U })).sort((a, b) => a.dx - b.dx);
      const gaps = [];
      for (let i = 1; i < xs.length; i++) gaps.push(xs[i].dx - xs[i - 1].dx - xs[i].reach - xs[i - 1].reach);
      const open = gaps.filter((g) => g > 0);
      assert.equal(open.length, 1, `сеть должна иметь один проход, а не ${open.length} (${level})`);
      assert.ok(open[0] >= 60 * U, `проход ${open[0] / U}·U на «${level}»`);
    }
  }
});

test('после сети 300·U без других препятствий', () => {
  const objs = sow(fresh(9), 3, { meters: 30000 });
  const U = 1; // проверяем в единицах, зависящих от t.U ниже
  void U;
  const t = fresh(9);
  const list = sow(t, 3, { meters: 30000 });
  const M = 300 * t.U;
  list.forEach((o, i) => {
    if (o.type !== 'net') return;
    for (const later of list.slice(i + 1)) {
      if (later.pick || later.type === 'lostoar') continue;
      assert.ok(later.s >= o.s + M - 1e-6, `после сети на ${o.s} пошло препятствие на ${later.s}`);
    }
  });
  assert.ok(objs.length > 0);
});

test('гидроцикл идёт поперёк реки и остаётся внутри неё', () => {
  const t = fresh(4);
  const jets = sow(t, 4, { meters: 20000 }).filter((o) => o.type === 'jet');
  assert.ok(jets.length > 0);
  const jet = jets[0];
  assert.ok(Math.abs(jet.vx) > 0);
  t.G.objs = [jet];
  t.G.k.s = jet.s - 900 * t.U;
  const x0 = jet.x;
  for (let i = 0; i < 3000; i++) {
    t.update(t.SIM_DT);
    const half = (t.riverW(jet.s) / 2) * 0.86;
    assert.ok(Math.abs(jet.x - t.cx(jet.s)) <= half + Math.abs(jet.vx) * t.SIM_DT + 1e-6, 'вышел за берег');
    t.G.k.s = jet.s - 900 * t.U; // держим лодку на месте
  }
  assert.notEqual(jet.x, x0, 'гидроцикл двигался');
});

// ---------- пасхалки: подбор ----------

const pick = (t, type) => t.collect({ type, x: 0, s: 0, pick: 1, seed: 1 });

test('борщ: +150 очков и хмель +40, бутылкой для заданий не считается', () => {
  const t = fresh();
  pick(t, 'borsch');
  assert.equal(t.G.onb, 150);
  assert.equal(t.G.hmel, 40);
  assert.equal(t.G.st.bottles, 0);
});

test('баня обнуляет хмель и очков не даёт', () => {
  const t = fresh();
  t.G.hmel = 70;
  pick(t, 'banya');
  assert.equal(t.G.hmel, 0);
  assert.equal(t.G.onb, 0);
});

test('уха Дяди Санчеза: ровно 999, хмель +35, Гена очки не удваивает', () => {
  const t = fresh();
  t.G.gena = 22;
  pick(t, 'sanchez');
  assert.equal(t.G.onb, 999);
  assert.equal(t.G.hmel, 35);
  assert.equal(t.G.st.sanchez, 1);
});

test('счётчик Санчеза откатывается возвратом в лагерь вместе с бутылками', () => {
  const t = fresh(3, 'easy');
  let guard = 0;
  while (t.G.stage < 1 && guard++ < 120 * 900) step(t);
  const before = t.G.st.sanchez;
  pick(t, 'sanchez');
  assert.equal(t.G.st.sanchez, before + 1);
  t.setCont(2);
  t.continueRun();
  assert.equal(t.G.st.sanchez, before);
});

// ---------- пасхалки: появление ----------

test('борща нет на ступени 0 и он есть на ступени 1', () => {
  assert.equal(count(sow(fresh(), 0), 'borsch'), 0);
  const objs = sow(fresh(), 1, { meters: 20000 });
  const bottles = objs.filter((o) => ['beer', 'wine', 'teq', 'borsch', 'oar'].includes(o.type)).length;
  const share = count(objs, 'borsch') / bottles;
  assert.ok(share > 0.04 && share < 0.13, `доля борща ${share}`);
});

test('баня с ступени 1 примерно раз в километр, на берегу', () => {
  assert.equal(count(sow(fresh(), 0), 'banya'), 0);
  const t = fresh();
  const objs = sow(t, 1, { meters: 20000 });
  const n = count(objs, 'banya');
  assert.ok(n >= 12 && n <= 30, `бань за 20 км: ${n}`);
  for (const o of objs.filter((x) => x.type === 'banya')) {
    assert.ok(Math.abs(o.x - t.cx(o.s)) >= 0.8 * t.riverW(o.s) / 2, 'баня стоит у берега');
  }
});

test('Санчез с ступени 2, раз в 2–3 км, на берегу', () => {
  assert.equal(count(sow(fresh(), 1, { meters: 20000 }), 'sanchez'), 0);
  const t = fresh();
  const objs = sow(t, 2, { meters: 30000 });
  const list = objs.filter((o) => o.type === 'sanchez');
  assert.ok(list.length >= 8 && list.length <= 18, `Санчезов за 30 км: ${list.length}`);
  for (let i = 1; i < list.length; i++) {
    const gap = (list[i].s - list[i - 1].s) / (11 * t.U);
    assert.ok(gap >= 1999 && gap <= 3001, `шаг ${gap} м`);
  }
  for (const o of list) assert.ok(Math.abs(o.x - t.cx(o.s)) >= 0.8 * t.riverW(o.s) / 2, 'костёр у берега');
});

// ---------- рисование ----------

test('все новые объекты рисуются без ошибок', () => {
  const t = fresh(6);
  const objs = sow(t, 4, { meters: 30000 });
  const types = ['net', 'jet', 'banya', 'sanchez', 'borsch'];
  const withSanchez = sow(t, 4, { meters: 40000 });
  const all = [...objs, ...withSanchez];
  for (const type of types) {
    const o = all.find((x) => x.type === type);
    assert.ok(o, `в выборке есть ${type}`);
    assert.doesNotThrow(() => t.drawObj(o), `рисование ${type}`);
  }
});

test('сеяная случайность: два одинаковых заплыва на ступени 4 совпадают до числа', () => {
  const run = () => {
    const t = fresh(8);
    const objs = sow(t, 4, { meters: 15000, seed: 8 });
    return objs.map((o) => `${o.type}:${o.s.toFixed(3)}:${o.x.toFixed(3)}`).join('|');
  };
  assert.equal(run(), run());
});
