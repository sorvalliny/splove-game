import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer } from '../src/db/players';
import { insertRun } from '../src/db/runs';
import { registerChat } from '../src/db/chats';
import { closeWeek } from '../src/season/weekly';
import worker from '../src/index';

const sec = (iso: string): number => Math.floor(new Date(`${iso}+03:00`).getTime() / 1000);
const sent: any[] = [];

let started = 1_000_000;
const weekRun = (id: number, bank: number, iso: string, week: string, over: Record<string, unknown> = {}) =>
  insertRun(env.DB, {
    tgId: id, level: 'normal', bank, onboard: 0, meters: 500, durationMs: 60_000, oarsLost: 0,
    startedAt: (started += 100_000), rejected: null, mode: 'week', week, ...over,
  } as Parameters<typeof insertRun>[1], sec(iso));

const pointsOf = async () =>
  (await env.DB.prepare('SELECT tg_id, key, points FROM points ORDER BY key').all<any>()).results;

const on = { ...env, WEEKLY_POST: 'on' } as typeof env;

beforeEach(async () => {
  sent.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    sent.push(init?.body ? JSON.parse(init.body as string) : null);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }));
  for (const t of ['posts', 'chats', 'boosters', 'points', 'visits', 'bests', 'runs', 'memberships', 'players']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  for (const [id, name] of [[1, 'Аня'], [2, 'Боря'], [3, 'Вера'], [4, 'Гена']] as const) {
    await upsertPlayer(env.DB, { id, first_name: name }, 1000);
  }
});
afterEach(() => vi.unstubAllGlobals());

async function playW41() {
  await weekRun(1, 900, '2026-10-06T10:00:00', '2026-W41');
  await weekRun(2, 700, '2026-10-06T10:00:00', '2026-W41');
  await weekRun(3, 500, '2026-10-06T10:00:00', '2026-W41');
  await weekRun(4, 100, '2026-10-06T10:00:00', '2026-W41');
}

describe('closeWeek: бонусы мест', () => {
  it('в ночь на понедельник закрывает прошедшую неделю: 300, 200, 100 трём первым', async () => {
    await playW41();
    const r = await closeWeek(env, sec('2026-10-12T00:05:00'));
    expect(r.week).toBe('2026-W41');
    expect(await pointsOf()).toEqual([
      { tg_id: 1, key: 'w:autumn-2026:2026-W41:top1', points: 300 },
      { tg_id: 2, key: 'w:autumn-2026:2026-W41:top2', points: 200 },
      { tg_id: 3, key: 'w:autumn-2026:2026-W41:top3', points: 100 },
    ]);
  });

  it('повторный запуск ничего не удваивает', async () => {
    await playW41();
    await closeWeek(env, sec('2026-10-12T00:05:00'));
    const again = await closeWeek(env, sec('2026-10-12T00:10:00'));
    expect(again.awarded).toBe(0);
    expect((await pointsOf()).length).toBe(3);
  });

  it('забаненный в бонусе не участвует: место занимает следующий', async () => {
    await playW41();
    await env.DB.prepare('UPDATE players SET banned = 1 WHERE tg_id = 1').run();
    await closeWeek(env, sec('2026-10-12T00:05:00'));
    expect((await pointsOf()).map((p) => [p.tg_id, p.points])).toEqual([[2, 300], [3, 200], [4, 100]]);
  });

  it('неделя на стыке сезонов относится к сезону её последнего дня', async () => {
    await weekRun(1, 800, '2026-12-29T10:00:00', '2026-W53');
    await closeWeek(env, sec('2027-01-04T00:05:00'));
    expect(await pointsOf()).toEqual([{ tg_id: 1, key: 'w:winter-2027:2026-W53:top1', points: 300 }]);
  });

  it('заплывы других недель и обычные не считаются', async () => {
    await weekRun(1, 900, '2026-10-06T10:00:00', '2026-W40');
    await weekRun(2, 700, '2026-10-06T10:00:00', '2026-W41', { mode: 'free', week: null });
    await closeWeek(env, sec('2026-10-12T00:05:00'));
    expect(await pointsOf()).toEqual([]);
  });

  it('вне сезона баллов нет', async () => {
    await weekRun(1, 900, '2026-09-20T10:00:00', '2026-W38');
    await closeWeek(env, sec('2026-09-28T00:05:00'));
    expect(await pointsOf()).toEqual([]);
  });
});

describe('closeWeek: итог недели в чат', () => {
  beforeEach(async () => {
    await registerChat(env.DB, -100, 'Сплав', 'supergroup', 1000);
    await playW41();
  });

  it('по умолчанию выключен: ничего не отправляется и маркер не ставится', async () => {
    const r = await closeWeek(env, sec('2026-10-12T00:05:00'));
    expect(r.posted).toBe(0);
    expect(sent.length).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM posts').first<any>()).n).toBe(0);
  });

  it('включён: одно сообщение в чат с топ-3 недели, повторный запуск молчит', async () => {
    const r = await closeWeek(on, sec('2026-10-12T00:05:00'));
    expect(r.posted).toBe(1);
    expect(sent.length).toBe(1);
    expect(sent[0].chat_id).toBe(-100);
    expect(sent[0].text).toContain('Аня');
    expect(sent[0].text).toContain('W41');
    expect(sent[0].text).not.toContain('Гена');              // четвёртый в итог не входит

    await closeWeek(on, sec('2026-10-12T00:10:00'));
    expect(sent.length).toBe(1);
  });

  it('имена в сообщении экранируются', async () => {
    await upsertPlayer(env.DB, { id: 5, first_name: '<b' }, 1000);
    await weekRun(5, 5000, '2026-10-06T10:00:00', '2026-W41');
    await closeWeek(on, sec('2026-10-12T00:05:00'));
    expect(sent[0].text).toContain('&lt;b');
    expect(sent[0].text).not.toMatch(/<b(?!>|\/)/);
  });

  it('в чаты отправляется не больше десяти, лишние отбрасываются', async () => {
    for (let i = 2; i <= 14; i++) await registerChat(env.DB, -100 - i, `Чат ${i}`, 'supergroup', 1000 + i);
    const r = await closeWeek(on, sec('2026-10-12T00:05:00'));
    expect(r.posted).toBe(10);
    expect(sent.length).toBe(10);
  });

  it('подпись общего зачёта не выдаёт годовые баллы за сезонные', async () => {
    await closeWeek(on, sec('2026-10-12T00:05:00'));
    expect(sent[0].text).toContain('Общий зачёт');
    expect(sent[0].text).not.toContain('Сезон «');
  });

  it('если отправка не удалась ни в один чат, метка снимается и итог уйдёт при следующем запуске', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'down' }))));
    const first = await closeWeek(on, sec('2026-10-12T00:05:00'));
    expect(first.posted).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM posts').first<any>()).n).toBe(0);

    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }));
    const second = await closeWeek(on, sec('2026-10-12T00:10:00'));
    expect(second.posted).toBe(1);
  });

  it('неделя без заплывов не порождает сообщения', async () => {
    await closeWeek(on, sec('2026-10-19T00:05:00'));          // закрывается W42, в ней никто не играл
    expect(sent.length).toBe(0);
  });
});

describe('расписание', () => {
  it('обработчик scheduled вызывает закрытие недели', async () => {
    await playW41();
    vi.setSystemTime(new Date('2026-10-12T00:05:00+03:00'));
    try {
      await (worker as any).scheduled({ scheduledTime: Date.now() }, env, { waitUntil() {} });
    } finally {
      vi.useRealTimers();
    }
    expect((await pointsOf()).length).toBe(3);
  });
});
