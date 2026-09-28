import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

const columns = async (table: string): Promise<string[]> =>
  (await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((c) => c.name);

describe('миграция 0006', () => {
  it('четыре сезона подряд без дыр, осень стартует 1 октября 2026 по Москве', async () => {
    const { results } = await env.DB
      .prepare('SELECT id, starts_at, ends_at FROM seasons ORDER BY starts_at')
      .all<{ id: string; starts_at: number; ends_at: number }>();
    expect(results.map((r) => r.id)).toEqual(['autumn-2026', 'winter-2027', 'spring-2027', 'summer-2027']);
    expect(results[0].starts_at).toBe(1790802000);
    for (let i = 1; i < results.length; i++) expect(results[i].starts_at).toBe(results[i - 1].ends_at);
    expect(results[3].ends_at).toBe(1822338000);
  });

  it('у заплыва есть колонки статистики, у игрока banned', async () => {
    expect(await columns('runs')).toEqual(expect.arrayContaining(['gena', 'bottles', 'camps', 'sanchez']));
    expect(await columns('players')).toContain('banned');
  });

  it('ключ начисления уникален для игрока', async () => {
    await env.DB.prepare('DELETE FROM points').run();
    const insert = () => env.DB
      .prepare("INSERT OR IGNORE INTO points (tg_id, season_id, key, points, at) VALUES (1,'autumn-2026','q:x',10,1)")
      .run();
    expect((await insert()).meta.changes).toBe(1);
    expect((await insert()).meta.changes).toBe(0);
  });
});
