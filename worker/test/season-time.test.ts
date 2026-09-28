import { describe, it, expect } from 'vitest';
import { mskDay, isoWeekKey, weekIndex, weekStart, WEEK_EPOCH, WEEK_SEC } from '../src/season/time';

const msk = (iso: string): number => Math.floor(new Date(`${iso}+03:00`).getTime() / 1000);

describe('московские сутки', () => {
  it('день считается по Москве, а не по UTC', () => {
    expect(mskDay(1790802000)).toBe('2026-10-01');
    expect(mskDay(1790802000 - 1)).toBe('2026-09-30');
    expect(mskDay(msk('2026-10-01T23:59:59'))).toBe('2026-10-01');
  });
});

describe('ISO-неделя', () => {
  it('1 октября 2026 — неделя W40', () => {
    expect(isoWeekKey(1790802000)).toBe('2026-W40');
  });

  it('с 28 декабря 2026 по 3 января 2027 идёт W53, дальше W01', () => {
    expect(isoWeekKey(msk('2026-12-28T00:00:00'))).toBe('2026-W53');
    expect(isoWeekKey(msk('2027-01-03T23:59:59'))).toBe('2026-W53');
    expect(isoWeekKey(msk('2027-01-04T00:00:00'))).toBe('2027-W01');
  });

  it('воскресенье и понедельник в разных неделях', () => {
    expect(isoWeekKey(msk('2026-10-04T23:59:59'))).toBe('2026-W40');
    expect(isoWeekKey(msk('2026-10-05T00:00:00'))).toBe('2026-W41');
  });
});

describe('индекс недели', () => {
  it('эталонный понедельник — 28 сентября 2026, 00:00 по Москве', () => {
    expect(WEEK_EPOCH).toBe(msk('2026-09-28T00:00:00'));
  });

  it('границы недель', () => {
    expect(weekIndex(WEEK_EPOCH)).toBe(0);
    expect(weekIndex(WEEK_EPOCH + WEEK_SEC - 1)).toBe(0);
    expect(weekIndex(WEEK_EPOCH + WEEK_SEC)).toBe(1);
    expect(weekIndex(WEEK_EPOCH - 1)).toBe(-1);
  });

  it('начало недели', () => {
    expect(weekStart(1790802000)).toBe(WEEK_EPOCH);
    expect(weekStart(WEEK_EPOCH + WEEK_SEC + 5)).toBe(WEEK_EPOCH + WEEK_SEC);
  });
});
