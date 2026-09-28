import type { Env } from '../index';
import { ok } from '../http/envelope';
import { authorize } from '../http/auth';
import { seasonView, yearBounds, activeSeason } from '../season/state';
import { questsForWeek, valueOf, isDone } from '../season/quests';
import { weekIndex, weekStart, WEEK_SEC } from '../season/time';
import {
  getSeasons, recordVisit, weekProgress, totalsBoard, myTotals, champions,
} from '../db/season';

const BOARD_SIZE = 10;

export async function handleSeason(req: Request, env: Env): Promise<Response> {
  const auth = await authorize(req, env);
  if (!auth.ok) return auth.res;

  const tgId = auth.player.tg_id;
  const now = Math.floor(Date.now() / 1000);
  await recordVisit(env.DB, tgId, now);

  const seasons = await getSeasons(env.DB);
  const view = seasonView(now, seasons);
  const running = activeSeason(now, seasons);

  const [board, me, champs] = await Promise.all([
    totalsBoard(env.DB, BOARD_SIZE),
    myTotals(env.DB, tgId, view?.id ?? null),
    champions(env.DB, now),
  ]);

  let quests: unknown[] = [];
  if (running) {
    const wStart = weekStart(now);
    const progress = await weekProgress(env.DB, tgId, Math.max(wStart, running.starts_at), wStart + WEEK_SEC);
    quests = questsForWeek(weekIndex(now)).map((q) => ({
      id: q.id, title: q.title, goal: q.goal, points: q.points,
      progress: Math.min(valueOf(q, progress), q.goal), done: isDone(q, progress),
    }));
  }

  return ok({
    now,
    season: view,
    year: yearBounds(seasons),
    me,
    quests,
    board: board.map((r) => ({ name: r.name, points: r.points, isMe: r.tg_id === tgId })),
    champions: champs,
  });
}
