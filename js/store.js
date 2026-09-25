/**
 * Локальное хранилище на случай реки без связи.
 * Любое обращение к localStorage обёрнуто: в приватном окне он бросает исключение,
 * а игра из-за этого падать не должна.
 */
const QUEUE = 'splove.queue';
const CACHE = 'splove.board';

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* переживём */
  }
};

export const queued = () => read(QUEUE, []);

export function enqueue(run) {
  const all = [...queued(), run].slice(-50);
  write(QUEUE, all);
}

export function dropFromQueue(startedAt) {
  write(QUEUE, queued().filter((r) => r.startedAt !== startedAt));
}

export const cachedBoard = (level) => read(`${CACHE}.${level}`, null);

export const cacheBoard = (level, board) =>
  write(`${CACHE}.${level}`, { at: Date.now(), board });
