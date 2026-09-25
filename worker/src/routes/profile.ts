import type { Env } from '../index';
import { ok, fail } from '../http/envelope';
import { authorize } from '../http/auth';

const TRACKS = new Set(['chill', 'party', 'bard', 'off']);

export async function handleProfile(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => null)) as { track?: unknown } | null;
  const track = body?.track;
  if (typeof track !== 'string' || !TRACKS.has(track)) {
    return fail('bad_request', 'Такого трека нет', 400);
  }

  await env.DB.prepare('UPDATE players SET track = ? WHERE tg_id = ?')
    .bind(track, auth.player.tg_id).run();

  return ok({});
}
