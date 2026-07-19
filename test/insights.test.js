// בדיקות תובנות אישיות + קודים אישיים + איתור לפי טלפון/קוד
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resultKey,
  assignPersonalCodes,
  findByPhone,
  findByPersonalCode,
  computeInsights,
} from '../src/insights.js';

const KEYS = ['fire', 'water', 'air', 'earth'];

// עוזר: בונה תוצאת משתתף
function R({ id, name, phone, code, pct, dominant, answered = 4 }) {
  return {
    id: id ?? phone ?? code ?? name,
    name: name ?? null,
    personalCode: code ?? undefined,
    answered,
    percentages: pct,
    percentagesRaw: pct,
    dominant,
    game: { number: phone ?? '' },
  };
}

test('resultKey: טלפון גובר על קוד/מזהה', () => {
  assert.equal(resultKey(R({ phone: '0501234567', pct: {} })), 'p:0501234567');
  assert.equal(resultKey({ personalCode: '1001', game: {} }), 'c:1001');
  assert.equal(resultKey({ id: 'x9', game: {} }), 'i:x9');
});

test('assignPersonalCodes: מקצה קוד רק לחסרי-טלפון, בהמשך למקסימום', () => {
  const results = [
    R({ name: 'יוסי', phone: '0501111111', pct: { fire: 100 } }), // יש טלפון -> ללא קוד
    R({ name: 'משה', pct: { water: 100 } }),                       // ללא טלפון -> קוד
    R({ name: 'רותי', pct: { air: 100 } }),                        // ללא טלפון -> קוד
  ];
  const existing = [{ result: { results: [{ personalCode: '1004' }] } }];
  assignPersonalCodes(results, existing);
  assert.equal(results[0].personalCode, undefined);
  assert.equal(results[1].personalCode, '1005');
  assert.equal(results[2].personalCode, '1006');
});

test('assignPersonalCodes: ברירת מחדל מתחילה ב-1001', () => {
  const results = [R({ name: 'א', pct: { fire: 100 } })];
  assignPersonalCodes(results, []);
  assert.equal(results[0].personalCode, '1001');
});

test('findByPhone: מחזיר את המפגש העדכני ביותר', () => {
  const batches = [
    { createdAt: '2024-01-01T00:00:00Z', result: { results: [R({ phone: '0502222222', name: 'ישן', pct: { fire: 100 }, dominant: 'fire' })] } },
    { createdAt: '2024-06-01T00:00:00Z', result: { results: [R({ phone: '0502222222', name: 'חדש', pct: { water: 100 }, dominant: 'water' })] } },
  ];
  const found = findByPhone(batches, '050-222-2222');
  assert.equal(found.result.name, 'חדש');
  assert.equal(found.batch.createdAt, '2024-06-01T00:00:00Z');
});

test('findByPersonalCode: איתור לפי קוד', () => {
  const batches = [
    { createdAt: '2024-06-01T00:00:00Z', result: { results: [R({ code: '1005', name: 'משה', pct: { water: 100 }, dominant: 'water' })] } },
  ];
  assert.equal(findByPersonalCode(batches, '1005').result.name, 'משה');
  assert.equal(findByPersonalCode(batches, '9999'), null);
});

test('computeInsights: אחוזי קבוצה, כלל-מערכת, והקרוב ביותר', () => {
  const target = R({ phone: '0501000000', name: 'מטרה', pct: { fire: 80, water: 20, air: 0, earth: 0 }, dominant: 'fire' });
  const groupOthers = [
    R({ phone: '0501000001', name: 'דומה', pct: { fire: 75, water: 25, air: 0, earth: 0 }, dominant: 'fire' }),
    R({ phone: '0501000002', name: 'שונה', pct: { earth: 100, fire: 0, water: 0, air: 0 }, dominant: 'earth' }),
  ];
  const batch = { createdAt: '2024-06-01T00:00:00Z', result: { results: [target, ...groupOthers] } };
  const otherBatch = {
    createdAt: '2024-05-01T00:00:00Z',
    result: { results: [R({ phone: '0507000000', name: 'רחוק', pct: { air: 100, fire: 0, water: 0, earth: 0 }, dominant: 'air' })] },
  };
  const ins = computeInsights(target, batch, [batch, otherBatch], KEYS);

  // קבוצה: 2 מתוך 3 עם דומיננטי fire (המטרה + "דומה")
  assert.equal(ins.group.total, 3);
  assert.equal(ins.group.same, 2);
  assert.equal(ins.group.percent, 67);

  // כלל המערכת: 4 משתתפים, 2 עם fire
  assert.equal(ins.global.total, 4);
  assert.equal(ins.global.same, 2);
  assert.equal(ins.global.percent, 50);

  // הקרוב ביותר: "דומה" (75/25 מול 80/20)
  assert.equal(ins.closest.name, 'דומה');
  assert.ok(ins.closest.similarity > 90);
});

test('computeInsights: מדלג על עצמי בחישוב הקרוב ביותר', () => {
  const target = R({ phone: '0501234567', name: 'יחיד', pct: { fire: 100, water: 0, air: 0, earth: 0 }, dominant: 'fire' });
  const batch = { createdAt: '2024-06-01T00:00:00Z', result: { results: [target] } };
  const ins = computeInsights(target, batch, [batch], KEYS);
  assert.equal(ins.closest, null); // אין אף אחד אחר
  assert.equal(ins.group.same, 1);
  assert.equal(ins.group.percent, 100);
});
