import type { Env } from '../index';
import { sendMessage } from '../telegram/api';
import { getBoard } from '../db/runs';
import { LEVELS, type Level } from '../game/plausible';

const LEVEL_NAMES: Record<Level, string> = {
  easy: 'Прогулка',
  normal: 'Сплав',
  hard: 'Шторм',
};

const MEDALS = ['🥇', '🥈', '🥉'];

const greeting = (gameUrl: string) => ({
  text: 'Сплав по Волге на трёхместной байдарке.\n\nРули пальцем, не теряй вёсла, сдавай очки в лагере. Рейтинг — среди своих.',
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

interface Update {
  message?: { chat?: { id?: number }; text?: string };
}

export async function handleWebhook(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
    return new Response('нет', { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as Update | null;
  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text?.trim().toLowerCase();
  if (!chatId || !text) return new Response('ok');

  if (text === '/start' || text.startsWith('/start@')) {
    const g = greeting(env.GAME_URL);
    await sendMessage(env.BOT_TOKEN, chatId, g.text, { replyMarkup: g.replyMarkup });
  } else if (text === 'топ' || text === '/top' || text.startsWith('/top@')) {
    await sendMessage(env.BOT_TOKEN, chatId, await boardText(env));
  }

  return new Response('ok');
}
