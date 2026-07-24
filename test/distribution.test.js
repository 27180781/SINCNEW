// בדיקות ניתוח פיזור והצעות
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kmeans, analyzeDistribution, distributionReport } from '../src/distribution.js';

const KEYS = ['fire', 'water', 'air', 'earth'];
const P = (fire, water, air, earth) => ({ fire, water, air, earth });
// משתתף עם פרופיל (answered>0)
const part = (fire, water, air, earth) => ({ answered: 1, percentagesRaw: P(fire, water, air, earth), percentages: P(fire, water, air, earth) });

test('kmeans: מפצל שתי קבוצות מרוחקות לשני מרכזים נכונים', () => {
  const pts = [P(80, 20, 0, 0), P(78, 22, 0, 0), P(82, 18, 0, 0), P(0, 0, 80, 20), P(0, 0, 82, 18), P(0, 0, 78, 22)];
  const { centroids, sizes } = kmeans(pts, 2, KEYS);
  assert.equal(centroids.length, 2);
  assert.deepEqual(sizes.sort(), [3, 3]);
  // אחד ממורכז סביב אש~80, השני סביב רוח~80
  const domOf = (c) => KEYS.reduce((a, b) => (c[b] > c[a] ? b : a), KEYS[0]);
  const doms = centroids.map(domOf).sort();
  assert.deepEqual(doms, ['air', 'fire']);
});

test('kmeans: פחות נקודות מ-k => כל נקודה מרכז', () => {
  const { centroids, sizes } = kmeans([P(100, 0, 0, 0)], 3, KEYS);
  assert.equal(centroids.length, 1);
  assert.deepEqual(sizes, [1]);
});

test('analyzeDistribution: משייך לסוג הקרוב וסופר + דומיננטי', () => {
  const personalities = [
    { id: 'a', number: 1, name: 'אש', profile: P(100, 0, 0, 0) },
    { id: 'w', number: 2, name: 'מים', profile: P(0, 100, 0, 0) },
  ];
  const participants = [part(90, 10, 0, 0), part(85, 15, 0, 0), part(5, 95, 0, 0)];
  const a = analyzeDistribution(participants, personalities, KEYS);
  assert.equal(a.total, 3);
  const fire = a.perType.find((t) => t.name === 'אש');
  assert.equal(fire.count, 2);
  assert.equal(a.dominantSplit.fire, 2);
  assert.equal(a.dominantSplit.water, 1);
});

test('analyzeDistribution: מדלג על משתתפים ללא מענה', () => {
  const personalities = [{ id: 'a', number: 1, name: 'אש', profile: P(100, 0, 0, 0) }];
  const participants = [part(100, 0, 0, 0), { answered: 0, percentagesRaw: P(0, 0, 0, 0) }];
  assert.equal(analyzeDistribution(participants, personalities, KEYS).total, 1);
});

test('distributionReport: סוג עמוס מפוצל להצעות שמשפרות את הבריאות', () => {
  // סוג יחיד "מאוזן" בולע שתי תת-קבוצות מובחנות => צריך להציע פיצול
  const personalities = [{ id: 'balanced', number: 1, name: 'מאוזן', profile: P(25, 25, 25, 25) }];
  const participants = [];
  for (let i = 0; i < 40; i++) participants.push(part(45, 30, 15, 10)); // תת-קבוצה A
  for (let i = 0; i < 40; i++) participants.push(part(10, 15, 30, 45)); // תת-קבוצה B
  const rep = distributionReport(participants, personalities, KEYS, { minOverload: 10, minCluster: 5, minGap: 8 });
  assert.equal(rep.total, 80);
  assert.equal(rep.effectiveBefore, 1, 'לפני: כל 80 בסוג אחד => סוג אפקטיבי אחד');
  assert.ok(rep.suggestions.length >= 2, 'לפחות 2 הצעות פיצול');
  assert.ok(rep.effectiveAfter > rep.effectiveBefore, 'הפיזור משתפר אחרי ההצעות');
  // ההצעות מקבלות שם ותיאור אוטומטיים
  assert.ok(rep.suggestions[0].name && rep.suggestions[0].description);
  assert.ok(rep.suggestions.every((s) => s.memberCount >= 5));
});

test('distributionReport: הצעה מיותרת (קרובה לסוג קיים) מסוננת', () => {
  // שני סוגים שכבר מכסים היטב את שתי הקבוצות => אין הצעות חדשות
  const personalities = [
    { id: 'A', number: 1, name: 'A', profile: P(45, 30, 15, 10) },
    { id: 'B', number: 2, name: 'B', profile: P(10, 15, 30, 45) },
  ];
  const participants = [];
  for (let i = 0; i < 30; i++) participants.push(part(45, 30, 15, 10));
  for (let i = 0; i < 30; i++) participants.push(part(10, 15, 30, 45));
  const rep = distributionReport(participants, personalities, KEYS, { minOverload: 10, minCluster: 5, minGap: 8 });
  // כל סוג מדויק לקבוצתו — הפיצול המוצע ייפול קרוב לקיים ויסונן
  assert.equal(rep.suggestions.length, 0);
});
