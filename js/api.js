import { initData } from './auth.js';

const BASE = 'https://splove-api.sorvalliny.workers.dev';

const offline = (code, message) => ({ ok: false, data: null, error: { code, message } });

/** Все ответы приходят одним конвертом {ok, data, error}; сетевой сбой сводится к нему же. */
async function call(path, body) {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-init-data': initData(),
      },
      body: JSON.stringify(body ?? {}),
    });
    const envelope = await res.json().catch(() => null);
    return envelope ?? offline('bad_response', 'Сервер ответил непонятным');
  } catch {
    return offline('offline', 'Нет связи');
  }
}

export const session = () => call('/api/session');
export const sendRun = (run) => call('/api/runs', run);
export const setTrack = (track) => call('/api/profile', { track });
