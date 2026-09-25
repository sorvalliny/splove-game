const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

interface ChatMemberResponse {
  ok: boolean;
  result?: { status?: string };
}

/**
 * Состоит ли игрок в чате. Любая неудача — недоступный Telegram, чужой чат, мусор в ответе —
 * трактуется как «не участник», а не как ошибка: игра должна открываться всегда,
 * просто без сохранения результатов.
 */
export async function isChatMember(botToken: string, chatId: string, tgId: number): Promise<boolean> {
  try {
    const url =
      `https://api.telegram.org/bot${botToken}/getChatMember` +
      `?chat_id=${encodeURIComponent(chatId)}&user_id=${tgId}`;
    const res = await fetch(url);
    const body = (await res.json()) as ChatMemberResponse;
    return body.ok === true && MEMBER_STATUSES.has(body.result?.status ?? '');
  } catch {
    return false;
  }
}
