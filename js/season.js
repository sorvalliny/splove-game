import { inTelegram } from './auth.js';
import { season as fetchSeason } from './api.js';
import { formatCountdown } from './season-format.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let data = null;
let offsetMs = 0;
let timer = null;
let refetched = false;

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
  const pct = Math.min(100, Math.round((s.day / s.days) * 100));
  const mine = d.me.total > 0
    ? `Твои баллы: <b>${d.me.total.toLocaleString('ru')}</b>${d.me.rank ? ` · место ${d.me.rank}` : ''}`
    : 'Баллов пока нет';
  return `
    <div class="sTitle"><span>${esc(s.title)} · день ${s.day} из ${s.days}</span></div>
    <div class="sBar"><i style="width:${pct}%"></i></div>
    <small>${mine}</small>`;
}

/** Для тестов и ухода с экрана: без этого интервал держит процесс живым. */
export function stopSeasonTimer() { stopTimer(); }

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** До старта таймер тикает по времени сервера; когда время вышло, один раз перезапрашиваем сезон. */
function tick() {
  const s = data?.season;
  const el = document.getElementById('seasonTimer');
  if (!s || s.state !== 'before' || !el) return stopTimer();

  const left = s.startsAt * 1000 - nowMs();
  el.textContent = formatCountdown(left);
  if (left <= 0 && !refetched) {
    refetched = true;
    stopTimer();
    load();
  }
}

function paint() {
  const el = card();
  if (!el) return;
  if (!data?.season) { el.hidden = true; return; }
  el.innerHTML = html(data);
  el.hidden = false;
  stopTimer();
  if (data.season.state === 'before') timer = setInterval(tick, 1000);
}

async function load() {
  const r = await fetchSeason();
  if (!r.ok) return;
  data = r.data;
  offsetMs = data.now * 1000 - Date.now();
  paint();
}

export async function initSeason() {
  if (!inTelegram()) return;
  await load();
}
