import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Telegram = { WebApp: { initData: 'x', ready() {}, expand() {} } };
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
const { rowHtml, meRowHtml } = await import('../../js/board.js');

test('очки: место, имя, банк', () => {
  const html = rowHtml('points', { tg_id: 1, name: 'Аня', bank: 1234 }, 1, 9);
  assert.match(html, /<b>1<\/b>/);
  assert.match(html, /Аня/);
  assert.match(html, /1\s234/);
});

test('время: показывается м:сс,д, а не банк', () => {
  const html = rowHtml('time', { tg_id: 1, name: 'Аня', time_ms: 192_400 }, 2, 9);
  assert.match(html, /3:12,4/);
});

test('своя строка подсвечена в обоих видах', () => {
  assert.match(rowHtml('points', { tg_id: 9, name: 'Я', bank: 1 }, 1, 9), /class="me"/);
  assert.match(rowHtml('time', { tg_id: 9, name: 'Я', time_ms: 1000 }, 1, 9), /class="me"/);
});

test('строка «Ты» под таблицей для очков и времени', () => {
  assert.match(meRowHtml('points', { rank: 7, bank: 500 }), /<b>7<\/b>[\s\S]*Ты[\s\S]*500/);
  assert.match(meRowHtml('time', { rank: 4, timeMs: 200_000 }), /<b>4<\/b>[\s\S]*Ты[\s\S]*3:20,0/);
});

test('имя игрока экранируется', () => {
  assert.doesNotMatch(rowHtml('points', { tg_id: 1, name: '<img>', bank: 1 }, 1, 9), /<img>/);
});
