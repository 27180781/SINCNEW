// בדיקות אינטגרציית "משחק פונקציה" — אימות, מיפוי ושקלול
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateGamePayload, gamePayloadToParticipants } from '../src/game.js';
import { scoreBatch, resolveAnswerToOption } from '../src/scoring.js';

// שאלות עם מיפוי מפורש: queId למשחק, ו-answerId לכל אפשרות
const QUESTIONS = [
  {
    id: 'q1', order: 1, queId: 10,
    options: [
      { id: 'q1o1', answerId: 1, element: 'fire' },
      { id: 'q1o2', answerId: 2, element: 'water' },
      { id: 'q1o3', answerId: 3, element: 'air' },
      { id: 'q1o4', answerId: 4, element: 'earth' },
    ],
  },
  {
    id: 'q2', order: 2, queId: 20,
    // סדר האפשרויות הפוך למספור answerId — בודק שהמיפוי לפי answerId ולא לפי מיקום
    options: [
      { id: 'q2o1', answerId: 2, element: 'water' },
      { id: 'q2o2', answerId: 1, element: 'fire' },
    ],
  },
];

test('validateGamePayload: דוחה קלט שאינו אובייקט', () => {
  assert.equal(validateGamePayload(null).ok, false);
  assert.equal(validateGamePayload([]).ok, false);
  assert.equal(validateGamePayload({}).ok, false); // חסר participants
});

test('validateGamePayload: מנרמל שדות ומקבל participants ריק', () => {
  const v = validateGamePayload({ gameId: 'g', participants: [] });
  assert.equal(v.ok, true);
  assert.equal(v.payload.participants.length, 0);
  assert.ok(v.payload.sentAt); // מולא אוטומטית
});

test('resolveAnswerToOption: מיפוי לפי answerId מפורש גובר על מיקום', () => {
  // בשאלה 2, answerId=1 שייך לאפשרות השנייה (fire), לא לראשונה (water)
  assert.equal(resolveAnswerToOption(QUESTIONS[1], 1).element, 'fire');
  assert.equal(resolveAnswerToOption(QUESTIONS[1], 2).element, 'water');
});

test('gamePayloadToParticipants: מיפוי לפי queId + שם נופל למספר', () => {
  const payload = validateGamePayload({
    gameId: 'fn-1', gameName: 'משחק', sentAt: '2026-07-13T21:00:00.000Z',
    participants: [
      { number: '0501234567', name: 'ישראל', score: 30, numAnswers: 2, numCorrect: 1, groupId: 'g1',
        answers: [{ queId: 10, answerId: 1, correct: true }, { queId: 20, answerId: 1, correct: false }] },
      { number: '0509999999', name: '', score: 0, numAnswers: 0, numCorrect: 0, groupId: null, answers: [] },
    ],
  }).payload;

  const participants = gamePayloadToParticipants(payload, QUESTIONS);
  assert.equal(participants.length, 2);
  // המשתתף הראשון: q1 answerId 1 -> fire, q2 answerId 1 -> fire
  assert.equal(participants[0].answers.q1, 1);
  assert.equal(participants[0].answers.q2, 1);
  assert.equal(participants[0].name, 'ישראל');
  assert.equal(participants[0].game.score, 30);
  // שם ריק -> מוצג המספר
  assert.equal(participants[1].name, '0509999999');
});

test('שקלול מלא: מטען משחק -> אחוזי יסודות + התאמת אישיות', () => {
  const payload = validateGamePayload({
    gameId: 'fn-2', participants: [
      // עונה fire בשתי השאלות => 100% אש
      { number: '1', name: 'א', answers: [{ queId: 10, answerId: 1 }, { queId: 20, answerId: 1 }] },
      // עונה water בשתי השאלות => 100% מים
      { number: '2', name: 'ב', answers: [{ queId: 10, answerId: 2 }, { queId: 20, answerId: 2 }] },
    ],
  }).payload;

  const personalities = [
    { id: 'fire', name: 'אש טהורה', profile: { fire: 100, water: 0, air: 0, earth: 0 } },
    { id: 'water', name: 'מים טהורים', profile: { fire: 0, water: 100, air: 0, earth: 0 } },
  ];
  const participants = gamePayloadToParticipants(payload, QUESTIONS);
  const res = scoreBatch(participants, QUESTIONS, personalities);

  assert.equal(res.results[0].percentages.fire, 100);
  assert.equal(res.results[0].match.name, 'אש טהורה');
  assert.equal(res.results[1].percentages.water, 100);
  assert.equal(res.results[1].match.name, 'מים טהורים');
});

test('gamePayloadToParticipants: fallback למיקום כשאין queId מוגדר', () => {
  const qsNoQueId = [
    { id: 'a', order: 1, options: [{ element: 'fire' }, { element: 'water' }] },
    { id: 'b', order: 2, options: [{ element: 'air' }, { element: 'earth' }] },
  ];
  const payload = validateGamePayload({
    gameId: 'g', participants: [{ number: '1', answers: [{ queId: 1, answerId: 1 }, { queId: 2, answerId: 2 }] }],
  }).payload;
  const parts = gamePayloadToParticipants(payload, qsNoQueId);
  // queId 1 -> שאלה ראשונה (a), queId 2 -> שאלה שנייה (b)
  assert.equal(parts[0].answers.a, 1);
  assert.equal(parts[0].answers.b, 2);
  const res = scoreBatch(parts, qsNoQueId, []);
  // answerId 1 בשאלה a -> fire, answerId 2 בשאלה b -> earth
  assert.equal(res.results[0].counts.fire, 1);
  assert.equal(res.results[0].counts.earth, 1);
});

test('validateGamePayload: לוכד מייל מפעיל ותיקיית Cloudinary', () => {
  const v = validateGamePayload({
    gameId: 'g', email: 'operator@example.com', cloudinaryFolder: 'games/abc123',
    participants: [],
  });
  assert.equal(v.ok, true);
  assert.equal(v.payload.email, 'operator@example.com');
  assert.equal(v.payload.cloudinaryFolder, 'games/abc123');
});

test('validateGamePayload: מפתח ownerEmail (הפורמט של המשחק)', () => {
  const v = validateGamePayload({ gameId: 'g', ownerEmail: 'na73438@gmail.com', participants: [] });
  assert.equal(v.payload.email, 'na73438@gmail.com');
});

test('validateGamePayload: מפתחות חלופיים למייל (operatorEmail) + operator מקונן', () => {
  const v1 = validateGamePayload({ gameId: 'g', operatorEmail: 'op@x.co', participants: [] });
  assert.equal(v1.payload.email, 'op@x.co');
  const v2 = validateGamePayload({ gameId: 'g', operator: { email: 'nested@x.co', cloudinaryFolder: 'f/1' }, participants: [] });
  assert.equal(v2.payload.email, 'nested@x.co');
  assert.equal(v2.payload.cloudinaryFolder, 'f/1');
});

test('validateGamePayload: ללא מטא-דאטה => מחרוזות ריקות', () => {
  const v = validateGamePayload({ gameId: 'g', participants: [] });
  assert.equal(v.payload.email, '');
  assert.equal(v.payload.cloudinaryFolder, '');
});

test('resolveQuestion: עמיד ל-queId בסגנון "q7" (עם/בלי קידומת)', () => {
  const qs = [
    { id: 'q7', order: 1, queId: 7, options: [{ answerId: 1, element: 'water' }, { answerId: 2, element: 'fire' }] },
    { id: 'q8', order: 2, queId: 8, options: [{ answerId: 1, element: 'fire' }, { answerId: 2, element: 'earth' }] },
  ];
  // המשחק שולח queId="q7" (עם קידומת) — צריך להתמפות לשאלה queId 7
  const payload = validateGamePayload({
    gameId: 'g', participants: [{ number: '1', answers: [{ queId: 'q7', answerId: 1 }, { queId: 'q8', answerId: 2 }] }],
  }).payload;
  const parts = gamePayloadToParticipants(payload, qs);
  assert.equal(parts[0].answers.q7, 1);
  assert.equal(parts[0].answers.q8, 2);
  const res = scoreBatch(parts, qs, []);
  // q7 answerId 1 -> water, q8 answerId 2 -> earth
  assert.equal(res.results[0].counts.water, 1);
  assert.equal(res.results[0].counts.earth, 1);
});

test('resolveQuestion: queId מספרי רגיל עדיין עובד', () => {
  const qs = [{ id: 'q7', order: 1, queId: 7, options: [{ answerId: 1, element: 'water' }] }];
  const payload = validateGamePayload({
    gameId: 'g', participants: [{ number: '1', answers: [{ queId: 7, answerId: 1 }] }],
  }).payload;
  const parts = gamePayloadToParticipants(payload, qs);
  assert.equal(parts[0].answers.q7, 1);
});

test('resolveQuestion: queId עם אפס מוביל ("07") מתמפה ל-queId 7 (לא לפי מיקום)', () => {
  const qs = [
    { id: 'qa', order: 1, queId: 99, options: [{ answerId: 1, element: 'earth' }] }, // מיקום 1
    { id: 'q7', order: 2, queId: 7, options: [{ answerId: 1, element: 'water' }] },   // queId 7 במיקום 2
  ];
  const payload = validateGamePayload({
    gameId: 'g', participants: [{ number: '1', answers: [{ queId: '07', answerId: 1 }] }],
  }).payload;
  const parts = gamePayloadToParticipants(payload, qs);
  assert.equal(parts[0].answers.q7, 1); // מופה לשאלה queId 7 (water), לא ל-ordered[6]/מיקום
  const res = scoreBatch(parts, qs, []);
  assert.equal(res.results[0].counts.water, 1);
  assert.equal(res.results[0].counts.earth, 0);
});
