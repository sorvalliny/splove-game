import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../../js/season-format.js';

test('время финиша: минуты, секунды и десятые', () => {
  assert.equal(formatTime(192_400), '3:12,4');
  assert.equal(formatTime(59_990), '0:59,9');
  assert.equal(formatTime(60_000), '1:00,0');
  assert.equal(formatTime(3_600_000 + 5_000), '60:05,0');
});

test('время округляется вниз до десятых и не падает на мусоре', () => {
  assert.equal(formatTime(1_299), '0:01,2');
  assert.equal(formatTime(0), '0:00,0');
  assert.equal(formatTime(-5), '0:00,0');
  assert.equal(formatTime(NaN), '0:00,0');
});
