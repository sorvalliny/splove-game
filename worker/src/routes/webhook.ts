import type { Env } from '../index';
import { sendMessage } from '../telegram/api';
import { getBoard } from '../db/runs';
import { LEVELS, type Level } from '../game/plausible';
import { registerChat, markGreeted, deactivateChat, migrateChat } from '../db/chats';
import { joinByCode } from '../db/communities';
import { upsertPlayer } from '../db/players';

const LEVEL_NAMES: Record<Level, string> = {
  easy: 'Прогулка',
  normal: 'Сплав',
  hard: 'Шторм',
};

const MEDALS = ['🥇', '🥈', '🥉'];

const JOIN_FAIL: Record<string, string> = {
  unknown_code: 'Такого приглашения нет. Попроси свежую ссылку в чате.',
  expired: 'Приглашение истекло.',
  full: 'Мест больше нет — список участников закрыт.',
};

/**
 * В группе кнопка с Mini App не работает — Telegram принимает её только в личке.
 * Поэтому в группу уходит обычная ссылка на бота, а игра открывается уже оттуда.
 */
const groupGreeting = (botName: string, code: string) => ({
  text: 'Игра открывается в личке с ботом — в группе Telegram этого не умеет.\n\nЖми кнопку, дальше «На воду».',
  replyMarkup: {
    inline_keyboard: [[{ text: 'Открыть игру', url: `https://t.me/${botName}?start=${code}` }]],
  },
});

const greeting = (gameUrl: string) => ({
  text: 'Сплав по Волге на трёхместной байдарке.\n\nРули пальцем, не теряй вёсла, сдавай очки в лагере. Рейтинг — среди своих.\n\n/top — таблица лидеров.',
  replyMarkup: { inline_keyboard: [[{ text: 'На воду', web_app: { url: gameUrl } }]] },
});

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

const JOINED_TEXT =
  'Здравствуйте. Я веду рейтинг СПLOVE для этого чата.\n\n' +
  'Играть — кнопкой ниже. Команда /top покажет таблицу.\n\n' +
  'Читать переписку я не могу и не собираюсь: у меня включён режим приватности, ' +
  'до меня доходят только команды со слешем.';

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

  await sendMessage(env.BOT_TOKEN, chat.id, JOINED_TEXT, {
    replyMarkup: { inline_keyboard: [[{ text: 'На воду', web_app: { url: env.GAME_URL } }]] },
  });
  await markGreeted(env.DB, chat.id, now);
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
  const text = raw.toLowerCase();

  if (cmd === '/start') {
    if (!isPrivate) {
      const g = groupGreeting(env.BOT_NAME, env.INVITE_CODE);
      await sendMessage(env.BOT_TOKEN, chatId, g.text, { replyMarkup: g.replyMarkup });
      return new Response('ok');
    }

    const from = msg?.from;
    if (from?.id) {
      await upsertPlayer(env.DB, {
        id: from.id,
        first_name: from.first_name ?? 'Гость',
        last_name: from.last_name,
        username: from.username,
      }, now);
      if (payload) {
        const join = await joinByCode(env.DB, from.id, payload, now);
        if (!join.ok) {
          await sendMessage(env.BOT_TOKEN, chatId, JOIN_FAIL[join.reason]);
          return new Response('ok');
        }
      }
    }

    const g = greeting(env.GAME_URL);
    await sendMessage(env.BOT_TOKEN, chatId, g.text, { replyMarkup: g.replyMarkup });
  } else if (text === 'топ' || cmd === '/top') {
    await sendMessage(env.BOT_TOKEN, chatId, await boardText(env));
  }

  return new Response('ok');
}
