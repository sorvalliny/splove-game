import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './harness.mjs';

test('HUD виден только во время заплыва (play и dying), не в меню/итогах/рейтинге', () => {
  const { t } = loadGame();
  for (const s of ['menu', 'over', 'finish']) { t.setState(s); assert.equal(t.hudVisible(), false, s); }
  for (const s of ['play', 'dying']) { t.setState(s); assert.equal(t.hudVisible(), true, s); }
});
