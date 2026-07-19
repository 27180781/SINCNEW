// בדיקות ייבוא סוגי אישיות מ-Excel/CSV
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { rowsToPersonalities, parsePersonalitiesInput } from '../src/personalities-import.js';
import { parseXlsx } from '../src/xlsx.js';

const HEADER = ['מספר אישיות', 'שם אישיות (אופציונלי)', 'אחוז אש', 'אחוז מים', 'אחוז רוח', 'אחוז עפר', 'תיאור'];

test('rowsToPersonalities: זיהוי עמודות לפי כותרת', () => {
  const rows = [HEADER, ['1', '', '85', '5', '5', '5', 'תיאור מלא של האישיות']];
  const { personalities } = rowsToPersonalities(rows);
  assert.equal(personalities.length, 1);
  const p = personalities[0];
  assert.equal(p.number, 1);
  assert.deepEqual(p.profile, { fire: 85, water: 5, air: 5, earth: 5 });
  assert.equal(p.description, 'תיאור מלא של האישיות');
  assert.equal(p.name, 'אש 1'); // שם ריק => לפי יסוד דומיננטי + מספר
});

test('rowsToPersonalities: שם מפורש נשמר', () => {
  const rows = [HEADER, ['2', 'הזורם', '5', '85', '5', '5', 'תיאור']];
  const p = rowsToPersonalities(rows).personalities[0];
  assert.equal(p.name, 'הזורם');
  assert.equal(p.profile.water, 85);
});

test('rowsToPersonalities: מדלג על שורות ריקות ואחוזי-אפס', () => {
  const rows = [HEADER, ['3', '', '0', '0', '0', '0', 'ריק'], ['', '', '', '', '', '', ''], ['4', '', '10', '20', '30', '40', 'ok']];
  const { personalities, warnings } = rowsToPersonalities(rows);
  assert.equal(personalities.length, 1);
  assert.equal(personalities[0].number, 4);
  assert.ok(warnings.some((w) => w.includes('דולגה')));
});

test('rowsToPersonalities: מיקום קבוע ללא כותרת', () => {
  const rows = [['1', 'ללא כותרת', '25', '25', '25', '25', 'תיאור']];
  const p = rowsToPersonalities(rows).personalities[0];
  assert.equal(p.number, 1);
  assert.equal(p.name, 'ללא כותרת');
  assert.deepEqual(p.profile, { fire: 25, water: 25, air: 25, earth: 25 });
});

test('rowsToPersonalities: אחוזים עם סימן % ופסיק עשרוני', () => {
  const rows = [HEADER, ['5', '', '70%', '15', '10', '5', 't']];
  const p = rowsToPersonalities(rows).personalities[0];
  assert.equal(p.profile.fire, 70);
});

test('parsePersonalitiesInput: מזהה xlsx לפי חתימת ZIP', () => {
  // מוודא שהזרימה dataBase64 -> parseXlsx -> rowsToPersonalities עובדת מקצה לקצה
  const csv = HEADER.join(',') + '\n' + '1,,85,5,5,5,"תיאור, עם פסיק"\n';
  const dataBase64 = Buffer.from(csv, 'utf8').toString('base64');
  const { personalities } = parsePersonalitiesInput({ dataBase64 }, parseXlsx);
  assert.equal(personalities.length, 1);
  assert.equal(personalities[0].description, 'תיאור, עם פסיק');
});
