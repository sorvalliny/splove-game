export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export type VerifyResult =
  | { ok: true; user: TgUser; authDate: number }
  | { ok: false; reason: 'no_hash' | 'bad_signature' | 'expired' | 'no_user' };

const MAX_AGE_SEC = 60 * 60 * 24;
const enc = new TextEncoder();

async function hmac(keyData: BufferSource, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Сравнение за постоянное время: длина известна заранее, ранних выходов нет. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseUser(raw: string | null): TgUser | null {
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as TgUser;
    return typeof user?.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

/**
 * Проверяет подпись initData из Telegram WebApp по правилам Bot API:
 * секрет — HMAC от токена бота с ключом "WebAppData", сообщение — отсортированные пары k=v.
 */
export async function verifyInitData(initData: string, botToken: string): Promise<VerifyResult> {
  const params = new URLSearchParams(initData);
  const given = params.get('hash');
  if (!given) return { ok: false, reason: 'no_hash' };

  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = await hmac(enc.encode('WebAppData'), botToken);
  if (!sameHex(hex(await hmac(secret, check)), given)) return { ok: false, reason: 'bad_signature' };

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SEC) {
    return { ok: false, reason: 'expired' };
  }

  const user = parseUser(params.get('user'));
  return user ? { ok: true, user, authDate } : { ok: false, reason: 'no_user' };
}
