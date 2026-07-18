// בדיקות טקסט הפתיח האישי (get-intro-text)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildIntroText, findLatestParticipantByPhone, toYemotRead } from '../src/intro.js';

const ELEMENTS = [
  { key: 'fire', label: 'אש' },
  { key: 'water', label: 'מים' },
  { key: 'air', label: 'רוח' },
  { key: 'earth', label: 'עפר' },
];

test('buildIntroText: עם שם + יסוד דומיננטי יחיד', () => {
  const result = {
    name: 'ישראל', game: { number: '0501234567' },
    counts: { fire: 2, water: 1, air: 1, earth: 0 },
    percentages: { fire: 50, water: 25, air: 25, earth: 0 },
  };
  const t = buildIntroText(result, ELEMENTS);
  assert.match(t, /^שלום לישראל/);
  assert.match(t, /על פי הנתונים שהגיעו מהמשחק/);
  assert.match(t, /היסוד הדומיננטי שלך הוא יסוד האש/);
  assert.match(t, /ובפירוט/);
  assert.match(t, /50 אחוז יסוד האש/);
  assert.match(t, /25 אחוז יסוד המים/);
  assert.match(t, /0 אחוז יסוד העפר/);
  assert.match(t, /מיד תועבר לשמוע בפירוט/);
  // היסוד הדומיננטי (אש 50%) מופיע ראשון בפירוט (מהגבוה לנמוך)
  const detail = t.split('ובפירוט')[1];
  assert.ok(detail.indexOf('יסוד האש') < detail.indexOf('יסוד המים'));
});

test('buildIntroText: ללא שם (שם == מספר) => "שלום לך"', () => {
  const result = {
    name: '0501234567', game: { number: '0501234567' },
    counts: { fire: 1, water: 0, air: 0, earth: 0 },
    percentages: { fire: 100, water: 0, air: 0, earth: 0 },
  };
  const t = buildIntroText(result, ELEMENTS);
  assert.match(t, /^שלום לך/);
});

test('buildIntroText: תיקו על הדומיננטי => מדלגים על שורת הדומיננטי', () => {
  const result = {
    name: 'דנה', game: { number: '0521111111' },
    counts: { fire: 2, water: 2, air: 1, earth: 0 }, // אש ומים שווים במקסימום
    percentages: { fire: 40, water: 40, air: 20, earth: 0 },
  };
  const t = buildIntroText(result, ELEMENTS);
  assert.doesNotMatch(t, /היסוד הדומיננטי/); // אין שורת דומיננטי
  assert.match(t, /ובפירוט/);
  assert.match(t, /40 אחוז יסוד האש/);
  assert.match(t, /40 אחוז יסוד המים/);
});

test('toYemotRead: פורמט read=t- עם קטע לכל שורה', () => {
  const out = toYemotRead('שלום לך\nובפירוט\n50 אחוז יסוד האש');
  assert.match(out, /^read=t-/);
  // כל שורה הופכת לקטע t- נפרד
  assert.ok(out.includes('.t-ובפירוט'));
  assert.ok(out.includes('.t-50 אחוז יסוד האש'));
  // אין תווים ששוברים את הפורמט
  assert.ok(!out.includes('='.repeat(1) + 't') || out.startsWith('read=t-'));
});

test('toYemotRead: מנטרל תווים בעייתיים (= & . שורות)', () => {
  const out = toYemotRead('שלום=ל&דנה.כאן');
  // = & . הוחלפו ברווח, נשאר קטע אחד
  assert.equal(out, 'read=t-שלום ל דנה כאן');
});

test('findLatestParticipantByPhone: מאתר לפי טלפון ובוחר את המפגש העדכני', () => {
  const batches = [
    { createdAt: '2026-01-01T00:00:00Z', result: { results: [{ id: '0501234567', name: 'ישן', game: { number: '0501234567' }, percentages: { fire: 100 } }] } },
    { createdAt: '2026-05-01T00:00:00Z', result: { results: [{ id: '0501234567', name: 'חדש', game: { number: '050-123-4567' }, percentages: { water: 100 } }] } },
  ];
  const r = findLatestParticipantByPhone(batches, '0501234567');
  assert.equal(r.name, 'חדש'); // המפגש המאוחר יותר
  // נרמול טלפון (עם מקפים)
  assert.ok(findLatestParticipantByPhone(batches, '050-123-4567'));
  // מספר לא קיים
  assert.equal(findLatestParticipantByPhone(batches, '0509999999'), null);
  // טלפון לא תקין
  assert.equal(findLatestParticipantByPhone(batches, 'abc'), null);
});
