import type { Env } from '../index';
import { sendMessage } from '../telegram/api';
import { collectMetrics, formatMetrics } from '../season/metrics';
import { totalsBoard } from '../db/season';

interface AdminMessage {
  chat?: { id?: number; type?: string };
  from?: { id?: number };
}

const ADMIN_COMMANDS = new Set(['/metrics', '/season', '/ban', '/unban']);

/** Бот шлёт HTML, а имена задают пользователи: без экранирования имя ломает разметку. */
const esc = (t: string): string => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const adminIds = (env: Env): number[] =>
  (env.ADMIN_IDS ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isSafeInteger(n) && n > 0);

/**
 * Админ — только в личке с ботом и только из списка ADMIN_IDS.
 * Подлинность from.id обеспечивает секретный заголовок вебхука.
 */
export const isAdmin = (msg: AdminMessage, env: Env): boolean =>
  msg.chat?.type === 'private' && adminIds(env).includes(msg.from?.id ?? -1);

const reply = async (env: Env, chatId: number, text: string): Promise<Response> => {
  await sendMessage(env.BOT_TOKEN, chatId, text);
  return new Response('ok');
};

async function setBanned(env: Env, chatId: number, arg: string | undefined, banned: boolean): Promise<Response> {
  const cmd = banned ? '/ban' : '/unban';
  if (!arg || !/^\d+$/.test(arg)) return reply(env, chatId, `Нужен числовой id игрока: ${cmd} 123456`);

  const id = Number(arg);
  const player = await env.DB.prepare('SELECT name FROM players WHERE tg_id = ?').bind(id).first<{ name: string }>();
  if (!player) return reply(env, chatId, `Нет такого игрока: ${id}`);

  await env.DB.prepare('UPDATE players SET banned = ? WHERE tg_id = ?').bind(banned ? 1 : 0, id).run();
  return reply(env, chatId, `${banned ? 'Забанен' : 'Разбанен'}: ${esc(player.name)} (${id})`);
}

async function metricsReport(env: Env, chatId: number, now: number): Promise<Response> {
  const size = Number(env.CHAT_SIZE);
  const m = await collectMetrics(env.DB, now, Number.isInteger(size) && size > 0 ? size : null);
  return reply(env, chatId, formatMetrics(m));
}

/** Общая таблица баллов с именами и @username: по ней вручную проверяют призёров. */
async function seasonReport(env: Env, chatId: number): Promise<Response> {
  const top = await totalsBoard(env.DB, 10);
  if (top.length === 0) return reply(env, chatId, 'Баллов пока ни у кого нет');
  const lines = top.map((r, i) =>
    `${i + 1}. ${esc(r.name)}${r.username ? ` (@${esc(r.username)})` : ''} — ${r.points.toLocaleString('ru')}`);
  return reply(env, chatId, `Топ сезона по общей сумме:\n${lines.join('\n')}`);
}

/**
 * Админские команды. Возвращает null, если команда не админская;
 * для не-админа админская команда молча съедается: бот не признаётся, что она существует.
 */
export async function handleAdmin(
  cmd: string, args: string[], msg: AdminMessage, env: Env, now: number,
): Promise<Response | null> {
  if (!ADMIN_COMMANDS.has(cmd)) return null;
  if (!isAdmin(msg, env)) return new Response('ok');

  const chatId = msg.chat!.id!;
  if (cmd === '/ban') return setBanned(env, chatId, args[0], true);
  if (cmd === '/unban') return setBanned(env, chatId, args[0], false);
  if (cmd === '/metrics') return metricsReport(env, chatId, now);
  return seasonReport(env, chatId);
}
