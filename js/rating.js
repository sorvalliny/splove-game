import { openBoard, currentLevel } from './board.js';
import { seasonData, refreshSeason } from './season.js';
import { weekData, refreshWeek } from './week.js';
import { questsHtml, boardHtml, champsHtml, weekBoardHtml } from './season-render.js';
import { formatCountdown } from './season-format.js';

/**
 * Единый экран «Рейтинг»: «Сезон» (баллы и призы) первым, «Неделя» и «Рекорды» рядом.
 * Главная таблица одна — сезонная: по ней выдают призы.
 */
const PANELS = { season: 'panSeason', week: 'panWeek', records: 'panRecords' };
const $ = (id) => document.getElementById(id);

let tab = 'season';
let from = 'menu';
let recordsLevel = 'easy';
let recordsKind = 'points';

const ru = (n) => Number(n).toLocaleString('ru');

function paintSeason() {
  const d = seasonData();
  if (!d?.season) {
    $('seasonMe').innerHTML = 'Сезон виден, если открыть игру через бота';
    $('seasonQuests').innerHTML = '';
    $('seasonBoard').innerHTML = '';
    $('seasonChamps').innerHTML = '';
    return;
  }
  const s = d.season;
  const me = s.state === 'before'
    ? `${s.title} стартует через ${formatCountdown(s.startsAt * 1000 - Date.now())}`
    : d.me.total > 0
      ? `Твои баллы: <b>${ru(d.me.total)}</b>${d.me.rank ? ` · место ${Number(d.me.rank)}` : ''}`
      : 'Баллов пока нет';
  $('seasonMe').innerHTML = me;
  $('seasonQuests').innerHTML = questsHtml(d.quests);
  $('seasonBoard').innerHTML = boardHtml(d.board);
  $('seasonChamps').innerHTML = champsHtml(d.champions);
}

function paintWeek() {
  const w = weekData();
  const meta = $('weekMeta');
  if (!w) {
    $('weekInfo').textContent = 'Заплыв недели виден, если открыть игру через бота';
    if (meta) meta.textContent = '';
    $('seasonWeek').innerHTML = '';
    return;
  }
  $('weekInfo').textContent = w.me
    ? `Твоё место ${Number(w.me.rank)} · ${ru(w.me.bank)}`
    : 'Ты ещё не плавал на этой неделе';
  if (meta) meta.textContent = `Неделя ${w.weekKey.slice(5)} · до конца ${formatCountdown(w.endsAt * 1000 - Date.now())}`;
  $('seasonWeek').innerHTML = weekBoardHtml(w.board);
}

export function showTab(next, opts = {}) {
  tab = PANELS[next] ? next : 'season';
  for (const [name, id] of Object.entries(PANELS)) {
    const el = $(id);
    if (el) el.hidden = name !== tab;
  }
  document.querySelectorAll('#rTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));

  if (tab === 'season') paintSeason();
  else if (tab === 'week') paintWeek();
  else {
    recordsLevel = opts.level ?? recordsLevel;
    recordsKind = opts.kind ?? recordsKind;
    return openBoard(recordsLevel, recordsKind);
  }
  return undefined;
}

/** Открывает рейтинг сразу на кэше, потом подтягивает свежие сезон и неделю. */
export async function openRating({ tab: next = 'season', level, kind, from: f = 'menu' } = {}) {
  from = f;
  $('menu')?.classList.add('hide');
  $('board')?.classList.remove('hide');
  const wanted = next;
  await showTab(wanted, { level: level ?? currentLevel(), kind });
  if (wanted === 'records') return;
  try {
    await Promise.all([refreshSeason(), refreshWeek()]);
  } catch {
    /* остаёмся на прежних данных */
  }
  if (tab === wanted) showTab(wanted);
}

export function closeRating() {
  $('board')?.classList.add('hide');
  if (from === 'menu') $('menu')?.classList.remove('hide');
}

export function initRating() {
  document.querySelectorAll('#rTabs button').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.t)));
  $('seasonCard')?.addEventListener('click', () => openRating({ tab: 'season', from: 'menu' }));
  $('brdBack')?.addEventListener('click', closeRating);
  globalThis.openRating = openRating;
}
