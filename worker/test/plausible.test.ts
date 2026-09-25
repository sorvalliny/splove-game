import { describe, it, expect } from 'vitest';
import { checkRun, MAX_MPS, MAX_POINTS_PER_METER } from '../src/game/plausible';

const good = {
  level: 'normal' as const,
  bank: 300,
  onboard: 40,
  meters: 500,
  durationMs: 60_000,
  oarsLost: 2,
  startedAt: 1_700_000_000_000,
};

const now = good.startedAt + good.durationMs;

describe('правдоподобие заплыва', () => {
  it('честный заплыв проходит', () => {
    expect(checkRun(good, now)).toBeNull();
  });

  it('скорость выше физически возможной отклоняется', () => {
    const fast = { ...good, meters: Math.ceil(MAX_MPS * 60) + 100 };
    expect(checkRun(fast, now)).toBe('too_fast');
  });

  it('предельная скорость ещё проходит', () => {
    const edge = { ...good, meters: Math.floor(MAX_MPS * 60) };
    expect(checkRun(edge, now)).toBeNull();
  });

  it('очков больше, чем можно собрать на дистанции, отклоняется', () => {
    const rich = { ...good, bank: MAX_POINTS_PER_METER * good.meters + 1, onboard: 0 };
    expect(checkRun(rich, now)).toBe('too_rich');
  });

  it('очки считаются вместе с несданными на берегу', () => {
    const half = MAX_POINTS_PER_METER * good.meters;
    expect(checkRun({ ...good, bank: half, onboard: 1 }, now)).toBe('too_rich');
  });

  it('слишком короткий заплыв отклоняется', () => {
    expect(checkRun({ ...good, durationMs: 4_999, meters: 10 }, now)).toBe('too_short');
  });

  it('дробные и отрицательные числа отклоняются', () => {
    expect(checkRun({ ...good, bank: 1.5 }, now)).toBe('bad_numbers');
    expect(checkRun({ ...good, meters: -1 }, now)).toBe('bad_numbers');
    expect(checkRun({ ...good, oarsLost: Number.NaN }, now)).toBe('bad_numbers');
  });

  it('неизвестный уровень отклоняется', () => {
    expect(checkRun({ ...good, level: 'insane' as never }, now)).toBe('bad_level');
  });

  it('метка времени из будущего отклоняется', () => {
    const future = { ...good, startedAt: now + 6 * 60 * 1000 };
    expect(checkRun(future, now)).toBe('bad_clock');
  });

  it('небольшое расхождение часов прощается', () => {
    const skewed = { ...good, startedAt: now + 60 * 1000 };
    expect(checkRun(skewed, now)).toBeNull();
  });

  it('слишком старая метка времени отклоняется', () => {
    const ancient = { ...good, startedAt: now - 31 * 24 * 3600 * 1000 };
    expect(checkRun(ancient, now)).toBe('bad_clock');
  });
});
