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

interface SendOptions {
  replyMarkup?: unknown;
}

/** Отправка сообщения. Ошибки глушатся: молчание бота не должно ронять игру. */
export async function sendMessage(
  botToken: string, chatId: number | string, text: string, opts: SendOptions = {},
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
      }),
    });
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (body.ok !== true) console.error('sendMessage отклонён:', body.description);
    return body.ok === true;
  } catch (e) {
    console.error('sendMessage упал:', (e as Error).message);
    return false;
  }
}
