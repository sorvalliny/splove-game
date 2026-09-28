import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGame } from './harness.mjs';
import { stageZeroRun } from './fingerprint.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('./golden-stage0.json', import.meta.url), 'utf8'));

// Ступени, пасхалки и новые препятствия не должны менять ни одного числа до первого лагеря.
// Если тест краснеет, значит новая фича тратит rnd() или меняет физику на нулевой ступени.
for (const g of golden.runs) {
  test(`нулевая ступень не изменилась: сид ${g.seed}, ${g.level}`, () => {
    const { t } = loadGame();
    const now = stageZeroRun(t, g.seed, g.level);
    assert.equal(now.stage, 0, 'до первого лагеря ступень нулевая');
    assert.equal(now.steps, g.steps, 'число шагов до 380 м');
    assert.deepEqual(now.snapshot, g.snapshot);
  });
}
