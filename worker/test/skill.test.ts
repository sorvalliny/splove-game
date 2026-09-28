import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createHmac } from 'node:crypto';
import { SKILL_POINTS } from '../src/season/skill';

const TOKEN = (env as unknown as { BOT_TOKEN: string }).BOT_TOKEN;

function initData(id = 956875): string {
  const all = { user: JSON.stringify({ id, first_name: 'Виктор' }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k as keyof typeof all]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...all, hash }).toString();
}

const at = (iso: string) => vi.setSystemTime(new Date(`${iso}+03:00`));
let offset = 0;
const send = (over: Record<string, unknown> = {}) => SELF.fetch('https://example.com/api/runs', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData() },
  body: JSON.stringify({
    level: 'normal', bank: 300, onboard: 0, meters: 900, durationMs: 60_000, oarsLost: 0,
    startedAt: Date.now() - 5_000_000 + (offset += 300_000), ...over,
  }),
}).then((r) => r.json<any>()).then((b) => b.data);
const finish = (over: Record<string, unknown> = {}) =>
  send({ meters: 4000, durationMs: 200_000, finished: true, timeMs: 195_000, ...over });

const keys = async () =>
  (await env.DB.prepare("SELECT key, points FROM points WHERE key LIKE 'm:%' ORDER BY key").all<any>()).results;

beforeEach(async () => {
  offset = 0;
  for (const t of ['best_times', 'boosters', 'points', 'visits', 'bests', 'runs', 'memberships', 'players']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});
afterEach(() => vi.useRealTimers());

describe('баллы за мастерство', () => {
  it('настройки: финиш 100, рекорд 50', () => {
    expect(SKILL_POINTS).toEqual({ finish: 100, record: 50 });
  });

  it('первый финиш недели на сложности: +100 за финиш и +50 за рекорд', async () => {
    at('2026-10-06T12:00:00');
    const d = await finish();
    expect(d.skill).toEqual([
      { id: 'finish', title: 'Финиш на «Сплаве»', points: 100 },
      { id: 'record', title: 'Личный рекорд на «Сплаве»', points: 50 },
    ]);
    expect(await keys()).toEqual([
      { key: 'm:autumn-2026:2026-W41:finish:normal', points: 100 },
      { key: 'm:autumn-2026:2026-W41:record:normal', points: 50 },
    ]);
  });

  it('второй финиш и новый рекорд в ту же неделю баллов не дают', async () => {
    at('2026-10-06T12:00:00');
    await finish({ bank: 300 });
    const d = await finish({ bank: 900, timeMs: 180_000 });
    expect(d.rejected).toBeNull();
    expect(d.skill).toEqual([]);
    expect((await keys()).length).toBe(2);
  });

  it('другая сложность — свои баллы', async () => {
    at('2026-10-06T12:00:00');
    await finish();
    const d = await finish({ level: 'easy', meters: 3000 });
    expect(d.skill.map((s: any) => s.id)).toEqual(['finish', 'record']);
    expect((await keys()).length).toBe(4);
  });

  it('на следующей неделе снова', async () => {
    at('2026-10-06T12:00:00');
    await finish();
    at('2026-10-13T12:00:00');
    const d = await finish({ bank: 1000, timeMs: 170_000 });
    expect(d.skill.map((s: any) => s.id)).toEqual(['finish', 'record']);
  });

  it('рекорд без финиша даёт только +50', async () => {
    at('2026-10-06T12:00:00');
    const d = await send();
    expect(d.skill).toEqual([{ id: 'record', title: 'Личный рекорд на «Сплаве»', points: 50 }]);
  });

  it('заплыв хуже рекорда без финиша ничего не даёт', async () => {
    at('2026-10-06T12:00:00');
    await send({ bank: 900 });
    await env.DB.prepare("DELETE FROM points WHERE key LIKE 'm:%'").run(); // забываем баллы, рекорд остаётся
    const d = await send({ bank: 100 });
    expect(d.skill).toEqual([]);
  });

  it('до старта сезона баллов нет', async () => {
    at('2026-09-29T12:00:00');
    const d = await finish();
    expect(d.skill).toEqual([]);
    expect(await keys()).toEqual([]);
  });

  it('отклонённый заплыв ничего не даёт', async () => {
    at('2026-10-06T12:00:00');
    const d = await finish({ meters: 400_000 });
    expect(d.rejected).toBe('too_fast');
    expect(d.skill).toEqual([]);
  });

  it('заплыв недели баллов за мастерство не даёт: у него свои', async () => {
    at('2026-10-06T12:00:00');
    const d = await finish({ mode: 'week', week: '2026-W41' });
    expect(d.skill ?? []).toEqual([]);
    expect(await keys()).toEqual([]);
  });

  it('повтор после обрыва довозит баллы за финиш', async () => {
    at('2026-10-06T12:00:00');
    const startedAt = Date.now() - 300_000;
    const { upsertPlayer } = await import('../src/db/players');
    const { insertRun } = await import('../src/db/runs');
    await upsertPlayer(env.DB, { id: 956875, first_name: 'Виктор' }, 1000);
    await insertRun(env.DB, {
      tgId: 956875, level: 'normal', bank: 300, onboard: 0, meters: 4000, durationMs: 200_000, oarsLost: 0,
      startedAt, rejected: null, finished: true, timeMs: 195_000,
    }, Math.floor(Date.now() / 1000));
    const d = await finish({ startedAt });
    expect(d.skill.map((s: any) => s.id)).toContain('finish');
  });
});
