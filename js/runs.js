import { inTelegram } from './auth.js';
import { sendRun, session } from './api.js';
import { enqueue, dropFromQueue, queued, cacheBoard, cachedBoard } from './store.js';
import { renderBoard, showBoard, hideBoard } from './board.js';

const REJECT_TEXT = {
  too_fast: 'Не засчитано: слишком быстро для байдарки',
  too_rich: 'Не засчитано: столько очков на дистанции не собрать',
  too_short: 'Не засчитано: слишком короткий заплыв',
  too_often: 'Не засчитано: заплыв пересекается с предыдущим',
  daily_limit: 'Не засчитано: на сегодня хватит',
  bad_clock: 'Не засчитано: часы телефона врут',
  bad_numbers: 'Не засчитано: странные числа',
  bad_level: 'Не засчитано: неизвестный уровень',
};

let me = null;
let lastLevel = 'easy';

const say = (text) => { document.getElementById('rT').textContent = text; };

function resultText(d, run) {
  if (d.rejected) return REJECT_TEXT[d.rejected] ?? 'Результат не засчитан';
  if (d.isRecord) return `Личный рекорд. ${d.rank}-е место на уровне «${run.levelName}»`;
  const miss = d.delta === null ? null : -d.delta;
  const tail = miss && miss > 0 ? `, не хватило ${miss}` : '';
  return `Лучший результат ${d.best?.bank ?? 0}${tail}. ${d.rank}-е место`;
}

/** Отправляет отложенные заплывы. Порядок важен: сервер проверяет пересечение по времени. */
async function flushQueue() {
  for (const run of [...queued()].sort((a, b) => a.startedAt - b.startedAt)) {
    const r = await sendRun(run);
    if (r.ok) dropFromQueue(run.startedAt);
    else if (r.error.code === 'offline') return;
    else dropFromQueue(run.startedAt);
  }
}

async function openBoard(level) {
  const cache = cachedBoard(level);
  if (cache) renderBoard(level, cache.board, me, cache.at);
  showBoard();
}

export function wireRuns(profile) {
  me = profile?.id ?? null;

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
    cacheBoard(run.level, r.data.board);
    renderBoard(run.level, r.data.board, me);
  };

  document.getElementById('toBoard')?.addEventListener('click', () => openBoard(lastLevel));
  document.getElementById('brdBack')?.addEventListener('click', hideBoard);
  document.querySelectorAll('#brdTabs button').forEach((b) =>
    b.addEventListener('click', () => openBoard(b.dataset.l)));

  if (inTelegram()) flushQueue();
}

export { session };
