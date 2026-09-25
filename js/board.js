import { cachedBoard, cacheBoard } from './store.js';
import { board as fetchBoard } from './api.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const row = (r, place, meId) => `
  <li class="${r.tg_id === meId ? 'me' : ''}">
    <b>${place}</b>
    <span class="nm">${esc(r.name)}</span>
    <span class="pt">${r.bank.toLocaleString('ru')}</span>
  </li>`;

const meRow = (me) => `
  <li class="me apart">
    <b>${me.rank}</b>
    <span class="nm">Ты</span>
    <span class="pt">${me.bank.toLocaleString('ru')}</span>
  </li>`;

let current = 'easy';
let meId = null;

export const setMe = (id) => { meId = id; };
export const currentLevel = () => current;

function paint(level, data, staleAt = null) {
  const list = document.getElementById('brdList');
  const note = document.getElementById('brdNote');
  const { board = [], me = null } = data ?? {};

  if (board.length === 0) {
    list.innerHTML = '<li class="empty">Здесь пока никто не плавал</li>';
  } else {
    list.innerHTML = board.map((r, i) => row(r, i + 1, meId)).join('');
    const inTop = board.some((r) => r.tg_id === meId);
    if (!inTop && me) list.insertAdjacentHTML('beforeend', `<li class="gap">…</li>${meRow(me)}`);
  }

  note.textContent = staleAt
    ? `Связи нет. Данные от ${new Date(staleAt).toLocaleString('ru')}`
    : '';

  document.querySelectorAll('#brdTabs button')
    .forEach((b) => b.classList.toggle('on', b.dataset.l === level));
}

/** Сначала показываем кэш, чтобы экран не моргал пустотой, потом обновляем живыми данными. */
export async function openBoard(level) {
  current = level;
  document.getElementById('board').classList.remove('hide');

  const cache = cachedBoard(level);
  if (cache) paint(level, cache.data, null);
  else paint(level, null);

  const r = await fetchBoard(level);
  if (current !== level) return;

  if (r.ok) {
    cacheBoard(level, r.data);
    paint(level, r.data);
  } else if (r.error.code === 'offline') {
    paint(level, cache?.data ?? null, cache?.at ?? Date.now());
  } else {
    document.getElementById('brdNote').textContent = r.error.message;
  }
}

export const hideBoard = () => document.getElementById('board').classList.add('hide');

export { paint as renderBoard };
