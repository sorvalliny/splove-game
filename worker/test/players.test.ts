import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer, needsMemberCheck, setMembership, getPlayer } from '../src/db/players';

const user = { id: 1, first_name: 'Виктор', last_name: 'Сорваль', username: 'sorval' };

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM players').run();
});

describe('игроки', () => {
  it('первый вход создаёт игрока', async () => {
    const p = await upsertPlayer(env.DB, user, 1000);
    expect(p.name).toBe('Виктор Сорваль');
    expect(p.is_member).toBe(0);
    expect(p.created_at).toBe(1000);
    expect(p.last_seen_at).toBe(1000);
  });

  it('игрок без фамилии получает имя как есть', async () => {
    const p = await upsertPlayer(env.DB, { id: 2, first_name: 'Гена' }, 1000);
    expect(p.name).toBe('Гена');
    expect(p.username).toBeNull();
  });

  it('повторный вход не создаёт второго и двигает last_seen_at', async () => {
    await upsertPlayer(env.DB, user, 1000);
    const p = await upsertPlayer(env.DB, { ...user, first_name: 'Витя' }, 2000);
    expect(p.created_at).toBe(1000);
    expect(p.last_seen_at).toBe(2000);
    expect(p.name).toBe('Витя Сорваль');
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('повторный вход не сбрасывает уже известное членство', async () => {
    await upsertPlayer(env.DB, user, 1000);
    await setMembership(env.DB, user.id, true, 1000);
    const p = await upsertPlayer(env.DB, user, 2000);
    expect(p.is_member).toBe(1);
    expect(p.member_checked_at).toBe(1000);
  });

  it('членство проверяется заново только раз в сутки', () => {
    expect(needsMemberCheck(null, 1000)).toBe(true);
    expect(needsMemberCheck(1000, 1000 + 3600)).toBe(false);
    expect(needsMemberCheck(1000, 1000 + 86400)).toBe(false);
    expect(needsMemberCheck(1000, 1000 + 86401)).toBe(true);
  });

  it('снятие членства сохраняется', async () => {
    await upsertPlayer(env.DB, user, 1000);
    await setMembership(env.DB, user.id, true, 1000);
    await setMembership(env.DB, user.id, false, 2000);
    const p = await getPlayer(env.DB, user.id);
    expect(p?.is_member).toBe(0);
    expect(p?.member_checked_at).toBe(2000);
  });

  it('неизвестный игрок не находится', async () => {
    expect(await getPlayer(env.DB, 404)).toBeNull();
  });
});
