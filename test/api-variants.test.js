// בדיקות אינטגרציה: גרסאות אפיון (ייבוא לגרסה + החלפת טקסט לפי שם המשחק)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRepo } from '../src/repo/json-repo.js';
import { createRouter } from '../src/api.js';

async function setup() {
  const file = join(tmpdir(), `api-var-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
  const repo = new JsonRepo(file);
  await repo.init();
  const routes = createRouter(repo);
  const call = (method, pattern, { body = {}, query = {}, params = {} } = {}) => {
    const r = routes.find((x) => x.method === method && x.pattern === pattern);
    if (!r) throw new Error(`route ${method} ${pattern} not found`);
    return r.handler({ body, query, params, req: { headers: {} } });
  };
  return { repo, call };
}

async function seedFeature(call) {
  // שאלה אחת: answerId 1 -> fire, 2 -> water
  await call('PUT', '/api/questions', { body: { questions: [
    { id: 'q1', order: 1, queId: 10, options: [{ id: 'q1o1', answerId: 1, element: 'fire' }, { id: 'q1o2', answerId: 2, element: 'water' }] },
  ] } });
  // שני סוגי אישיות (מספרים 1,2)
  await call('POST', '/api/personalities/bulk', { body: { mode: 'replace', personalities: [
    { number: 1, name: 'הלוחם', description: 'לשון זכר', profile: { fire: 100, water: 0, air: 0, earth: 0 } },
    { number: 2, name: 'הזורם', description: 'זכר', profile: { fire: 0, water: 100, air: 0, earth: 0 } },
  ] } });
  // הגדרת גרסה 'girls' לפי מילת המפתח "לבנות"
  await call('PUT', '/api/settings', { body: { variants: [{ id: 'girls', label: 'בנות', matchText: 'לבנות' }] } });
}

const HEADER = ['מספר אישיות', 'שם', 'אחוז אש', 'אחוז מים', 'אחוז רוח', 'אחוז עפר', 'תיאור'];

test('ייבוא לגרסה: מעדכן variantTexts לפי מספר, לא נוגע בפרופיל', async () => {
  const { repo, call } = await setup();
  await seedFeature(call);
  const res = await call('POST', '/api/personalities/import-file', { body: {
    variant: 'girls',
    rows: [HEADER, ['1', 'הלוחמת', '', '', '', '', 'לשון נקבה']],
  } });
  assert.equal(res.status, 201);
  assert.equal(res.body.updated, 1);
  const all = await repo.allPersonalities();
  const p1 = all.find((p) => p.number === 1);
  assert.deepEqual(p1.variantTexts.girls, { name: 'הלוחמת', description: 'לשון נקבה' });
  assert.equal(p1.name, 'הלוחם', 'שם ברירת המחדל לא השתנה');
  assert.deepEqual(p1.profile, { fire: 100, water: 0, air: 0, earth: 0 }, 'הפרופיל לא השתנה');
});

test('ייבוא לגרסה: מספר לא קיים => אזהרה', async () => {
  const { call } = await setup();
  await seedFeature(call);
  const res = await call('POST', '/api/personalities/import-file', { body: {
    variant: 'girls', rows: [HEADER, ['99', 'רפאים', '', '', '', '', 'x']],
  } });
  assert.equal(res.body.updated, 0);
  assert.ok(res.body.warnings.some((w) => w.includes('99')));
});

test('ייבוא לגרסה לא מוכרת => שגיאה', async () => {
  const { call } = await setup();
  await seedFeature(call);
  const res = await call('POST', '/api/personalities/import-file', { body: {
    variant: 'nope', rows: [HEADER, ['1', 'x', '', '', '', '', 'y']],
  } });
  assert.equal(res.status, 400);
});

test('webhook: שם משחק עם מילת-מפתח => טקסט הגרסה; אחרת ברירת המחדל', async () => {
  const { call } = await setup();
  await seedFeature(call);
  await call('POST', '/api/personalities/import-file', { body: {
    variant: 'girls', rows: [HEADER, ['1', 'הלוחמת', '', '', '', '', 'לשון נקבה']],
  } });

  // משחק בגרסת בנות ("סינק לבנות")
  await call('POST', '/api/games/webhook', { body: {
    gameId: 'g-girls', gameName: 'סינק לבנות', sentAt: '2026-07-21T10:00:00Z',
    participants: [{ number: '0501111111', name: 'דנה', numAnswers: 1, answers: [{ queId: 10, answerId: 1 }] }],
  } });
  const girls = await call('GET', '/api/my-result', { query: { phone: '0501111111' } });
  assert.equal(girls.body.match.name, 'הלוחמת', 'שם בגרסת בנות');
  assert.equal(girls.body.match.description, 'לשון נקבה');

  // משחק רגיל ("סינק") => ברירת מחדל
  await call('POST', '/api/games/webhook', { body: {
    gameId: 'g-def', gameName: 'סינק', sentAt: '2026-07-21T11:00:00Z',
    participants: [{ number: '0502222222', name: 'יוסי', numAnswers: 1, answers: [{ queId: 10, answerId: 1 }] }],
  } });
  const def = await call('GET', '/api/my-result', { query: { phone: '0502222222' } });
  assert.equal(def.body.match.name, 'הלוחם', 'שם ברירת המחדל');
  assert.equal(def.body.match.description, 'לשון זכר');
});

test('webhook: מספר קובץ השמע (שלוחה 1) זהה בכל הגרסאות', async () => {
  const { call } = await setup();
  await seedFeature(call);
  await call('POST', '/api/personalities/import-file', { body: {
    variant: 'girls', rows: [HEADER, ['1', 'הלוחמת', '', '', '', '', 'נקבה']],
  } });
  await call('POST', '/api/games/webhook', { body: {
    gameId: 'g1', gameName: 'סינק לבנות', sentAt: '2026-07-21T10:00:00Z',
    participants: [{ number: '0501234567', name: 'ד', numAnswers: 1, answers: [{ queId: 10, answerId: 1 }] }],
  } });
  const arche = await call('GET', '/api/get-archetype/by-phone', { query: { ApiPhone: '0501234567' } });
  assert.equal(arche.body, '1', 'מספר קובץ השמע נשאר 1 גם בגרסת בנות');
});
