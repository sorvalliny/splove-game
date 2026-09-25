import type { Env } from '../index';
import { ok } from '../http/envelope';
import { authorize } from '../http/auth';
import { getBests } from '../db/runs';
import { getStats } from '../db/stats';
import type { Player } from '../db/players';

const publicProfile = (p: Player) => ({
  id: p.tg_id,
  name: p.name,
  photoUrl: p.photo_url,
  track: p.track,
  isMember: true,
});

export async function handleSession(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const [bests, stats] = await Promise.all([
    getBests(env.DB, auth.player.tg_id),
    getStats(env.DB, auth.player.tg_id),
  ]);

  return ok({ player: publicProfile(auth.player), bests, stats });
}
