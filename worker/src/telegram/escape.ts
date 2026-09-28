/** Бот шлёт HTML, а имена задают пользователи: без экранирования имя вроде «<b» ломает разметку. */
export const escHtml = (text: string): string =>
  text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
