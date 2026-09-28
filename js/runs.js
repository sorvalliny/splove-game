import { inTelegram } from './auth.js';
import { sendRun } from './api.js';
import { enqueue, dropFromQueue, queued, cacheBoard } from './store.js';
import { formatTime } from './season-format.js';
import { openBoard, hideBoard, setMe, currentLevel } from './board.js';

const REJECT_TEXT = {
  too_fast: 'Не засчитано: слишком быстро для байдарки',
  too_rich: 'Не засчитано: столько очков на дистанции не собрать',
  too_short: 'Не засчитано: слишком короткий заплыв',
  too_often: 'Не засчитано: заплыв пересекается с предыдущим',
  daily_limit: 'Не засчитано: на сегодня хватит',
  bad_clock: 'Не засчитано: часы телефона врут',
  bad_numbers: 'Не засчитано: странные числа',
  bad_level: 'Не засчитано: неизвестная сложность',
};

let lastLevel = 'easy';
let lastKind = 'points';
let cameFrom = 'menu';

const say = (text) => { document.getElementById('rT').textContent = text; };

const BOOSTER_NAMES = { shield: 'Щит', x2: 'Удвоение', life: 'Запасное возвращение' };

function weekText(d, run) {
  if (d.weekly?.stale) return 'Заплыв прошлой недели записан, но в таблицу недели не попал';
  const parts = [d.isRecord ? `Рекорд недели ${run.bank}` : `Твой лучший за неделю ${d.best?.bank ?? 0}`];
  if (d.rank) parts.push(`${d.rank}-е место`);
  if (d.weekly?.points) parts.push(`+${d.weekly.points} баллов`);
  if (d.weekly?.booster) parts.push(`получен бустер: ${BOOSTER_NAMES[d.weekly.booster]}`);
  return parts.join('. ');
}

function finishText(d) {
  const f = d.finish;
  const record = f.isRecord ? ', личный рекорд времени' : '';
  const place = f.rank ? `, ${f.rank}-е место по времени` : '';
  return `Финиш! ${formatTime(f.timeMs)}${record}${place}`;
}

export function resultText(d, run) {
  if (d.rejected) return REJECT_TEXT[d.rejected] ?? 'Результат не засчитан';
  if (run.mode === 'week' && d.weekly) return weekText(d, run);
  if (run.finished && d.finish) return `${finishText(d)}. ${pointsText(d, run)}`;
  return pointsText(d, run);
}

function pointsText(d, run) {
  if (d.isRecord) return `Личный рекорд. ${d.rank}-е место на «${run.levelName}»`;
  const miss = d.delta === null ? null : -d.delta;
  const tail = miss && miss > 0 ? `, не хватило ${miss}` : '';
  return `Твой рекорд ${d.best?.bank ?? 0}${tail}. ${d.rank}-е место`;
}

/** Отложенные заплывы уходят по возрастанию времени: сервер проверяет пересечение. */
async function flushQueue() {
  for (const run of [...queued()].sort((a, b) => a.startedAt - b.startedAt)) {
    const r = await sendRun(run);
    if (!r.ok && r.error.code === 'offline') return;
    dropFromQueue(run.startedAt);
  }
}

function show(level, from, kind) {
  cameFrom = from;
  openBoard(level, kind);
}

export function wireRuns(profile) {
  setMe(profile?.id ?? null);

  globalThis.onRunEnd = async (run) => {
    lastLevel = run.level;
    lastKind = run.finished ? 'time' : 'points'; // после финиша «Рейтинг» открывается на времени
    if (!inTelegram()) { say('Рейтинг доступен, если открыть игру через бота'); return; }

    say('Отправляем результат…');
    const r = await sendRun(run);

    if (!r.ok) {
      if (r.error.code === 'offline') { enqueue(run); say('Связи нет. Результат уйдёт, как появится'); }
      else say(r.error.message);
      return;
    }

    const done = (r.data.newQuests ?? []).map((q) => `${q.title} +${q.points}`);
    say(done.length ? `${resultText(r.data, run)}. Задание выполнено: ${done.join(', ')}` : resultText(r.data, run));
    if (r.data.best && run.mode !== 'week') globalThis.updateBest?.(run.level, r.data.best);
    globalThis.refreshSeason?.();
    globalThis.refreshWeek?.();
  };

  document.getElementById('toBoard')?.addEventListener('click', () => show(lastLevel, 'over', lastKind));
  document.getElementById('menuBoard')?.addEventListener('click', () => {
    globalThis.hideMenu?.();
    show(globalThis.currentLevel?.() ?? 'easy', 'menu');
  });

  document.getElementById('brdBack')?.addEventListener('click', () => {
    hideBoard();
    if (cameFrom === 'menu') document.getElementById('menu').classList.remove('hide');
  });

  document.querySelectorAll('#brdTabs button').forEach((b) =>
    b.addEventListener('click', () => openBoard(b.dataset.l)));
  document.querySelectorAll('#brdKind button').forEach((b) =>
    b.addEventListener('click', () => openBoard(currentLevel(), b.dataset.k)));

  if (inTelegram()) flushQueue();
}

export { currentLevel, cacheBoard };
