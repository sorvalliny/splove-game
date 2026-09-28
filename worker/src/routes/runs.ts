import type { Env } from '../index';
import { ok, fail } from '../http/envelope';
import { authorize } from '../http/auth';
import { checkRun, LEVELS, type Level, type Rejection } from '../game/plausible';
import { sanitizeStats } from '../game/stats';
import { acceptFinish } from '../game/finish';
import { awardSkill, type SkillAward } from '../season/skill';
import { awardQuests, type Quest } from '../season/quests';
import { awardWeekPlay, type WeekPlay } from '../season/weekly';
import { isoWeekKey } from '../season/time';
import { weekBoard, myWeek } from '../db/week';
import {
  insertRun, findRunByStart, overlapsPrevious, countRunsSince,
  applyBest, getBests, getBoard, getRank, applyBestTime, getBestTimes, getTimeRank, type Best,
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
  stats?: unknown;
  mode?: unknown;
  week?: unknown;
  finished?: unknown;
  timeMs?: unknown;
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
  rejected: Rejection | null, isRecord: boolean, newQuests: Quest[] = [],
  finish: { timeMs: number; isRecord: boolean } | null = null,
  skill: SkillAward[] = [],
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
    newQuests: newQuests.map(({ id, title, points }) => ({ id, title, points })),
    ...(finish ? { finish: { ...finish, rank: await finishRank(env, tgId, level) } } : {}),
    skill,
  };
}

/** Место лучшего времени игрока в таблице «Время» его сложности. */
async function finishRank(env: Env, tgId: number, level: Level): Promise<number | null> {
  const best = (await getBestTimes(env.DB, tgId))[level];
  return best ? getTimeRank(env.DB, level, best.time_ms, best.updated_at) : null;
}

/** Итог заплыва недели: место и таблица недели вместо таблицы сложности. */
async function weekOutcome(
  env: Env, tgId: number, weekKey: string, bank: number,
  rejected: Rejection | null, isRecord: boolean, newQuests: Quest[], weekly: WeekPlay,
) {
  const mine = await myWeek(env.DB, tgId, weekKey);
  const board = (await weekBoard(env.DB, weekKey, BOARD_SIZE)).map(({ name, bank: b }) => ({ name, bank: b }));
  return {
    rejected,
    isRecord,
    best: mine ? { bank: mine.bank, meters: null } : null,
    delta: mine ? bank - mine.bank : null,
    rank: mine?.rank ?? null,
    board,
    newQuests: newQuests.map(({ id, title, points }) => ({ id, title, points })),
    weekly,
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
    // Первый запрос мог оборваться между записью заплыва и начислением: начисление идемпотентно.
    const owed = known.rejected === null ? await awardQuests(env.DB, tgId, nowSec) : [];
    if (known.mode === 'week' && known.week) {
      const weekly = known.rejected === null
        ? await awardWeekPlay(env.DB, tgId, known.created_at, known.week, known.meters)
        : { points: 0, booster: null };
      return ok(await weekOutcome(env, tgId, known.week, known.bank, known.rejected as Rejection | null, false, owed, weekly));
    }
    // Первый запрос мог оборваться и до записи рекорда времени: довозим его (только для обычных заплывов).
    const knownFinish = known.finished === 1 && known.time_ms !== null
      ? {
          timeMs: known.time_ms,
          isRecord: known.mode === 'free'
            ? await applyBestTime(env.DB, tgId, known.level, known.time_ms, known.id, known.created_at)
            : false,
        }
      : null;
    const knownSkill = known.rejected === null && known.mode === 'free'
      ? await awardSkill(env.DB, tgId, known.created_at, known.level, { finished: knownFinish !== null, record: knownFinish?.isRecord ?? false })
      : [];
    return ok(await outcome(env, tgId, known.level, known.bank, known.rejected as Rejection | null, false, owed, knownFinish, knownSkill));
  }

  let rejected: Rejection | 'too_often' | 'daily_limit' | null = checkRun({ ...body }, nowMs);
  if (!rejected && (await overlapsPrevious(env.DB, tgId, body.startedAt))) rejected = 'too_often';
  if (!rejected && (await countRunsSince(env.DB, tgId, nowSec - DAY_MS / 1000)) >= DAILY_LIMIT) {
    rejected = 'daily_limit';
  }

  // Заплыв недели засчитывается, только если клиент назвал ключ текущей недели.
  const curWeek = isoWeekKey(nowSec);
  // Неделя заплыва — та, в которой он начат: ключ, присланный клиентом, и время старта обязаны совпасть с текущей.
  const wantsWeek = body.mode === 'week';
  const isWeek = wantsWeek && body.week === curWeek && isoWeekKey(Math.floor(body.startedAt / 1000)) === curWeek;
  const stale = wantsWeek && !isWeek; // чаще всего заплыв из офлайн-очереди после смены недели
  const prevWeekBest = isWeek ? await myWeek(env.DB, tgId, curWeek) : null;

  const finishOk = !rejected && acceptFinish(body.level, body.meters, body.durationMs, body.finished, body.timeMs);

  const runId = await insertRun(env.DB, {
    tgId, level: body.level, bank: body.bank, onboard: body.onboard, meters: body.meters,
    durationMs: body.durationMs, oarsLost: body.oarsLost, startedAt: body.startedAt,
    rejected, stats: sanitizeStats(body.stats, body.meters),
    mode: isWeek ? 'week' : 'free', week: isWeek ? curWeek : null,
    finished: finishOk, timeMs: finishOk ? (body.timeMs as number) : null,
  }, nowSec);

  // Заплывы недели не попадают в таблицы сложностей: у них своя таблица.
  const isRecord = rejected
    ? false
    : isWeek
      ? !prevWeekBest || body.bank > prevWeekBest.bank
      : stale
        ? false
        : await applyBest(env.DB, tgId, body.level, body.bank, body.meters, runId, nowSec);

  const newQuests = rejected ? [] : await awardQuests(env.DB, tgId, nowSec);

  if (stale) {
    return ok({
      rejected, isRecord: false, best: null, delta: null, rank: null, board: [],
      newQuests: newQuests.map(({ id, title, points }) => ({ id, title, points })),
      weekly: { points: 0, booster: null, stale: true },
    });
  }

  if (isWeek) {
    const weekly = rejected ? { points: 0, booster: null } : await awardWeekPlay(env.DB, tgId, nowSec, curWeek, body.meters);
    return ok(await weekOutcome(env, tgId, curWeek, body.bank, rejected as Rejection | null, isRecord, newQuests, weekly));
  }

  // Таблица «Время» только для обычных заплывов: у недели одна трасса и свой зачёт по очкам.
  const finish = finishOk
    ? { timeMs: body.timeMs as number, isRecord: await applyBestTime(env.DB, tgId, body.level, body.timeMs as number, runId, nowSec) }
    : null;

  const skill = rejected || stale
    ? []
    : await awardSkill(env.DB, tgId, nowSec, body.level, { finished: finish !== null, record: isRecord || (finish?.isRecord ?? false) });

  return ok(await outcome(env, tgId, body.level, body.bank, rejected as Rejection | null, isRecord, newQuests, finish, skill));
}
