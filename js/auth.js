/** Тонкая обёртка над Telegram WebApp. Вне Telegram всё молчит, игра работает как обычный сайт. */
const tg = globalThis.Telegram?.WebApp ?? null;

export const inTelegram = () => Boolean(tg?.initData);

export const initData = () => tg?.initData ?? '';

export function ready() {
  if (!tg) return;
  tg.ready();
  tg.expand();
}
