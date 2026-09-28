import type { Env } from '../index';
import { ok, fail } from '../http/envelope';
import { authorize } from '../http/auth';
import { isoWeekKey, weekIndex, weekStart, WEEK_SEC } from '../season/time';
import { weekSeed, BOOSTER_KINDS, type BoosterKind } from '../season/week';
import { recordVisit } from '../db/season';
import { weekBoard, myWeek, boostersOf, useBooster } from '../db/week';

const BOARD_SIZE = 10;

export async function handleWeek(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const tgId = auth.player.tg_id;
  const now = Math.floor(Date.now() / 1000);
  await recordVisit(env.DB, tgId, now);

  const weekKey = isoWeekKey(now);
  const [board, me, boosters] = await Promise.all([
    weekBoard(env.DB, weekKey, BOARD_SIZE),
    myWeek(env.DB, tgId, weekKey),
    boostersOf(env.DB, tgId),
  ]);

  return ok({
    weekKey,
    seed: weekSeed(weekIndex(now)),
    level: 'normal',
    endsAt: weekStart(now) + WEEK_SEC,
    board: board.map((r) => ({ name: r.name, bank: r.bank, isMe: r.tg_id === tgId })),
    me,
    boosters,
  });
}

/** Списание бустера при старте заплыва. Эффект применяет клиент; сервер лишь не даёт использовать один бустер дважды. */
export async function handleBoosterUse(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
  const kind = body?.kind as BoosterKind;
  if (!BOOSTER_KINDS.includes(kind)) return fail('bad_request', 'Неизвестный бустер', 400);

  const used = await useBooster(env.DB, auth.player.tg_id, kind, Math.floor(Date.now() / 1000));
  if (!used) return fail('no_booster', 'Такого бустера нет', 409);
  return ok({ kind });
}
