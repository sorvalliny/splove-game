import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// auth.js читает Telegram при загрузке модуля, поэтому заглушки ставим до импорта.
globalThis.Telegram = { WebApp: { initData: 'x', ready() {}, expand() {} } };
const el = { hidden: true, innerHTML: '', addEventListener() {} };
const timerEl = { textContent: '' };
globalThis.document = {
  getElementById: (id) => (id === 'seasonCard' ? el : id === 'seasonTimer' ? timerEl : null),
};

const { initSeason, stopSeasonTimer } = await import('../../js/season.js');

const STARTS = 1790802000;
const reply = (data) => { globalThis.fetch = async () => ({ json: async () => ({ ok: true, data, error: null }) }); };
const me = { total: 0, seasonPoints: 0, rank: null };

test('до старта показывает таймер и дату начала заданий', async () => {
  const left = ((2 * 24 + 3) * 60 * 60 + 14 * 60 + 22);
  reply({ now: STARTS - left, season: { title: 'Осень', state: 'before', startsAt: STARTS, day: 0, days: 92 }, me });
  await initSeason();
  stopSeasonTimer();
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /Осень стартует через/);
  assert.match(el.innerHTML, /2д 03:14:22/);
  assert.match(el.innerHTML, /Задания откроются 1 октября/);
});

test('во время сезона показывает день, полосу и баллы с местом', async () => {
  reply({ now: STARTS + 5 * 86400, season: { title: 'Осень', state: 'active', startsAt: STARTS, day: 6, days: 92 },
          me: { total: 640, seasonPoints: 640, rank: 7 } });
  await initSeason();
  assert.match(el.innerHTML, /Осень · день 6 из 92/);
  assert.match(el.innerHTML, /width:7%/);
  assert.match(el.innerHTML, /Твои баллы: <b>640<\/b> · место 7/);
});

test('без баллов пишет «Баллов пока нет»', async () => {
  reply({ now: STARTS + 86400, season: { title: 'Осень', state: 'active', startsAt: STARTS, day: 2, days: 92 }, me });
  await initSeason();
  assert.match(el.innerHTML, /Баллов пока нет/);
});

test('название сезона экранируется', async () => {
  reply({ now: STARTS + 86400, season: { title: '<b>x</b>', state: 'active', startsAt: STARTS, day: 2, days: 92 }, me });
  await initSeason();
  assert.doesNotMatch(el.innerHTML, /<b>x<\/b>/);
  assert.match(el.innerHTML, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('ошибка сервера карточку не ломает и не показывает', async () => {
  el.hidden = true; el.innerHTML = '';
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, data: null, error: { code: 'x', message: 'x' } }) });
  await initSeason();
  assert.equal(el.hidden, true);
});

// Часы клиента могут забежать на задержку сети вперёд: время вышло, а сервер ещё говорит «до».
test('если время вышло, а сервер ещё «до», карточка продолжает перезапрашивать', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { json: async () => ({ ok: true, error: null, data: {
      now: STARTS - 1, season: { title: 'Осень', state: 'before', startsAt: STARTS, day: 0, days: 92 }, me } }) };
  };
  await initSeason();
  assert.equal(calls, 1);
  for (let i = 0; i < 12; i++) { mock.timers.tick(1000); await Promise.resolve(); await Promise.resolve(); }
  await new Promise((r) => setImmediate(r));
  stopSeasonTimer();
  mock.timers.reset();
  assert.ok(calls >= 3, `запросов было ${calls}, ожидали не меньше 3`);
});

test('когда сервер сказал «идёт», перезапросы прекращаются', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const state = calls === 1 ? 'before' : 'active';
    return { json: async () => ({ ok: true, error: null, data: {
      now: STARTS - 1, season: { title: 'Осень', state, startsAt: STARTS, day: state === 'active' ? 1 : 0, days: 92 }, me } }) };
  };
  await initSeason();
  for (let i = 0; i < 12; i++) { mock.timers.tick(1000); await Promise.resolve(); await Promise.resolve(); }
  await new Promise((r) => setImmediate(r));
  stopSeasonTimer();
  mock.timers.reset();
  assert.equal(calls, 2);
});
