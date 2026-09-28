import { inTelegram } from './auth.js';
import { week as fetchWeek, useBooster } from './api.js';
import { formatCountdown } from './season-format.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const BOOSTER_NAMES = { shield: 'Щит', x2: 'Удвоение', life: 'Возвращение' };
const KINDS = Object.keys(BOOSTER_NAMES);
const RETRY_MS = 5000;

let data = null;
let offsetMs = 0;
let armed = null;
let timer = null;
let loading = false;
let lastFetchAt = 0;

const $ = (id) => document.getElementById(id);
const nowMs = () => Date.now() + offsetMs;

export const weekData = () => data;

/** Игра берёт отсюда зерно и ключ недели при старте заплыва недели. */
globalThis.weekInfo = () => (data ? { seed: data.seed, key: data.weekKey } : null);

const lineText = () =>
  `Неделя ${esc(data.weekKey.slice(5))} · до конца ${formatCountdown(data.endsAt * 1000 - nowMs())}`;

function paint() {
  const btn = $('startWeek');
  const line = $('weekLine');
  const row = $('boosterRow');
  if (!btn || !line || !row) return;
  if (!data) { btn.hidden = true; line.hidden = true; row.hidden = true; return; }

  btn.hidden = false;
  line.hidden = false;
  line.textContent = lineText();

  const chips = KINDS.filter((k) => data.boosters[k] > 0).map((k) =>
    `<button class="chip${armed === k ? ' on' : ''}" data-k="${k}">${BOOSTER_NAMES[k]} ×${Number(data.boosters[k])}</button>`);
  row.innerHTML = chips.join('');
  row.hidden = chips.length === 0;
}

export function stopWeekTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function load() {
  loading = true;
  lastFetchAt = Date.now();
  try {
    const r = await fetchWeek();
    if (!r.ok) return;
    data = r.data;
    offsetMs = (data.now ?? Math.floor(Date.now() / 1000)) * 1000 - Date.now();
    paint();
  } finally {
    loading = false;
  }
}

/** Конец недели: пока сервер не переключил неделю, перезапрашиваем не чаще раза в 5 секунд. */
function tick() {
  const line = $('weekLine');
  if (!data || !line) return;
  const left = data.endsAt * 1000 - nowMs();
  line.textContent = lineText();
  if (left <= 0 && !loading && Date.now() - lastFetchAt >= RETRY_MS) load();
}

/** Бустеры и новая неделя меняются после заплыва: игра вызывает это, чтобы плашки не устаревали. */
export const refreshWeek = () => (inTelegram() ? load() : Promise.resolve());
globalThis.refreshWeek = refreshWeek;

/**
 * Списывает заряженный бустер на сервере при старте. Возвращает вид бустера или null:
 * отказ сервера означает игру без бустера, а не ошибку.
 */
export async function consumeBooster() {
  if (!armed) return null;
  const kind = armed;
  armed = null;
  const r = await useBooster(kind);
  if (r.ok && data) data = { ...data, boosters: { ...data.boosters, [kind]: Math.max(0, data.boosters[kind] - 1) } };
  paint();
  return r.ok ? kind : null;
}
globalThis.consumeBooster = consumeBooster;

export async function initWeek() {
  if (!inTelegram()) return;
  armed = null;
  $('boosterRow')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-k]');
    if (!b) return;
    armed = armed === b.dataset.k ? null : b.dataset.k;
    paint();
  });
  await load();
  stopWeekTimer();
  if (data) timer = setInterval(tick, 1000);
}
