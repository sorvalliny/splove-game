import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// auth.js читает Telegram при загрузке модуля, поэтому заглушки ставим до импорта.
globalThis.Telegram = { WebApp: { initData: 'x', ready() {}, expand() {} } };

const make = () => ({ hidden: true, innerHTML: '', textContent: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } });
const els = { startWeek: make(), weekLine: make(), boosterRow: make() };
globalThis.document = { getElementById: (id) => els[id] ?? null };

const { initWeek, consumeBooster, stopWeekTimer, weekData } = await import('../../js/week.js');

const NOW = 1_791_000_000;
const reply = (data) => { globalThis.fetch = async () => ({ json: async () => ({ ok: true, data, error: null }) }); };
const week = (over = {}) => ({
  now: NOW, weekKey: '2026-W41', seed: 4242, level: 'normal', endsAt: NOW + 3 * 86400 + 4 * 3600 + 10 * 60,
  board: [], me: null, boosters: { shield: 0, x2: 0, life: 0 }, ...over,
});
const click = (kind) => els.boosterRow.listeners.click({ target: { closest: () => ({ dataset: { k: kind } }) } });

test('кнопка недели, номер недели и таймер до конца', async () => {
  reply(week());
  await initWeek();
  stopWeekTimer();
  assert.equal(els.startWeek.hidden, false);
  assert.equal(els.weekLine.hidden, false);
  assert.match(els.weekLine.textContent, /Неделя W41/);
  assert.match(els.weekLine.textContent, /3д 04:1\d:\d\d/);
});

test('плашки бустеров только для тех, что есть, с количеством', async () => {
  reply(week({ boosters: { shield: 2, x2: 0, life: 1 } }));
  await initWeek();
  stopWeekTimer();
  assert.match(els.boosterRow.innerHTML, /Щит ×2/);
  assert.match(els.boosterRow.innerHTML, /Возвращение ×1/);
  assert.doesNotMatch(els.boosterRow.innerHTML, /Удвоение/);
  assert.equal(els.boosterRow.hidden, false);
});

test('без бустеров строка бустеров скрыта', async () => {
  reply(week());
  await initWeek();
  stopWeekTimer();
  assert.equal(els.boosterRow.hidden, true);
});

test('нажатие заряжает бустер, повторное снимает', async () => {
  reply(week({ boosters: { shield: 1, x2: 1, life: 0 } }));
  await initWeek();
  stopWeekTimer();
  click('shield');
  assert.match(els.boosterRow.innerHTML, /chip on"[^>]*data-k="shield"|data-k="shield"[^>]*chip on|class="chip on" data-k="shield"/);
  click('x2');
  assert.match(els.boosterRow.innerHTML, /class="chip on" data-k="x2"/, 'заряжен только один: теперь удвоение');
  assert.doesNotMatch(els.boosterRow.innerHTML, /class="chip on" data-k="shield"/);
  click('x2');
  assert.doesNotMatch(els.boosterRow.innerHTML, /class="chip on"/);
});

test('старт с заряженным бустером списывает его на сервере и возвращает вид', async () => {
  reply(week({ boosters: { shield: 1, x2: 0, life: 0 } }));
  await initWeek();
  stopWeekTimer();
  click('shield');
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { json: async () => ({ ok: true, data: { kind: 'shield' }, error: null }) }; };
  const kind = await consumeBooster();
  assert.equal(kind, 'shield');
  assert.deepEqual(calls[0][1], { kind: 'shield' });
  assert.match(calls[0][0], /\/api\/booster\/use$/);
  assert.equal(weekData().boosters.shield, 0, 'счётчик уменьшился');
  assert.equal(els.boosterRow.hidden, true, 'плашек больше нет');
  assert.equal(await consumeBooster(), null, 'второй раз заряжать нечего');
});

test('если сервер отказал, играем без бустера', async () => {
  reply(week({ boosters: { shield: 1, x2: 0, life: 0 } }));
  await initWeek();
  stopWeekTimer();
  click('shield');
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, data: null, error: { code: 'no_booster', message: 'x' } }) });
  assert.equal(await consumeBooster(), null);
});

test('без заряженного бустера сеть не трогается', async () => {
  reply(week({ boosters: { shield: 1, x2: 0, life: 0 } }));
  await initWeek();
  stopWeekTimer();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { json: async () => ({ ok: true, data: {}, error: null }) }; };
  assert.equal(await consumeBooster(), null);
  assert.equal(calls, 0);
});

test('игра получает зерно и ключ недели через weekInfo', async () => {
  reply(week({ seed: 999, weekKey: '2026-W42' }));
  await initWeek();
  stopWeekTimer();
  assert.deepEqual(globalThis.weekInfo(), { seed: 999, key: '2026-W42' });
});

test('если первая загрузка не удалась, повтор идёт по таймеру и кнопка появляется', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  els.startWeek.hidden = true;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { json: async () => ({ ok: false, data: null, error: { code: 'x', message: 'x' } }) };
    return { json: async () => ({ ok: true, error: null, data: week() }) };
  };
  await initWeek();
  assert.equal(els.startWeek.hidden, true, 'после неудачи кнопки нет');
  for (let i = 0; i < 8; i++) { mock.timers.tick(1000); await Promise.resolve(); await Promise.resolve(); }
  await new Promise((r) => setImmediate(r));
  stopWeekTimer();
  mock.timers.reset();
  assert.ok(calls >= 2, `запросов ${calls}`);
  assert.equal(els.startWeek.hidden, false, 'после повтора кнопка появилась');
});

test('ошибка сервера: кнопки недели скрыты', async () => {
  els.startWeek.hidden = true;
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, data: null, error: { code: 'x', message: 'x' } }) });
  await initWeek();
  stopWeekTimer();
  assert.equal(els.startWeek.hidden, true);
});
