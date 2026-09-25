import type { Env } from '../index';
import { sendMessage } from '../telegram/api';
import { getBoard } from '../db/runs';
import { LEVELS, type Level } from '../game/plausible';
import { registerChat, markGreeted, deactivateChat, migrateChat } from '../db/chats';
import { joinByCode } from '../db/communities';
import { upsertPlayer } from '../db/players';
import { RULES, groupGreeting, privateGreeting, joinedChat, JOIN_FAIL } from './texts';

const LEVEL_NAMES: Record<Level, string> = {
  easy: 'Прогулка',
  normal: 'Сплав',
  hard: 'Шторм',
};

const MEDALS = ['🥇', '🥈', '🥉'];
const GROUPS = new Set(['group', 'supergroup']);
const PRESENT = new Set(['member', 'administrator', 'creator']);

interface Update {
  message?: {
    chat?: { id?: number; type?: string };
    from?: { id?: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    migrate_to_chat_id?: number;
  };
  my_chat_member?: {
    chat?: { id?: number; title?: string; type?: string };
    new_chat_member?: { status?: string };
  };
}

async function boardText(env: Env): Promise<string> {
  const parts: string[] = [];
  for (const level of LEVELS) {
    const board = await getBoard(env.DB, level, 5);
    const rows = board.length
      ? board.map((r, i) => `${MEDALS[i] ?? `${i + 1}.`} ${r.name} — ${r.bank.toLocaleString('ru')}`).join('\n')
      : 'пока никто не плавал';
    parts.push(`<b>${LEVEL_NAMES[level]}</b>\n${rows}`);
  }
  return parts.join('\n\n');
}

/** Бота добавили в группу или убрали из неё. */
async function handleMembership(u: NonNullable<Update['my_chat_member']>, env: Env, now: number) {
  const chat = u.chat;
  if (!chat?.id || !GROUPS.has(chat.type ?? '')) return;

  if (!PRESENT.has(u.new_chat_member?.status ?? '')) {
    await deactivateChat(env.DB, chat.id, now);
    return;
  }

  const fresh = await registerChat(env.DB, chat.id, chat.title ?? null, chat.type ?? 'group', now);
  if (!fresh) return;

  const g = joinedChat(env.BOT_NAME, env.INVITE_CODE);
  await sendMessage(env.BOT_TOKEN, chat.id, g.text, { replyMarkup: g.replyMarkup });
  await markGreeted(env.DB, chat.id, now);
}

/** Личка: запоминаем игрока и, если пришёл по приглашению, записываем в сообщество. */
async function handleStartPrivate(
  msg: NonNullable<Update['message']>, payload: string, env: Env, now: number,
): Promise<Response | null> {
  const from = msg.from;
  if (!from?.id) return null;

  await upsertPlayer(env.DB, {
    id: from.id,
    first_name: from.first_name ?? 'Гость',
    last_name: from.last_name,
    username: from.username,
  }, now);

  if (!payload) return null;

  const join = await joinByCode(env.DB, from.id, payload, now);
  if (join.ok) return null;

  await sendMessage(env.BOT_TOKEN, msg.chat!.id!, JOIN_FAIL[join.reason]);
  return new Response('ok');
}

export async function handleWebhook(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
    return new Response('нет', { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as Update | null;
  const now = Math.floor(Date.now() / 1000);

  if (update?.my_chat_member) {
    await handleMembership(update.my_chat_member, env, now);
    return new Response('ok');
  }

  // Группа стала супергруппой: без переноса проверка членства молча сломается для всех.
  const movedTo = update?.message?.migrate_to_chat_id;
  const movedFrom = update?.message?.chat?.id;
  if (movedTo && movedFrom) {
    await migrateChat(env.DB, movedFrom, movedTo, now);
    return new Response('ok');
  }

  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const raw = msg?.text?.trim();
  if (!chatId || !raw) return new Response('ok');

  const isPrivate = msg?.chat?.type === 'private';
  const [cmdRaw, ...rest] = raw.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().split('@')[0];
  const payload = rest.join(' ');

  if (cmd === '/start') {
    if (!isPrivate) {
      const g = groupGreeting(env.BOT_NAME, env.INVITE_CODE);
      await sendMessage(env.BOT_TOKEN, chatId, g.text, { replyMarkup: g.replyMarkup });
      return new Response('ok');
    }
    const stop = await handleStartPrivate(msg!, payload, env, now);
    if (stop) return stop;

    const g = privateGreeting(env.GAME_URL);
    await sendMessage(env.BOT_TOKEN, chatId, g.text, { replyMarkup: g.replyMarkup });
  } else if (cmd === '/rules' || raw.toLowerCase() === 'правила') {
    await sendMessage(env.BOT_TOKEN, chatId, RULES);
  } else if (cmd === '/top' || raw.toLowerCase() === 'топ') {
    await sendMessage(env.BOT_TOKEN, chatId, await boardText(env));
  }

  return new Response('ok');
}
