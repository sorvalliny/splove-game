import { describe, it, expect } from 'vitest';
import { ok, fail, withCors } from '../src/http/envelope';

describe('конверт ответа', () => {
  it('успех несёт данные и пустую ошибку', async () => {
    const body = await ok({ a: 1 }).json();
    expect(body).toEqual({ ok: true, data: { a: 1 }, error: null });
  });

  it('ошибка несёт код и сообщение, данных нет', async () => {
    const res = fail('not_a_member', 'Не участник чата', 403);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      data: null,
      error: { code: 'not_a_member', message: 'Не участник чата' },
    });
  });

  it('CORS разрешает только оговорённый источник', () => {
    const res = withCors(ok({}), 'https://sorvalliny.github.io');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://sorvalliny.github.io');
  });
});
