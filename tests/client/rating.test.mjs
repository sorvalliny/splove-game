import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------- поддельный документ ----------
const make = (id, extra = {}) => {
  const cls = new Set(extra.cls ?? []);
  return {
    id, hidden: !!extra.hidden, innerHTML: '', textContent: '', dataset: extra.dataset ?? {}, listeners: {},
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    addEventListener(t, f) { this.listeners[t] = f; },
    insertAdjacentHTML(_p, h) { this.innerHTML += h; },
    click() { this.listeners.click?.({ target: this }); },
  };
};
const ids = ['board', 'menu', 'panSeason', 'panWeek', 'panRecords', 'seasonMe', 'seasonQuests', 'seasonBoard',
  'seasonChamps', 'weekInfo', 'seasonWeek', 'seasonCard', 'brdBack', 'brdList', 'brdNote', 'weekLine', 'startWeek', 'boosterRow', 'rHead'];
const els = Object.fromEntries(ids.map((id) => [id, make(id)]));
els.board.classList.add('hide');
const tabs = ['season', 'week', 'records'].map((t) => make(`tab-${t}`, { dataset: { t } }));
globalThis.document = {
  getElementById: (id) => els[id] ?? null,
  querySelectorAll: (sel) => (sel === '#rTabs button' ? tabs : []),
};
globalThis.Telegram = { WebApp: { initData: 'x', ready() {}, expand() {} } };
globalThis.localStorage = { getItem: () => null, setItem() {} };

// ---------- сервер ----------
const calls = [];
const SEASON = {
  now: 1_791_000_000, season: { id: 'autumn-2026', title: 'Осень', state: 'active', startsAt: 1_790_802_000, day: 6, days: 92 },
  me: { total: 640, seasonPoints: 640, rank: 7 },
  quests: [{ id: 'gena', title: 'Подобрать Гену', goal: 1, progress: 1, done: true, points: 150 }],
  board: [{ name: 'Аня', points: 900, isMe: false }, { name: 'Виктор', points: 640, isMe: true }], champions: [],
};
const WEEK = {
  now: 1_791_000_000, weekKey: '2026-W41', seed: 1, level: 'normal', endsAt: 1_791_000_000 + 3600,
  board: [{ name: 'Боря', bank: 1200, isMe: false }], me: { bank: 800, rank: 2 }, boosters: { shield: 0, x2: 0, life: 0 },
};
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push([url, body]);
  const data = url.endsWith('/api/season') ? SEASON : url.endsWith('/api/week') ? WEEK
    : { level: body.level, kind: body.kind, board: [], me: null };
  return { json: async () => ({ ok: true, data, error: null }) };
};

const { initSeason } = await import('../../js/season.js');
const { initWeek, stopWeekTimer } = await import('../../js/week.js');
const { openRating, closeRating, showTab, initRating } = await import('../../js/rating.js');
await initSeason();
await initWeek();
stopWeekTimer();
initRating();

const visible = () => ['panSeason', 'panWeek', 'panRecords'].filter((p) => !els[p].hidden);
const onTab = () => tabs.filter((b) => b.classList.contains('on')).map((b) => b.dataset.t);

test('по умолчанию открывается «Сезон»: меню скрыто, видна только панель сезона', async () => {
  els.menu.classList.remove('hide');
  await openRating();
  assert.equal(els.board.classList.contains('hide'), false);
  assert.equal(els.menu.classList.contains('hide'), true);
  assert.deepEqual(visible(), ['panSeason']);
  assert.deepEqual(onTab(), ['season']);
});

test('панель сезона компактна: нет длинной сноски-объяснения', async () => {
  await openRating();
  const full = els.panSeason.innerHTML + els.seasonMe.innerHTML + els.seasonQuests.innerHTML + els.seasonBoard.innerHTML;
  assert.doesNotMatch(full, /Баллы дают задания недели/);
});

test('панель «Рекорды»: переключатель вида очки/время лежит в одном компактном заголовке, не отдельной вкладочной строкой', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const records = html.slice(html.indexOf('id="panRecords"'), html.indexOf('id="brdList"'));
  assert.match(records, /class="rHead"[\s\S]*id="brdKind"/, 'brdKind вложен в компактный заголовок rHead');
});

test('панель сезона: мои баллы и место, задания, таблица', async () => {
  await openRating();
  assert.match(els.seasonMe.innerHTML, /Твои баллы: <b>640<\/b> · место 7/);
  assert.match(els.seasonQuests.innerHTML, /Подобрать Гену/);
  assert.match(els.seasonBoard.innerHTML, /Аня[\s\S]*900/);
  assert.match(els.seasonBoard.innerHTML, /class="me"/);
});

test('вкладка «Неделя»: неделя, моё место и таблица недели', async () => {
  await openRating();
  showTab('week');
  assert.deepEqual(visible(), ['panWeek']);
  assert.deepEqual(onTab(), ['week']);
  assert.match(els.weekInfo.textContent, /Неделя W41/);
  assert.match(els.weekInfo.textContent, /твоё место 2/);
  assert.match(els.seasonWeek.innerHTML, /Боря/);
});

test('«Рекорды» запрашивают таблицу нужной сложности и вида', async () => {
  calls.length = 0;
  await openRating({ tab: 'records', level: 'hard', kind: 'time' });
  assert.deepEqual(visible(), ['panRecords']);
  const req = calls.find(([u]) => u.endsWith('/api/board'));
  assert.deepEqual(req[1], { level: 'hard', kind: 'time' });
});

test('нажатие на вкладку переключает панель', async () => {
  await openRating();
  tabs[2].click();
  assert.deepEqual(visible(), ['panRecords']);
  tabs[0].click();
  assert.deepEqual(visible(), ['panSeason']);
});

test('«Назад» возвращает в меню, если пришли из меню, и не возвращает с экрана итога', async () => {
  els.menu.classList.remove('hide');
  await openRating({ from: 'menu' });
  closeRating();
  assert.equal(els.board.classList.contains('hide'), true);
  assert.equal(els.menu.classList.contains('hide'), false);

  els.menu.classList.add('hide');
  await openRating({ tab: 'records', from: 'over' });
  closeRating();
  assert.equal(els.menu.classList.contains('hide'), true);
});

test('карточка сезона на главном открывает вкладку «Сезон»', async () => {
  els.board.classList.add('hide');
  els.seasonCard.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(els.board.classList.contains('hide'), false);
  assert.deepEqual(visible(), ['panSeason']);
});
