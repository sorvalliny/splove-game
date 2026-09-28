import { ok, fail, withCors } from './http/envelope';
import { handleSession } from './routes/session';
import { handleRuns } from './routes/runs';
import { handleProfile } from './routes/profile';
import { handleBoard } from './routes/board';
import { handleSeason } from './routes/season';
import { handleWeek, handleBoosterUse } from './routes/week';
import { closeWeek } from './season/weekly';
import { handleWebhook } from './routes/webhook';

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  CHAT_ID: string;
  ALLOWED_ORIGIN: string;
  WEBHOOK_SECRET: string;
  GAME_URL: string;
  BOT_NAME: string;
  INVITE_CODE: string;
  ADMIN_IDS: string;
  CHAT_SIZE: string;
  WEEKLY_POST?: string;
}

type Handler = (req: Request, env: Env) => Promise<Response>;

const ROUTES: Record<string, Handler> = {
  '/api/session': handleSession,
  '/api/runs': handleRuns,
  '/api/profile': handleProfile,
  '/api/board': handleBoard,
  '/api/season': handleSeason,
  '/api/week': handleWeek,
  '/api/booster/use': handleBoosterUse,
};

export default {
  /** Ночь на понедельник: бонусы мест за закончившуюся неделю и, если разрешено, итог в чат. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await closeWeek(env, Math.floor(Date.now() / 1000));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = (res: Response) => withCors(res, env.ALLOWED_ORIGIN);

    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (url.pathname === '/api/health') return cors(ok({ up: true }));
    // Вебхук Telegram живёт вне конверта и CORS: это не браузер, а сервер Telegram.
    if (url.pathname === '/tg/webhook' && req.method === 'POST') return handleWebhook(req, env);

    const handler = ROUTES[url.pathname];
    if (handler && req.method === 'POST') return cors(await handler(req, env));

    return cors(fail('not_found', 'Нет такой ручки', 404));
  },
};
