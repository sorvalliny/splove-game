import { cachedBoard, cacheBoard } from './store.js';

const LEVEL_NAMES = { easy: 'Прогулка', normal: 'Сплав', hard: 'Шторм' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const row = (r, place, me) => `
  <li class="${r.tg_id === me ? 'me' : ''}">
    <b>${place}</b>
    <span class="nm">${esc(r.name)}</span>
    <span class="pt">${r.bank.toLocaleString('ru')}</span>
  </li>`;

/** Рисует таблицу уровня. Если данных нет — честно говорит, откуда взялись старые. */
export function renderBoard(level, board, meId, fromCache = null) {
  const list = document.getElementById('brdList');
  const note = document.getElementById('brdNote');

  if (!board || board.length === 0) {
    list.innerHTML = '<li class="empty">Здесь пока никто не плавал</li>';
  } else {
    list.innerHTML = board.map((r, i) => row(r, i + 1, meId)).join('');
    const inTop = board.some((r) => r.tg_id === meId);
    if (!inTop) list.insertAdjacentHTML('beforeend', '<li class="gap">…</li>');
  }

  note.textContent = fromCache
    ? `Связи нет. Данные от ${new Date(fromCache).toLocaleString('ru')}`
    : '';

  document.querySelectorAll('#brdTabs button').forEach((b) =>
    b.classList.toggle('on', b.dataset.l === level));
}

export function showBoard() {
  document.getElementById('board').classList.remove('hide');
}

export function hideBoard() {
  document.getElementById('board').classList.add('hide');
}

export { LEVEL_NAMES, cachedBoard, cacheBoard };
