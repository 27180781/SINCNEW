// בדיקות מיפוי היסודות (Excel/CSV -> שאלות)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXlsx } from '../src/xlsx.js';
import { parseCsv, rowsToQuestions, normalizeElement } from '../src/mapping.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LABELS = { אש: 'fire', מים: 'water', רוח: 'air', עפר: 'earth' };
const KEYS = ['fire', 'water', 'air', 'earth'];

test('normalizeElement: אנגלית, עברית, כינויים, לא-תקין', () => {
  assert.equal(normalizeElement('fire', KEYS, LABELS), 'fire');
  assert.equal(normalizeElement('WATER', KEYS, LABELS), 'water');
  assert.equal(normalizeElement('אש', KEYS, LABELS), 'fire');
  assert.equal(normalizeElement('רוח', KEYS, LABELS), 'air');
  assert.equal(normalizeElement('wind', KEYS, LABELS), 'air');
  assert.equal(normalizeElement('בלה', KEYS, LABELS), null);
  assert.equal(normalizeElement('', KEYS, LABELS), null);
});

test('parseCsv: שורות ותאים', () => {
  const rows = parseCsv('מספר שאלה,תשובה 1,תשובה 2\n7,water,fire\n8,fire,earth\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['7', 'water', 'fire']);
});

test('rowsToQuestions: זיהוי כותרת + מיפוי queId/answerId', () => {
  const rows = [
    ['מספר שאלה', 'תשובה 1', 'תשובה 2', 'תשובה 3', 'תשובה 4'],
    ['7', 'water', 'fire', 'earth', 'air'],
    ['10', 'earth', 'fire', 'water', 'air'],
  ];
  const { questions, warnings } = rowsToQuestions(rows, { validKeys: KEYS, labelToKey: LABELS });
  assert.equal(warnings.length, 0);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].queId, 7);
  assert.equal(questions[0].order, 1);
  assert.equal(questions[0].options[0].answerId, 1);
  assert.equal(questions[0].options[0].element, 'water');
  assert.equal(questions[0].options[1].element, 'fire');
  assert.equal(questions[1].queId, 10);
  assert.equal(questions[1].options[0].element, 'earth');
});

test('rowsToQuestions: שורה עם queId לא-תקין מדולגת עם אזהרה', () => {
  const rows = [['x', 'fire'], ['5', 'water', 'fire']];
  const { questions, warnings } = rowsToQuestions(rows, { validKeys: KEYS, labelToKey: LABELS });
  // 'x' אינו מספר => שורת כותרת (start=1), נשארת שאלה אחת (5)
  assert.equal(questions.length, 1);
  assert.equal(questions[0].queId, 5);
});

test('rowsToQuestions: יסוד לא מוכר -> אזהרה, element ריק', () => {
  const rows = [['7', 'water', 'לאיסוד']];
  const { questions, warnings } = rowsToQuestions(rows, { validKeys: KEYS, labelToKey: LABELS });
  assert.equal(questions[0].options[1].element, '');
  assert.ok(warnings.some((w) => w.includes('לא מוכר')));
});

test('rowsToQuestions: שמירת טקסט/מזהה של שאלה קיימת (merge)', () => {
  const rows = [['7', 'fire', 'water']];
  const existingByQueId = { 7: { id: 'q_existing', text: 'שאלה קיימת', order: 3 } };
  const { questions } = rowsToQuestions(rows, { validKeys: KEYS, labelToKey: LABELS, existingByQueId });
  assert.equal(questions[0].id, 'q_existing');
  assert.equal(questions[0].text, 'שאלה קיימת');
});

test('parseXlsx + rowsToQuestions: הקובץ האמיתי -> 44 שאלות תקינות', () => {
  const buf = readFileSync(join(__dirname, 'fixtures', 'mapping-example.xlsx'));
  const rows = parseXlsx(buf);
  assert.equal(rows[0][0], 'מספר שאלה');
  const { questions, warnings } = rowsToQuestions(rows, { validKeys: KEYS, labelToKey: LABELS });
  assert.equal(questions.length, 44);
  assert.equal(warnings.length, 0);
  // queId 7 -> water,fire,earth,air
  const q7 = questions.find((q) => q.queId === 7);
  assert.deepEqual(q7.options.map((o) => o.element), ['water', 'fire', 'earth', 'air']);
  // כל האפשרויות עם יסוד תקין
  const bad = questions.flatMap((q) => q.options).filter((o) => !KEYS.includes(o.element));
  assert.equal(bad.length, 0);
});
