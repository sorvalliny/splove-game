import type { Env } from '../index';
import { ok, fail } from '../http/envelope';
import { authorize } from '../http/auth';
import { LEVELS, type Level } from '../game/plausible';
import { getBoard, getBests, getRank, getTimeBoard, getBestTimes, getTimeRank } from '../db/runs';

const BOARD_SIZE = 20;

export async function handleBoard(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => null)) as { level?: unknown; kind?: unknown } | null;
  const level = body?.level as Level;
  if (!LEVELS.includes(level)) return fail('bad_request', 'Неизвестная сложность', 400);
  const kind = body?.kind ?? 'points';
  if (kind !== 'points' && kind !== 'time') return fail('bad_request', 'Неизвестный вид таблицы', 400);

  const tgId = auth.player.tg_id;
  if (kind === 'time') {
    const [rows, times] = await Promise.all([getTimeBoard(env.DB, level, BOARD_SIZE), getBestTimes(env.DB, tgId)]);
    const mine = times[level];
    const me = mine
      ? { timeMs: mine.time_ms, rank: await getTimeRank(env.DB, level, mine.time_ms, mine.updated_at) }
      : null;
    return ok({ level, kind, board: rows, me });
  }

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

  return ok({ level, kind, board, me });
}
