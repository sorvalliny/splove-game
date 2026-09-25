import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer } from '../src/db/players';
import { joinByCode, isInAnyCommunity, communityOf, membersCount } from '../src/db/communities';

const now = 1_000_000;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM memberships').run();
  await env.DB.prepare("DELETE FROM communities WHERE id <> 'splav'").run();
  await env.DB.prepare("UPDATE communities SET expires_at = NULL, max_members = 50 WHERE id = 'splav'").run();
  await env.DB.prepare('DELETE FROM players').run();
  await upsertPlayer(env.DB, { id: 1, first_name: 'Виктор' }, now);
  await upsertPlayer(env.DB, { id: 2, first_name: 'Рустам' }, now);
});

describe('вход по ссылке', () => {
  it('верный код впускает', async () => {
    expect(await joinByCode(env.DB, 1, 'splav', now)).toEqual({ ok: true, community: 'splav' });
    expect(await isInAnyCommunity(env.DB, 1)).toBe(true);
  });

  it('чужой код не впускает', async () => {
    expect(await joinByCode(env.DB, 1, 'нетакого', now)).toEqual({ ok: false, reason: 'unknown_code' });
    expect(await isInAnyCommunity(env.DB, 1)).toBe(false);
  });

  it('повторный переход по ссылке не ломается и не плодит записей', async () => {
    await joinByCode(env.DB, 1, 'splav', now);
    expect(await joinByCode(env.DB, 1, 'splav', now + 100)).toEqual({ ok: true, community: 'splav' });
    expect(await membersCount(env.DB, 'splav')).toBe(1);
  });

  it('просроченная ссылка не впускает', async () => {
    await env.DB.prepare("UPDATE communities SET expires_at = ? WHERE id = 'splav'").bind(now - 1).run();
    expect(await joinByCode(env.DB, 1, 'splav', now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('потолок участников соблюдается', async () => {
    await env.DB.prepare("UPDATE communities SET max_members = 1 WHERE id = 'splav'").bind().run();
    await joinByCode(env.DB, 1, 'splav', now);
    expect(await joinByCode(env.DB, 2, 'splav', now)).toEqual({ ok: false, reason: 'full' });
  });

  it('уже вошедший проходит даже при заполненном потолке', async () => {
    await env.DB.prepare("UPDATE communities SET max_members = 1 WHERE id = 'splav'").bind().run();
    await joinByCode(env.DB, 1, 'splav', now);
    expect(await joinByCode(env.DB, 1, 'splav', now + 1)).toEqual({ ok: true, community: 'splav' });
  });

  it('сообщество игрока определяется', async () => {
    await joinByCode(env.DB, 2, 'splav', now);
    expect(await communityOf(env.DB, 2)).toBe('splav');
    expect(await communityOf(env.DB, 1)).toBeNull();
  });

  it('код не зависит от регистра и пробелов', async () => {
    expect(await joinByCode(env.DB, 1, '  SPLAV ', now)).toEqual({ ok: true, community: 'splav' });
  });
});
