import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown } from '../../js/season-format.js';

const ms = (d, h, m, s) => (((d * 24 + h) * 60 + m) * 60 + s) * 1000;

test('ноль и отрицательное время дают нули', () => {
  assert.equal(formatCountdown(0), '00:00:00');
  assert.equal(formatCountdown(-5000), '00:00:00');
});

test('меньше суток — без дней', () => {
  assert.equal(formatCountdown(1000), '00:00:01');
  assert.equal(formatCountdown(ms(0, 1, 1, 1)), '01:01:01');
  assert.equal(formatCountdown(ms(0, 23, 59, 59)), '23:59:59');
});

test('сутки и больше — с днями', () => {
  assert.equal(formatCountdown(ms(1, 0, 0, 0)), '1д 00:00:00');
  assert.equal(formatCountdown(ms(2, 3, 14, 22)), '2д 03:14:22');
});

test('доли секунды округляются вверх, чтобы таймер не показывал ноль раньше времени', () => {
  assert.equal(formatCountdown(1), '00:00:01');
  assert.equal(formatCountdown(999), '00:00:01');
});
