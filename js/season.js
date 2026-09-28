import { inTelegram } from './auth.js';
import { season as fetchSeason } from './api.js';
import { formatCountdown } from './season-format.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let data = null;
let offsetMs = 0;
let timer = null;
let loading = false;
let lastFetchAt = 0;

/** Часы клиента могут забежать вперёд сервера на задержку сети: пока сервер говорит «до», спрашиваем снова. */
const RETRY_MS = 5000;

const card = () => document.getElementById('seasonCard');
const nowMs = () => Date.now() + offsetMs;

const startDate = (s) => new Date(s.startsAt * 1000)
  .toLocaleDateString('ru', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });

function html(d) {
  const s = d.season;
  if (s.state === 'before') {
    return `
      <div class="sTitle"><span>${esc(s.title)} стартует через</span><b id="seasonTimer">${formatCountdown(s.startsAt * 1000 - nowMs())}</b></div>
      <small>Задания откроются ${esc(startDate(s))}</small>`;
  }
  if (s.state === 'ended') {
    return `<div class="sTitle"><span>Сезон закончился</span></div>`;
  }
  const pct = Math.min(100, Math.max(0, Math.round((Number(s.day) / Number(s.days)) * 100)));
  const mine = d.me.total > 0
    ? `Твои баллы: <b>${Number(d.me.total).toLocaleString('ru')}</b>${d.me.rank ? ` · место ${Number(d.me.rank)}` : ''}`
    : 'Баллов пока нет';
  return `
    <div class="sTitle"><span>${esc(s.title)} · день ${Number(s.day)} из ${Number(s.days)}</span></div>
    <div class="sBar"><i style="width:${pct}%"></i></div>
    <small>${mine}</small>`;
}

/** Для тестов и ухода с экрана: без этого интервал держит процесс живым. */
export function stopSeasonTimer() { stopTimer(); }

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** До старта таймер тикает по времени сервера; когда время вышло, а сервер ещё «до», перезапрашиваем. */
function tick() {
  const s = data?.season;
  const el = document.getElementById('seasonTimer');
  if (!s || s.state !== 'before' || !el) return stopTimer();

  const left = s.startsAt * 1000 - nowMs();
  el.textContent = formatCountdown(left);
  if (left <= 0 && !loading && Date.now() - lastFetchAt >= RETRY_MS) load();
}

function paint() {
  const el = card();
  if (!el) return;
  if (!data?.season) { el.hidden = true; stopTimer(); return; }
  el.innerHTML = html(data);
  el.hidden = false;
  if (data.season.state === 'before') {
    if (!timer) timer = setInterval(tick, 1000);
  } else {
    stopTimer();
  }
}

async function load() {
  loading = true;
  lastFetchAt = Date.now();
  try {
    const r = await fetchSeason();
    if (!r.ok) return;
    data = r.data;
    offsetMs = data.now * 1000 - Date.now();
    paint();
  } finally {
    loading = false;
  }
}

/** Баллы и место меняются после заплыва: игра вызывает это, чтобы карточка не устаревала. */
export const refreshSeason = () => (inTelegram() ? load() : Promise.resolve());
globalThis.refreshSeason = refreshSeason;

export async function initSeason() {
  if (!inTelegram()) return;
  await load();
}
