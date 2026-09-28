import type { Env } from '../index';
import { fail } from './envelope';
import { verifyInitData } from '../telegram/verify';
import { upsertPlayer, type Player } from '../db/players';

export type Authorized = { ok: true; player: Player } | { ok: false; res: Response };

/**
 * Единая дверь для всех ручек: подпись Telegram и апсерт игрока.
 * Игра открыта для всех, кто зашёл через бота, членство в чате не проверяется.
 */
export async function authorize(req: Request, env: Env): Promise<Authorized> {
  const initData = req.headers.get('x-telegram-init-data');
  if (!initData) return { ok: false, res: fail('no_init_data', 'Игра открыта не из Telegram', 401) };

  const verified = await verifyInitData(initData, env.BOT_TOKEN);
  if (!verified.ok) return { ok: false, res: fail('bad_init_data', 'Telegram не подтвердил, кто ты', 401) };

  const now = Math.floor(Date.now() / 1000);
  const player = await upsertPlayer(env.DB, verified.user, now);
  return { ok: true, player };
}
