/** Оставшееся время: «2д 03:14:22», а меньше суток «03:14:22». Ноль и меньше — «00:00:00». */
export function formatCountdown(ms) {
  if (!(ms > 0)) return '00:00:00';
  const total = Math.ceil(ms / 1000);
  const days = Math.floor(total / 86400);
  const rest = total % 86400;
  const hh = String(Math.floor(rest / 3600)).padStart(2, '0');
  const mm = String(Math.floor((rest % 3600) / 60)).padStart(2, '0');
  const ss = String(rest % 60).padStart(2, '0');
  return `${days > 0 ? `${days}д ` : ''}${hh}:${mm}:${ss}`;
}
