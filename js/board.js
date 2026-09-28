import { cachedBoard, cacheBoard } from './store.js';
import { board as fetchBoard } from './api.js';
import { formatTime } from './season-format.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Значение справа: очки или время финиша. */
const value = (kind, r) => (kind === 'time'
  ? formatTime(r.time_ms)
  : Number(r.bank).toLocaleString('ru'));

export const rowHtml = (kind, r, place, meId) => `
  <li${r.tg_id === meId ? ' class="me"' : ''}>
    <b>${Number(place)}</b>
    <span class="nm">${esc(r.name)}</span>
    <span class="pt">${value(kind, r)}</span>
  </li>`;

export const meRowHtml = (kind, me) => `
  <li class="me apart">
    <b>${Number(me.rank)}</b>
    <span class="nm">Ты</span>
    <span class="pt">${kind === 'time' ? formatTime(me.timeMs) : Number(me.bank).toLocaleString('ru')}</span>
  </li>`;

let current = 'easy';
let currentKind = 'points';
let meId = null;

export const setMe = (id) => { meId = id; };
export const currentLevel = () => current;

const EMPTY = { points: 'Здесь пока никто не плавал', time: 'Пока никто не финишировал' };

/** Ключ кэша: очки хранятся под прежним ключом, время отдельно. */
const cacheKey = (level, kind) => (kind === 'time' ? `time.${level}` : level);

function paint(level, kind, data, staleAt = null) {
  const list = document.getElementById('brdList');
  const note = document.getElementById('brdNote');
  const { board = [], me = null } = data ?? {};

  if (board.length === 0) {
    list.innerHTML = `<li class="empty">${EMPTY[kind]}</li>`;
  } else {
    list.innerHTML = board.map((r, i) => rowHtml(kind, r, i + 1, meId)).join('');
    const inTop = board.some((r) => r.tg_id === meId);
    if (!inTop && me) list.insertAdjacentHTML('beforeend', `<li class="gap">…</li>${meRowHtml(kind, me)}`);
  }

  note.textContent = staleAt
    ? `Связи нет. Данные от ${new Date(staleAt).toLocaleString('ru')}`
    : '';

  document.querySelectorAll('#brdTabs button')
    .forEach((b) => b.classList.toggle('on', b.dataset.l === level));
  document.querySelectorAll('#brdKind button')
    .forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
}

/** Сначала показываем кэш, чтобы экран не моргал пустотой, потом обновляем живыми данными. */
export async function openBoard(level, kind = currentKind) {
  current = level;
  currentKind = kind;
  document.getElementById('board').classList.remove('hide');

  const key = cacheKey(level, kind);
  const cache = cachedBoard(key);
  if (cache) paint(level, kind, cache.data, null);
  else paint(level, kind, null);

  const r = await fetchBoard(level, kind);
  if (current !== level || currentKind !== kind) return;

  if (r.ok) {
    cacheBoard(key, r.data);
    paint(level, kind, r.data);
  } else if (r.error.code === 'offline') {
    paint(level, kind, cache?.data ?? null, cache?.at ?? Date.now());
  } else {
    document.getElementById('brdNote').textContent = r.error.message;
  }
}

export const hideBoard = () => document.getElementById('board').classList.add('hide');

export { paint as renderBoard };
