import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../src/telegram/verify';

const TOKEN = '123456:TEST_TOKEN_FOR_TESTS_ONLY';

/** Подпись строится независимой реализацией на node:crypto — воркер проверяет через WebCrypto. */
function signed(fields: Record<string, string>): string {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 956875, first_name: 'Виктор', username: 'sorval' });
const now = () => Math.floor(Date.now() / 1000);

describe('проверка initData', () => {
  it('принимает валидную подпись и достаёт игрока', async () => {
    const r = await verifyInitData(signed({ user, auth_date: String(now()) }), TOKEN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.id).toBe(956875);
  });

  it('отклоняет подделанные данные', async () => {
    const tampered = signed({ user, auth_date: String(now()) }).replace('956875', '999999');
    expect(await verifyInitData(tampered, TOKEN)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет подпись чужим токеном', async () => {
    const r = await verifyInitData(signed({ user, auth_date: String(now()) }), '999:OTHER');
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет подпись старше суток', async () => {
    const old = String(now() - 60 * 60 * 25);
    expect(await verifyInitData(signed({ user, auth_date: old }), TOKEN)).toEqual({ ok: false, reason: 'expired' });
  });

  it('отклоняет строку без подписи', async () => {
    const r = await verifyInitData(`user=${encodeURIComponent(user)}`, TOKEN);
    expect(r).toEqual({ ok: false, reason: 'no_hash' });
  });

  it('отклоняет пустую строку', async () => {
    expect(await verifyInitData('', TOKEN)).toEqual({ ok: false, reason: 'no_hash' });
  });

  it('отклоняет валидную подпись без блока пользователя', async () => {
    const r = await verifyInitData(signed({ auth_date: String(now()) }), TOKEN);
    expect(r).toEqual({ ok: false, reason: 'no_user' });
  });

  it('отклоняет пользователя без числового идентификатора', async () => {
    const broken = JSON.stringify({ first_name: 'Без id' });
    const r = await verifyInitData(signed({ user: broken, auth_date: String(now()) }), TOKEN);
    expect(r).toEqual({ ok: false, reason: 'no_user' });
  });
});
