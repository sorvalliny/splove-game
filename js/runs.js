import { inTelegram } from './auth.js';
import { sendRun } from './api.js';
import { enqueue, dropFromQueue, queued, cacheBoard } from './store.js';
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
let cameFrom = 'menu';

const say = (text) => { document.getElementById('rT').textContent = text; };

function resultText(d, run) {
  if (d.rejected) return REJECT_TEXT[d.rejected] ?? 'Результат не засчитан';
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

function show(level, from) {
  cameFrom = from;
  openBoard(level);
}

export function wireRuns(profile) {
  setMe(profile?.id ?? null);

  globalThis.onRunEnd = async (run) => {
    lastLevel = run.level;
    if (!inTelegram()) { say('Рейтинг доступен, если открыть игру через бота'); return; }

    say('Отправляем результат…');
    const r = await sendRun(run);

    if (!r.ok) {
      if (r.error.code === 'offline') { enqueue(run); say('Связи нет. Результат уйдёт, как появится'); }
      else say(r.error.message);
      return;
    }

    say(resultText(r.data, run));
    if (r.data.best) globalThis.updateBest?.(run.level, r.data.best);
  };

  document.getElementById('toBoard')?.addEventListener('click', () => show(lastLevel, 'over'));
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

  if (inTelegram()) flushQueue();
}

export { currentLevel, cacheBoard };
