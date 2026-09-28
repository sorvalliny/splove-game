import type { Env } from '../index';
import { activeSeason } from './state';
import { isoWeekKey, weekStart, WEEK_SEC } from './time';
import { WEEK_POINTS, type BoosterKind } from './week';
import { getSeasons, addPoints, totalsBoard } from '../db/season';
import { weekBoard, grantBooster } from '../db/week';
import { activeChats } from '../db/chats';
import { sendMessage } from '../telegram/api';
import { escHtml } from '../telegram/escape';

export interface WeekPlay { points: number; booster: BoosterKind | null }

/**
 * Участие в заплыве недели: +50 баллов и один бустер за неделю. Идемпотентно.
 * Сезон определяется по времени заплыва, а не по «сейчас»: повтор из офлайн-очереди не сдвигает неделю.
 */
/** Заплыв короче первого лагеря участия не даёт: иначе баллы и бустер добываются одним запросом за секунду. */
export const MIN_WEEK_PLAY_M = 400;
const MAX_POST_CHATS = 10;

export async function awardWeekPlay(
  db: D1Database, tgId: number, at: number, weekKey: string, meters: number,
): Promise<WeekPlay> {
  if (meters < MIN_WEEK_PLAY_M) return { points: 0, booster: null };
  const season = activeSeason(at, await getSeasons(db));
  if (!season) return { points: 0, booster: null };
  const paid = await addPoints(db, tgId, season.id, `w:${season.id}:${weekKey}:play`, WEEK_POINTS.play, at);
  const booster = await grantBooster(db, tgId, weekKey, at);
  return { points: paid ? WEEK_POINTS.play : 0, booster };
}

const MEDALS = ['🥇', '🥈', '🥉'];

async function summaryText(db: D1Database, week: string): Promise<string | null> {
  const top = await weekBoard(db, week, 3);
  if (top.length === 0) return null;
  const weekLines = top.map((r, i) => `${MEDALS[i]} ${escHtml(r.name)} — ${r.bank.toLocaleString('ru')}`);
  const seasonLines = (await totalsBoard(db, 3)).map((r, i) => `${i + 1}. ${escHtml(r.name)} — ${r.points.toLocaleString('ru')}`);
  const overall = seasonLines.length ? `\n\nОбщий зачёт по баллам:\n${seasonLines.join('\n')}` : '';
  return `<b>Итоги недели ${week.slice(5)}</b>\n${weekLines.join('\n')}${overall}`;
}

/** Итог недели уходит в активные чаты один раз. Пока переменная WEEKLY_POST не равна «on», не отправляется ничего. */
async function postSummary(env: Env, week: string, now: number): Promise<number> {
  if (env.WEEKLY_POST !== 'on') return 0;
  const chats = (await activeChats(env.DB)).slice(0, MAX_POST_CHATS);
  if (chats.length === 0) return 0;
  const text = await summaryText(env.DB, week);
  if (!text) return 0;

  const mark = await env.DB.prepare('INSERT OR IGNORE INTO posts (key, at) VALUES (?1, ?2)').bind(`week:${week}`, now).run();
  if (mark.meta.changes !== 1) return 0;
  let sent = 0;
  for (const chat of chats) if (await sendMessage(env.BOT_TOKEN, chat.chat_id, text)) sent++;
  // Ни один чат не получил: снимаем метку, чтобы следующий запуск попробовал снова.
  if (sent === 0) await env.DB.prepare('DELETE FROM posts WHERE key = ?').bind(`week:${week}`).run();
  return sent;
}

/**
 * Закрывает неделю, закончившуюся до `now`: бонусы 300/200/100 трём лучшим и, если разрешено, итог в чат.
 * Запускается расписанием в ночь на понедельник; повторный запуск ничего не удваивает.
 */
export async function closeWeek(env: Env, now: number): Promise<{ week: string; awarded: number; posted: number }> {
  const prevStart = weekStart(now) - WEEK_SEC;
  const week = isoWeekKey(prevStart);
  const season = activeSeason(prevStart + WEEK_SEC - 1, await getSeasons(env.DB));
  if (!season) return { week, awarded: 0, posted: 0 };

  let awarded = 0;
  const top = await weekBoard(env.DB, week, WEEK_POINTS.top.length);
  for (let i = 0; i < top.length; i++) {
    const fresh = await addPoints(env.DB, top[i].tg_id, season.id, `w:${season.id}:${week}:top${i + 1}`, WEEK_POINTS.top[i], now);
    if (fresh) awarded++;
  }
  return { week, awarded, posted: await postSummary(env, week, now) };
}
