// בדיקות גרסאות אפיון (variants)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeVariants, variantKeywords, resolveVariant, applyVariantToMatch } from '../src/variants.js';

test('sanitizeVariants: מזהים ייחודיים + חיתוך + מזהה אוטומטי', () => {
  const out = sanitizeVariants([
    { id: 'girls', label: 'בנות', matchText: 'לבנות' },
    { label: 'ללא-מזהה', matchText: 'נשים' }, // יקבל מזהה אוטומטי
    { id: 'girls', label: 'כפול' }, // מזהה כפול — מדולג
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'girls');
  assert.ok(out[1].id, 'מזהה אוטומטי הוקצה');
  assert.notEqual(out[1].id, 'girls');
});

test('sanitizeVariants: קלט לא-מערך => fallback', () => {
  assert.deepEqual(sanitizeVariants(null, [{ id: 'x', label: 'x', matchText: '' }]), [{ id: 'x', label: 'x', matchText: '' }]);
});

test('variantKeywords: פיצול לפי פסיקים + ניקוי', () => {
  assert.deepEqual(variantKeywords({ matchText: 'לבנות, נשים ,  ' }), ['לבנות', 'נשים']);
  assert.deepEqual(variantKeywords({ matchText: '' }), []);
});

const VARIANTS = [
  { id: 'girls', label: 'בנות', matchText: 'לבנות, נשים' },
  { id: 'kids', label: 'ילדים', matchText: 'ילדים' },
];

test('resolveVariant: לפי מילת-מפתח בשם המשחק', () => {
  assert.equal(resolveVariant('סינק לבנות', VARIANTS), 'girls');
  assert.equal(resolveVariant('אירוע נשים', VARIANTS), 'girls');
  assert.equal(resolveVariant('סינק ילדים', VARIANTS), 'kids');
  assert.equal(resolveVariant('סינק', VARIANTS), null); // ברירת מחדל
  assert.equal(resolveVariant('', VARIANTS), null);
  assert.equal(resolveVariant('סינק', []), null);
});

test('resolveVariant: הגרסה הראשונה שמתאימה מנצחת', () => {
  const vs = [
    { id: 'a', matchText: 'סינק' },
    { id: 'b', matchText: 'לבנות' },
  ];
  // "סינק לבנות" מכיל את שתי המילים — 'a' ראשון בסדר => מנצח
  assert.equal(resolveVariant('סינק לבנות', vs), 'a');
});

test('applyVariantToMatch: מחליף שם+תיאור, שומר מספר, לא מבצע מוטציה', () => {
  const match = { id: 't1', name: 'הלוחם', description: 'לשון זכר', number: 5, similarity: 90 };
  const personality = { id: 't1', variantTexts: { girls: { name: 'הלוחמת', description: 'לשון נקבה' } } };
  const out = applyVariantToMatch(match, personality, 'girls');
  assert.equal(out.name, 'הלוחמת');
  assert.equal(out.description, 'לשון נקבה');
  assert.equal(out.number, 5, 'המספר לא משתנה');
  assert.equal(match.name, 'הלוחם', 'האובייקט המקורי לא שונה');
});

test('applyVariantToMatch: שם ריק בגרסה => שומר את שם ברירת המחדל', () => {
  const match = { name: 'הלוחם', description: 'זכר', number: 5 };
  const personality = { variantTexts: { girls: { name: '', description: 'נקבה' } } };
  const out = applyVariantToMatch(match, personality, 'girls');
  assert.equal(out.name, 'הלוחם', 'שם ריק לא דורס');
  assert.equal(out.description, 'נקבה');
});

test('applyVariantToMatch: אין variantTexts / אין variantId => ללא שינוי', () => {
  const match = { name: 'הלוחם', description: 'זכר', number: 5 };
  assert.deepEqual(applyVariantToMatch(match, { id: 't' }, 'girls'), match);
  assert.deepEqual(applyVariantToMatch(match, { variantTexts: { girls: { name: 'x' } } }, null), match);
});
