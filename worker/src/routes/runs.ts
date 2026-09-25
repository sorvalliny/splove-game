import type { Env } from '../index';
import { ok, fail } from '../http/envelope';
import { authorize } from '../http/auth';
import { checkRun, LEVELS, type Level, type Rejection } from '../game/plausible';
import {
  insertRun, findRunByStart, overlapsPrevious, countRunsSince,
  applyBest, getBests, getBoard, getRank, type Best,
} from '../db/runs';

const BOARD_SIZE = 20;
const DAILY_LIMIT = 200;
const DAY_MS = 24 * 3600 * 1000;

interface Body {
  level: Level;
  bank: number;
  onboard: number;
  meters: number;
  durationMs: number;
  oarsLost: number;
  startedAt: number;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseBody(raw: unknown): Body | null {
  const b = raw as Partial<Body> | null;
  if (!b || typeof b !== 'object') return null;
  if (!LEVELS.includes(b.level as Level)) return null;
  const nums = [b.bank, b.onboard, b.meters, b.durationMs, b.oarsLost, b.startedAt];
  if (!nums.every(isCount)) return null;
  return b as Body;
}

/** Ответ строится одинаково и для засчитанного, и для отклонённого заплыва. */
async function outcome(
  env: Env, tgId: number, level: Level, bank: number,
  rejected: Rejection | null, isRecord: boolean,
) {
  const bests = await getBests(env.DB, tgId);
  const best: Best | null = bests[level] ?? null;
  const rank = best ? await getRank(env.DB, level, best.bank, best.meters, best.updated_at) : null;
  return {
    rejected,
    isRecord,
    best: best ? { bank: best.bank, meters: best.meters } : null,
    delta: best ? bank - best.bank : null,
    rank,
    board: await getBoard(env.DB, level, BOARD_SIZE),
  };
}

export async function handleRuns(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const body = parseBody(await req.json().catch(() => null));
  if (!body) return fail('bad_request', 'Заплыв пришёл в непонятном виде', 400);

  const tgId = auth.player.tg_id;
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  // Повтор из офлайн-очереди: отдаём прежний исход, а не ошибку.
  const known = await findRunByStart(env.DB, tgId, body.startedAt);
  if (known) {
    return ok(await outcome(env, tgId, known.level, known.bank, known.rejected as Rejection | null, false));
  }

  let rejected: Rejection | 'too_often' | 'daily_limit' | null = checkRun({ ...body }, nowMs);
  if (!rejected && (await overlapsPrevious(env.DB, tgId, body.startedAt))) rejected = 'too_often';
  if (!rejected && (await countRunsSince(env.DB, tgId, nowSec - DAY_MS / 1000)) >= DAILY_LIMIT) {
    rejected = 'daily_limit';
  }

  const runId = await insertRun(env.DB, {
    tgId, level: body.level, bank: body.bank, onboard: body.onboard, meters: body.meters,
    durationMs: body.durationMs, oarsLost: body.oarsLost, startedAt: body.startedAt,
    rejected,
  }, nowSec);

  const isRecord = rejected
    ? false
    : await applyBest(env.DB, tgId, body.level, body.bank, body.meters, runId, nowSec);

  return ok(await outcome(env, tgId, body.level, body.bank, rejected as Rejection | null, isRecord));
}
