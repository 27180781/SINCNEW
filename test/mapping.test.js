// בדיקות מיפוי היסודות (Excel/CSV -> שאלות)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXlsx } from '../src/xlsx.js';
import { parseCsv, rowsToQuestions, normalizeElement, mappingObjectsToQuestions } from '../src/mapping.js';

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

test('mappingObjectsToQuestions: פורמט JSON עם question_id/question_text/answers_mapping', () => {
  const items = [
    { question_id: 'q7', question_text: 'באיזה דלת תבחר', answers_mapping: { '1': 'water', '2': 'fire', '3': 'earth', '4': 'air' } },
    { question_id: 'q8', question_text: 'נטרול פצצה', answers_mapping: { '1': 'fire', '2': 'earth', '3': 'air', '4': 'water' } },
  ];
  const { questions, warnings } = mappingObjectsToQuestions(items, { validKeys: KEYS, labelToKey: LABELS });
  assert.equal(warnings.length, 0);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].queId, 7, 'q7 -> queId 7');
  assert.equal(questions[0].id, 'q7');
  assert.equal(questions[0].text, 'באיזה דלת תבחר');
  assert.equal(questions[0].options.length, 4);
  // answerId 1 -> water, וכו' (לפי סדר מספרי)
  assert.deepEqual(questions[0].options.map((o) => [o.answerId, o.element]), [[1, 'water'], [2, 'fire'], [3, 'earth'], [4, 'air']]);
});

test('mappingObjectsToQuestions: מפתחות תשובה לא-ממוינים -> ממוינים לפי מספר', () => {
  const items = [{ question_id: 'q9', answers_mapping: { '3': 'air', '1': 'fire', '4': 'water', '2': 'earth' } }];
  const { questions } = mappingObjectsToQuestions(items, { validKeys: KEYS, labelToKey: LABELS });
  assert.deepEqual(questions[0].options.map((o) => o.answerId), [1, 2, 3, 4]);
  assert.deepEqual(questions[0].options.map((o) => o.element), ['fire', 'earth', 'air', 'water']);
});

test('mappingObjectsToQuestions: question_id ללא ספרות / יסוד לא מוכר -> אזהרות', () => {
  const items = [
    { question_id: 'xx', answers_mapping: { '1': 'fire' } },        // אין מספר -> דולג
    { question_id: 'q5', answers_mapping: { '1': 'lava', '2': 'water' } }, // יסוד לא מוכר
  ];
  const { questions, warnings } = mappingObjectsToQuestions(items, { validKeys: KEYS, labelToKey: LABELS });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].queId, 5);
  assert.equal(questions[0].options[0].element, ''); // lava לא זוהה
  assert.ok(warnings.some((w) => w.includes('question_id')));
  assert.ok(warnings.some((w) => w.includes('lava')));
});

test('mappingObjectsToQuestions: תווית עברית ליסוד', () => {
  const items = [{ question_id: 'q3', answers_mapping: { '1': 'אש', '2': 'מים', '3': 'רוח', '4': 'עפר' } }];
  const { questions } = mappingObjectsToQuestions(items, { validKeys: KEYS, labelToKey: LABELS });
  assert.deepEqual(questions[0].options.map((o) => o.element), ['fire', 'water', 'air', 'earth']);
});

test('mappingObjectsToQuestions: שמירת מזהה של שאלה קיימת (merge לפי queId)', () => {
  const existingByQueId = { 7: { id: 'existing-id-7', text: 'טקסט קיים' } };
  const items = [{ question_id: 'q7', answers_mapping: { '1': 'fire' } }]; // ללא question_text
  const { questions } = mappingObjectsToQuestions(items, { validKeys: KEYS, labelToKey: LABELS, existingByQueId });
  assert.equal(questions[0].id, 'existing-id-7', 'שומר מזהה קיים');
  assert.equal(questions[0].text, 'טקסט קיים', 'שומר טקסט קיים כשלא סופק חדש');
});

test('mappingObjectsToQuestions: answers_mapping חסר -> אזהרה + options ריק + noMapping', () => {
  for (const item of [{ question_id: 'q7' }, { question_id: 'q7', answers_mapping: null }, { question_id: 'q7', answers_mapping: {} }]) {
    const { questions, warnings } = mappingObjectsToQuestions([item], { validKeys: KEYS, labelToKey: LABELS });
    assert.equal(questions.length, 1);
    assert.equal(questions[0].options.length, 0);
    assert.equal(questions[0].noMapping, true);
    assert.ok(warnings.some((w) => w.includes('answers_mapping')), `warning for ${JSON.stringify(item)}`);
  }
});

test('mappingObjectsToQuestions: מיון מספרי אמיתי ל->9 תשובות (1..12, לא לקסיקוגרפי)', () => {
  const answers_mapping = {};
  for (let k = 1; k <= 12; k++) answers_mapping[String(k)] = KEYS[(k - 1) % 4];
  const { questions } = mappingObjectsToQuestions([{ question_id: 'q7', answers_mapping }], { validKeys: KEYS, labelToKey: LABELS });
  assert.deepEqual(questions[0].options.map((o) => o.answerId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  // אלמנט תשובה 10 חייב להיות KEYS[9%4]=KEYS[1]=water (לא זה של "2" אילו מוין לקסיקוגרפית)
  assert.equal(questions[0].options[9].answerId, 10);
  assert.equal(questions[0].options[9].element, KEYS[9 % 4]);
});
