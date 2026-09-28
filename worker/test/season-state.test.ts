import { describe, it, expect } from 'vitest';
import { seasonView, activeSeason, yearBounds, type Season } from '../src/season/state';

const SEASONS: Season[] = [
  { id: 'autumn-2026', title: 'Осень', starts_at: 1790802000, ends_at: 1798750800 },
  { id: 'winter-2027', title: 'Зима',  starts_at: 1798750800, ends_at: 1806526800 },
  { id: 'spring-2027', title: 'Весна', starts_at: 1806526800, ends_at: 1814389200 },
  { id: 'summer-2027', title: 'Лето',  starts_at: 1814389200, ends_at: 1822338000 },
];

describe('seasonView', () => {
  it('за секунду до старта — осень «до», день 0', () => {
    const v = seasonView(1790802000 - 1, SEASONS)!;
    expect(v.state).toBe('before');
    expect(v.id).toBe('autumn-2026');
    expect(v.day).toBe(0);
    expect(v.startsAt).toBe(1790802000);
  });

  it('ровно на старте — идёт, день 1 из 92', () => {
    const v = seasonView(1790802000, SEASONS)!;
    expect(v.state).toBe('active');
    expect(v.day).toBe(1);
    expect(v.days).toBe(92);
  });

  it('последняя секунда осени — день 92', () => {
    const v = seasonView(1798750800 - 1, SEASONS)!;
    expect(v.id).toBe('autumn-2026');
    expect(v.day).toBe(92);
  });

  it('ровно на границе начинается зима, день 1 из 90', () => {
    const v = seasonView(1798750800, SEASONS)!;
    expect(v.id).toBe('winter-2027');
    expect(v.state).toBe('active');
    expect(v.day).toBe(1);
    expect(v.days).toBe(90);
  });

  it('после лета — «закончился», последний сезон', () => {
    const v = seasonView(1822338000, SEASONS)!;
    expect(v.state).toBe('ended');
    expect(v.id).toBe('summer-2027');
    expect(v.day).toBe(v.days);
  });

  it('пустой список сезонов даёт null', () => {
    expect(seasonView(1, [])).toBeNull();
    expect(yearBounds([])).toBeNull();
  });
});

describe('activeSeason и yearBounds', () => {
  it('вне сезона активного нет', () => {
    expect(activeSeason(1790802000 - 1, SEASONS)).toBeNull();
    expect(activeSeason(1822338000, SEASONS)).toBeNull();
  });

  it('внутри сезона возвращает его', () => {
    expect(activeSeason(1806526800, SEASONS)?.id).toBe('spring-2027');
  });

  it('границы года — начало осени и конец лета', () => {
    expect(yearBounds(SEASONS)).toEqual({ startsAt: 1790802000, endsAt: 1822338000 });
  });
});
