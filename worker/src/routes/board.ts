import type { Env } from '../index';
import { ok, fail } from '../http/envelope';
import { authorize } from '../http/auth';
import { LEVELS, type Level } from '../game/plausible';
import { getBoard, getBests, getRank } from '../db/runs';

const BOARD_SIZE = 20;

export async function handleBoard(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => null)) as { level?: unknown } | null;
  const level = body?.level as Level;
  if (!LEVELS.includes(level)) return fail('bad_request', 'Неизвестная сложность', 400);

  const tgId = auth.player.tg_id;
  const [board, bests] = await Promise.all([
    getBoard(env.DB, level, BOARD_SIZE),
    getBests(env.DB, tgId),
  ]);

  const mine = bests[level];
  const me = mine
    ? {
        bank: mine.bank,
        meters: mine.meters,
        rank: await getRank(env.DB, level, mine.bank, mine.meters, mine.updated_at),
      }
    : null;

  return ok({ level, board, me });
}
