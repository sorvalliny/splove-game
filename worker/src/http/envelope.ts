/** Единый конверт ответа: {ok, data, error}. Ошибка и данные взаимно исключают друг друга. */
const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export const ok = <T>(data: T, status = 200): Response =>
  json({ ok: true, data, error: null }, status);

export const fail = (code: string, message: string, status = 400): Response =>
  json({ ok: false, data: null, error: { code, message } }, status);

/** Новый Response вместо мутации существующего: заголовки готового ответа неизменяемы. */
export function withCors(res: Response, origin: string): Response {
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.set('access-control-allow-headers', 'content-type, x-telegram-init-data');
  out.headers.set('access-control-allow-methods', 'POST, OPTIONS');
  out.headers.set('vary', 'origin');
  return out;
}
