import { describe, it, expect } from 'vitest';
import { sanitizeStats, ZERO_STATS } from '../src/game/stats';

describe('sanitizeStats', () => {
  it('честные данные проходят как есть', () => {
    expect(sanitizeStats({ gena: 1, bottles: 12, camps: 2 }, 1500)).toEqual({ gena: 1, bottles: 12, camps: 2, sanchez: 0 });
  });

  it('слишком много бутылок на дистанции обнуляет всё', () => {
    const meters = 540;
    const max = Math.floor(meters / 27) + 2;
    expect(sanitizeStats({ gena: 0, bottles: max, camps: 1 }, meters).bottles).toBe(max);
    expect(sanitizeStats({ gena: 1, bottles: max + 1, camps: 1 }, meters)).toEqual(ZERO_STATS);
  });

  it('Гена: первый не раньше 540 м, дальше не чаще раза на километр', () => {
    expect(sanitizeStats({ gena: 1, bottles: 0, camps: 0 }, 539)).toEqual(ZERO_STATS);
    expect(sanitizeStats({ gena: 1, bottles: 0, camps: 0 }, 540).gena).toBe(1);
    expect(sanitizeStats({ gena: 2, bottles: 0, camps: 0 }, 1539)).toEqual(ZERO_STATS);
    expect(sanitizeStats({ gena: 2, bottles: 0, camps: 0 }, 1540).gena).toBe(2);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0 }, 100).gena).toBe(0);
  });

  it('лагеря считаются по расстановке: первый на 400 м, дальше через 500', () => {
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 1 }, 400).camps).toBe(1);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 1 }, 399)).toEqual(ZERO_STATS);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 2 }, 900).camps).toBe(2);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 3 }, 1000)).toEqual(ZERO_STATS);
  });

  it.each([
    ['дробное', { gena: 0.5, bottles: 0, camps: 0 }],
    ['отрицательное', { gena: 0, bottles: -1, camps: 0 }],
    ['строка', { gena: '1', bottles: 0, camps: 0 }],
    ['нет поля', { gena: 0, bottles: 0 }],
  ])('%s значение обнуляет', (_n, raw) => {
    expect(sanitizeStats(raw, 5000)).toEqual(ZERO_STATS);
  });

  it.each([[null], [undefined], ['x'], [42], [[]]])('не объект (%j) даёт нули', (raw) => {
    expect(sanitizeStats(raw, 5000)).toEqual(ZERO_STATS);
  });

  it('Санчез: поле необязательно, первый не раньше 1800 м, дальше не чаще раза в 2 км', () => {
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0 }, 500).sanchez).toBe(0);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0, sanchez: 1 }, 1799)).toEqual(ZERO_STATS);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0, sanchez: 1 }, 1800).sanchez).toBe(1);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0, sanchez: 2 }, 3799)).toEqual(ZERO_STATS);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0, sanchez: 2 }, 3800).sanchez).toBe(2);
  });

  it('Санчез дробный или строкой обнуляет всё', () => {
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0, sanchez: 0.5 }, 9000)).toEqual(ZERO_STATS);
    expect(sanitizeStats({ gena: 0, bottles: 0, camps: 0, sanchez: '1' }, 9000)).toEqual(ZERO_STATS);
  });
});
