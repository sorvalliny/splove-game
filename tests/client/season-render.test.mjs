import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questsHtml, boardHtml, champsHtml, weekBoardHtml } from '../../js/season-render.js';

const quest = (over = {}) => ({ id: 'gena', title: 'Подобрать Гену', goal: 1, progress: 0, done: false, points: 150, ...over });

test('задание показывает название, баллы, полосу и прогресс', () => {
  const html = questsHtml([quest({ goal: 10, progress: 4, points: 100, title: 'Собрать 10 бутылок' })]);
  assert.match(html, /Собрать 10 бутылок/);
  assert.match(html, /\+100/);
  assert.match(html, /width:40%/);
  assert.match(html, /4 \/ 10/);
});

test('выполненное задание помечено и полоса полная', () => {
  const html = questsHtml([quest({ done: true, progress: 1 })]);
  assert.match(html, /class="q done"/);
  assert.match(html, /width:100%/);
  assert.match(html, /выполнено/);
});

test('большие числа прогресса форматируются по-русски', () => {
  const html = questsHtml([quest({ goal: 2000, progress: 1200, title: 'Проплыть 2 км за неделю' })]);
  assert.match(html, /1\s200 \/ 2\s000/);
});

test('без заданий выводится пояснение, а не пустота', () => {
  assert.match(questsHtml([]), /Задания появятся с началом сезона/);
});

test('названия заданий экранируются', () => {
  const html = questsHtml([quest({ title: '<img src=x onerror=alert(1)>' })]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('таблица: места, имена, баллы; своя строка подсвечена', () => {
  const html = boardHtml([
    { name: 'Гена', points: 500, isMe: false },
    { name: 'Виктор', points: 300, isMe: true },
  ]);
  assert.match(html, /<b>1<\/b>[\s\S]*Гена[\s\S]*500/);
  assert.match(html, /<li class="me">[\s\S]*<b>2<\/b>[\s\S]*Виктор/);
});

test('пустая таблица сообщает, что баллов ни у кого нет', () => {
  assert.match(boardHtml([]), /Баллов пока ни у кого нет/);
});

test('имена в таблице экранируются', () => {
  const html = boardHtml([{ name: '<script>x</script>', points: 1, isMe: false }]);
  assert.doesNotMatch(html, /<script>/);
});

test('титулы чемпионов: сезон и имя; без чемпионов пусто', () => {
  const html = champsHtml([{ seasonId: 'autumn-2026', title: 'Осень', name: 'Гена' }]);
  assert.match(html, /Осень/);
  assert.match(html, /Гена/);
  assert.equal(champsHtml([]), '');
});

test('таблица недели: места, имена, банк, своя строка подсвечена', () => {
  const html = weekBoardHtml([{ name: 'Аня', bank: 900, isMe: false }, { name: 'Виктор', bank: 700, isMe: true }]);
  assert.match(html, /<b>1<\/b>[\s\S]*Аня[\s\S]*900/);
  assert.match(html, /<li class="me">[\s\S]*<b>2<\/b>[\s\S]*Виктор/);
});

test('пустая таблица недели и экранирование имён', () => {
  assert.match(weekBoardHtml([]), /На этой неделе ещё никто не плавал/);
  assert.doesNotMatch(weekBoardHtml([{ name: '<img>', bank: 1, isMe: false }]), /<img>/);
});
