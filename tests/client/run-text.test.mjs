import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Telegram = { WebApp: { initData: 'x', ready() {}, expand() {} } };
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
const { resultText } = await import('../../js/runs.js');

const base = { rejected: null, isRecord: false, best: { bank: 500, meters: 900 }, delta: -100, rank: 3, weekly: undefined };

test('обычный заплыв: рекорд и место', () => {
  assert.match(resultText({ ...base, isRecord: true }, { levelName: 'Сплав', mode: 'free', bank: 600 }), /Личный рекорд. 3-е место на «Сплав»/);
});

test('заплыв недели: рекорд недели, место, баллы и бустер', () => {
  const text = resultText(
    { ...base, isRecord: true, best: { bank: 600, meters: null }, weekly: { points: 50, booster: 'shield' } },
    { mode: 'week', bank: 600 },
  );
  assert.match(text, /Рекорд недели 600/);
  assert.match(text, /3-е место/);
  assert.match(text, /\+50 баллов/);
  assert.match(text, /бустер: Щит/i);
});

test('заплыв недели без рекорда: показывает лучший результат недели', () => {
  const text = resultText({ ...base, weekly: { points: 0, booster: null } }, { mode: 'week', bank: 100 });
  assert.match(text, /лучший за неделю 500/i);
  assert.doesNotMatch(text, /баллов|бустер/);
});

test('заплыв недели без места не пишет «null-е место»', () => {
  const text = resultText({ ...base, rank: null, weekly: { points: 0, booster: null } }, { mode: 'week', bank: 100 });
  assert.doesNotMatch(text, /null/);
});

test('заплыв прошлой недели: объясняет, что в таблицу он не попал', () => {
  const text = resultText({ ...base, rank: null, best: null, weekly: { points: 0, booster: null, stale: true } }, { mode: 'week', bank: 100 });
  assert.match(text, /прошлой недели/);
  assert.doesNotMatch(text, /null/);
});

test('отклонённый заплыв недели объясняет причину', () => {
  assert.match(resultText({ ...base, rejected: 'too_fast' }, { mode: 'week', bank: 1 }), /слишком быстро/);
});

test('финиш: время, рекорд, место по времени и очки', () => {
  const text = resultText(
    { ...base, isRecord: true, finish: { timeMs: 192_400, isRecord: true, rank: 2 } },
    { levelName: 'Сплав', mode: 'free', bank: 600, finished: true },
  );
  assert.match(text, /Финиш! 3:12,4/);
  assert.match(text, /личный рекорд времени/i);
  assert.match(text, /2-е место по времени/);
  assert.match(text, /3-е место на «Сплав»/);
});

test('финиш без рекорда времени не хвастается рекордом', () => {
  const text = resultText(
    { ...base, finish: { timeMs: 200_000, isRecord: false, rank: 5 } },
    { levelName: 'Сплав', mode: 'free', bank: 600, finished: true },
  );
  assert.match(text, /Финиш! 3:20,0/);
  assert.doesNotMatch(text, /рекорд времени/i);
});

test('финиш, снятый сервером (нет finish), пишет обычный итог', () => {
  const text = resultText(base, { levelName: 'Сплав', mode: 'free', bank: 600, finished: true });
  assert.doesNotMatch(text, /Финиш!/);
});
