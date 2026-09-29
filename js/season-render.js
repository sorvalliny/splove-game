const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ru = (n) => Number(n).toLocaleString('ru');

const clampPct = (progress, goal) =>
  Math.min(100, Math.max(0, Math.round((Number(progress) / Number(goal)) * 100)));

export function questsHtml(quests) {
  if (!quests?.length) return '<p class="sNote">Задания появятся с началом сезона</p>';
  return quests.map((q) => `
    <div class="q${q.done ? ' done' : ''}">
      <div class="sTitle"><span>${esc(q.title)}</span><span class="qp">${q.done ? '✓' : `${ru(q.progress)} / ${ru(q.goal)}`} · <b>+${ru(q.points)}</b></span></div>
      <div class="sBar"><i style="width:${q.done ? 100 : clampPct(q.progress, q.goal)}%"></i></div>
    </div>`).join('');
}

export function boardHtml(board) {
  if (!board?.length) return '<li class="empty">Баллов пока ни у кого нет</li>';
  return board.map((r, i) => `
    <li${r.isMe ? ' class="me"' : ''}>
      <b>${i + 1}</b>
      <span class="nm">${esc(r.name)}</span>
      <span class="pt">${ru(r.points)}</span>
    </li>`).join('');
}

export function weekBoardHtml(board) {
  if (!board?.length) return '<li class="empty">На этой неделе ещё никто не плавал</li>';
  return board.map((r, i) => `
    <li${r.isMe ? ' class="me"' : ''}>
      <b>${i + 1}</b>
      <span class="nm">${esc(r.name)}</span>
      <span class="pt">${ru(r.bank)}</span>
    </li>`).join('');
}

export function champsHtml(champions) {
  if (!champions?.length) return '';
  return champions.map((c) => `🏆 ${esc(c.title)}: ${esc(c.name)}`).join('<br>');
}
