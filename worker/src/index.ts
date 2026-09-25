import { ok, fail, withCors } from './http/envelope';
import { handleSession } from './routes/session';

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  CHAT_ID: string;
  ALLOWED_ORIGIN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = (res: Response) => withCors(res, env.ALLOWED_ORIGIN);

    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (url.pathname === '/api/health') return cors(ok({ up: true }));
    if (url.pathname === '/api/session' && req.method === 'POST') {
      return cors(await handleSession(req, env));
    }
    return cors(fail('not_found', 'Нет такой ручки', 404));
  },
};
