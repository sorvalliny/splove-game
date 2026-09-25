import type { Env } from '../index';
import { fail } from './envelope';
import { verifyInitData } from '../telegram/verify';
import { isChatMember } from '../telegram/api';
import { upsertPlayer, needsMemberCheck, setMembership, type Player } from '../db/players';
import { activeChats } from '../db/chats';

/**
 * Игрок считается своим, если состоит хотя бы в одном чате, куда добавлен бот.
 * Пока ни один чат не зарегистрирован, работает чат из секрета — это стартовое состояние.
 */
async function checkMembership(env: Env, tgId: number): Promise<boolean> {
  const chats = await activeChats(env.DB);
  const ids = chats.length ? chats.map((c) => String(c.chat_id)) : [env.CHAT_ID];
  for (const id of ids) {
    if (await isChatMember(env.BOT_TOKEN, id, tgId)) return true;
  }
  return false;
}

export type Authorized = { ok: true; player: Player } | { ok: false; res: Response };

/**
 * Единая дверь для всех ручек: подпись Telegram, апсерт игрока и членство в чате.
 * Членство перепроверяется не чаще раза в сутки.
 */
export async function authorize(req: Request, env: Env): Promise<Authorized> {
  const initData = req.headers.get('x-telegram-init-data');
  if (!initData) return { ok: false, res: fail('no_init_data', 'Игра открыта не из Telegram', 401) };

  const verified = await verifyInitData(initData, env.BOT_TOKEN);
  if (!verified.ok) return { ok: false, res: fail('bad_init_data', 'Telegram не подтвердил, кто ты', 401) };

  const now = Math.floor(Date.now() / 1000);
  let player = await upsertPlayer(env.DB, verified.user, now);

  if (needsMemberCheck(player.member_checked_at, now)) {
    const member = await checkMembership(env, verified.user.id);
    await setMembership(env.DB, verified.user.id, member, now);
    player = { ...player, is_member: member ? 1 : 0, member_checked_at: now };
  }

  if (!player.is_member) {
    return { ok: false, res: fail('not_a_member', 'Рейтинг только для участников чата сплава', 403) };
  }
  return { ok: true, player };
}
