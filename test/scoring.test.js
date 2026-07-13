// בדיקות יחידה למנוע השקלול וההתאמה
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreParticipant,
  scoreBatch,
  matchPersonality,
  distance,
  roundTo100,
  resolveAnswerToOption,
  normalizeAnswers,
} from '../src/scoring.js';

const QUESTIONS = [
  {
    id: 'q1',
    order: 1,
    text: 'שאלה 1',
    options: [
      { id: 'q1o1', text: 'א', element: 'fire' },
      { id: 'q1o2', text: 'ב', element: 'water' },
      { id: 'q1o3', text: 'ג', element: 'air' },
      { id: 'q1o4', text: 'ד', element: 'earth' },
    ],
  },
  {
    id: 'q2',
    order: 2,
    text: 'שאלה 2',
    options: [
      // סדר שונה בכוונה — כדי לבדוק שהמיפוי הוא לפי השאלה
      { id: 'q2o1', text: 'א', element: 'water' },
      { id: 'q2o2', text: 'ב', element: 'fire' },
      { id: 'q2o3', text: 'ג', element: 'earth' },
      { id: 'q2o4', text: 'ד', element: 'air' },
    ],
  },
];

test('פענוח תשובה: לפי מזהה אפשרות', () => {
  const opt = resolveAnswerToOption(QUESTIONS[0], 'q1o3');
  assert.equal(opt.element, 'air');
});

test('פענוח תשובה: לפי אות (A/B/C/D)', () => {
  assert.equal(resolveAnswerToOption(QUESTIONS[0], 'A').element, 'fire');
  assert.equal(resolveAnswerToOption(QUESTIONS[0], 'd').element, 'earth');
  // בשאלה 2 האות B היא האפשרות השנייה => fire
  assert.equal(resolveAnswerToOption(QUESTIONS[1], 'B').element, 'fire');
});

test('פענוח תשובה: לפי אינדקס מספרי (1-מבוסס)', () => {
  assert.equal(resolveAnswerToOption(QUESTIONS[0], 1).element, 'fire');
  assert.equal(resolveAnswerToOption(QUESTIONS[0], '2').element, 'water');
});

test('פענוח תשובה: לפי מפתח יסוד ישיר', () => {
  assert.equal(resolveAnswerToOption(QUESTIONS[0], 'earth').element, 'earth');
});

test('נרמול תשובות: מערך לפי סדר', () => {
  const map = normalizeAnswers(['A', 'B'], QUESTIONS);
  assert.equal(map.get('q1'), 'A');
  assert.equal(map.get('q2'), 'B');
});

test('נרמול תשובות: מפתחות q1/q2', () => {
  const map = normalizeAnswers({ q1: 'A', q2: 'C' }, QUESTIONS);
  assert.equal(map.get('q1'), 'A');
  assert.equal(map.get('q2'), 'C');
});

test('roundTo100: הסכום תמיד 100', () => {
  const r = roundTo100({ fire: 33.33, water: 33.33, air: 33.33, earth: 0 }, ['fire', 'water', 'air', 'earth']);
  const sum = r.fire + r.water + r.air + r.earth;
  assert.equal(sum, 100);
});

test('roundTo100: סכום אפס => הכל אפס', () => {
  const r = roundTo100({ fire: 0, water: 0, air: 0, earth: 0 });
  assert.deepEqual(r, { fire: 0, water: 0, air: 0, earth: 0 });
});

test('scoreParticipant: ספירה ואחוזים נכונים', () => {
  // q1=A(fire), q2=B(fire) => 2 אש מתוך 2 => 100% אש
  const s = scoreParticipant({ id: 'p1', answers: { q1: 'A', q2: 'B' } }, QUESTIONS);
  assert.equal(s.counts.fire, 2);
  assert.equal(s.total, 2);
  assert.equal(s.percentages.fire, 100);
  assert.equal(s.dominant, 'fire');
});

test('scoreParticipant: תערובת יסודות', () => {
  // q1=fire, q2=earth(C) => 50% fire, 50% earth
  const s = scoreParticipant({ answers: { q1: 'A', q2: 'C' } }, QUESTIONS);
  assert.equal(s.counts.fire, 1);
  assert.equal(s.counts.earth, 1);
  assert.equal(s.percentages.fire, 50);
  assert.equal(s.percentages.earth, 50);
});

test('scoreParticipant: ללא תשובות => אפסים, ללא דומיננטי', () => {
  const s = scoreParticipant({ answers: {} }, QUESTIONS);
  assert.equal(s.total, 0);
  assert.equal(s.dominant, null);
  assert.equal(s.percentages.fire, 0);
});

test('distance: אוקלידי בין פרופילים זהים = 0', () => {
  const p = { fire: 25, water: 25, air: 25, earth: 25 };
  assert.equal(distance(p, p), 0);
});

test('matchPersonality: בוחר את הקרוב ביותר', () => {
  const personalities = [
    { id: 'a', name: 'אש טהורה', profile: { fire: 100, water: 0, air: 0, earth: 0 } },
    { id: 'b', name: 'מאוזן', profile: { fire: 25, water: 25, air: 25, earth: 25 } },
    { id: 'c', name: 'מים טהורים', profile: { fire: 0, water: 100, air: 0, earth: 0 } },
  ];
  const m = matchPersonality({ fire: 90, water: 5, air: 5, earth: 0 }, personalities);
  assert.equal(m.best.id, 'a');
  assert.ok(m.best.similarity > 80);
});

test('matchPersonality: מאגר ריק => null', () => {
  const m = matchPersonality({ fire: 100, water: 0, air: 0, earth: 0 }, []);
  assert.equal(m.best, null);
});

test('פענוח תשובה: מספר עם אפס מוביל (01 -> אינדקס 1)', () => {
  assert.equal(resolveAnswerToOption(QUESTIONS[0], '01').element, 'fire');
  assert.equal(resolveAnswerToOption(QUESTIONS[0], '02').element, 'water');
});

test('נרמול תשובות: מפתחות מספריים הם 1-מבוססים ו-0 מדולג', () => {
  const map = normalizeAnswers({ 1: 'A', 0: 'B' }, QUESTIONS);
  assert.equal(map.get('q1'), 'A');
  assert.equal(map.size, 1); // '0' אינו תקין ולא נכנס
});

test('משקל 0 נשמר (לא מומר ל-1) ואינו תורם לספירה', () => {
  const WQ = [{ id: 'w1', order: 1, options: [
    { id: 'w1o1', element: 'fire', weight: 0 },
    { id: 'w1o2', element: 'water', weight: 2 },
  ] }];
  const s0 = scoreParticipant({ answers: { w1: 'w1o1' } }, WQ);
  assert.equal(s0.total, 0);
  assert.equal(s0.dominant, null);
  const s2 = scoreParticipant({ answers: { w1: 'w1o2' } }, WQ);
  assert.equal(s2.counts.water, 2);
  assert.equal(s2.percentages.water, 100);
});

test('משקל שלילי נחתך ל-0 (לא שובר אחוזים)', () => {
  const NQ = [{ id: 'n1', order: 1, options: [
    { id: 'n1o1', element: 'fire', weight: -5 },
    { id: 'n1o2', element: 'water', weight: 3 },
  ] }];
  const s = scoreParticipant({ answers: { n1: 'n1o1', /* לא נענה n2 */ } }, NQ);
  assert.equal(s.counts.fire, 0);
  assert.equal(s.total, 0);
  const both = scoreParticipant({ answers: ['n1o2'] }, NQ);
  assert.equal(both.counts.water, 3);
  assert.equal(both.percentages.water, 100);
});

test('scoreBatch: מחשב תוצאות + התאמות + ממוצעים', () => {
  const personalities = [
    { id: 'a', name: 'אש', profile: { fire: 100, water: 0, air: 0, earth: 0 } },
    { id: 'e', name: 'עפר', profile: { fire: 0, water: 0, air: 0, earth: 100 } },
  ];
  const batch = scoreBatch(
    [
      { id: 'p1', answers: { q1: 'A', q2: 'B' } }, // 100% fire
      { id: 'p2', answers: { q1: 'D', q2: 'C' } }, // 100% earth
    ],
    QUESTIONS,
    personalities
  );
  assert.equal(batch.count, 2);
  assert.equal(batch.results[0].match.name, 'אש');
  assert.equal(batch.results[1].match.name, 'עפר');
  assert.equal(batch.averages.fire, 50);
  assert.equal(batch.averages.earth, 50);
});
