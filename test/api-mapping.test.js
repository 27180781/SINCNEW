// בדיקות אינטגרציה לנתיב ייבוא המיפוי (createRouter מול JsonRepo)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRepo } from '../src/repo/json-repo.js';
import { createRouter } from '../src/api.js';

async function setup() {
  const file = join(tmpdir(), `api-map-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
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

const IMPORT = '/api/questions/import-mapping';

test('import-mapping: ייבוא JSON במצב replace -> queId/טקסט/אפשרויות', async () => {
  const { repo, call } = await setup();
  const res = await call('POST', IMPORT, { body: { mapping: [
    { question_id: 'q7', question_text: 'דלת', answers_mapping: { '1': 'water', '2': 'fire', '3': 'earth', '4': 'air' } },
    { question_id: 'q8', question_text: 'פצצה', answers_mapping: { '1': 'fire', '2': 'earth', '3': 'air', '4': 'water' } },
  ], mode: 'replace' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.imported, 2);
  const qs = await repo.listQuestions();
  assert.equal(qs.length, 2);
  const q7 = qs.find((q) => q.queId === 7);
  assert.equal(q7.text, 'דלת');
  assert.deepEqual(q7.options.map((o) => [o.answerId, o.element]), [[1, 'water'], [2, 'fire'], [3, 'earth'], [4, 'air']]);
});

test('import-mapping: מיזוג טקסט-בלבד שומר את מיפוי היסודות הקיים (לא מוחק)', async () => {
  const { repo, call } = await setup();
  await call('POST', IMPORT, { body: { mapping: [
    { question_id: 'q7', question_text: 'דלת', answers_mapping: { '1': 'water', '2': 'fire', '3': 'earth', '4': 'air' } },
  ], mode: 'replace' } });
  const res = await call('POST', IMPORT, { body: { mapping: [
    { question_id: 'q7', question_text: 'לייבל מתוקן' }, // ללא answers_mapping
  ], mode: 'merge' } });
  assert.equal(res.status, 201);
  assert.ok(res.body.warnings.some((w) => w.includes('answers_mapping')), 'אזהרה על answers_mapping חסר');
  const q7 = (await repo.listQuestions()).find((q) => q.queId === 7);
  assert.equal(q7.text, 'לייבל מתוקן', 'הטקסט התעדכן');
  assert.equal(q7.options.length, 4, 'מיפוי היסודות נשמר');
  assert.equal(q7.options[0].element, 'water');
});

test('import-mapping: גוף מערך גולמי -> mode replace', async () => {
  const { repo, call } = await setup();
  const res = await call('POST', IMPORT, { body: [
    { question_id: 'q7', answers_mapping: { '1': 'fire', '2': 'water' } },
  ] });
  assert.equal(res.status, 201);
  const qs = await repo.listQuestions();
  assert.equal(qs.length, 1); // החליף את שאלות הזרע
  assert.equal(qs[0].queId, 7);
});

test('import-mapping: מזהים נשארים ייחודיים גם אחרי עריכת queId (מונע התנגשות PK)', async () => {
  const { repo, call } = await setup();
  await call('POST', IMPORT, { body: { mapping: [
    { question_id: 'q7', answers_mapping: { '1': 'water', '2': 'fire' } },
  ], mode: 'replace' } });
  const before = (await repo.listQuestions())[0];
  assert.equal(before.id, 'q7');
  // עריכת queId ל-5 (id נשאר "q7") — פעולה נתמכת בעורך הרשת
  await call('PUT', '/api/questions/:id', { params: { id: before.id }, body: { ...before, queId: 5 } });
  // מיזוג ייבוא של q7 (queId 7) — היה יוצר שני מזהים "q7"
  const res = await call('POST', IMPORT, { body: { mapping: [
    { question_id: 'q7', answers_mapping: { '1': 'air', '2': 'earth' } },
  ], mode: 'merge' } });
  assert.equal(res.status, 201);
  const qs = await repo.listQuestions();
  const ids = qs.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'כל המזהים ייחודיים');
  assert.deepEqual(qs.map((q) => q.queId).sort((a, b) => a - b), [5, 7], 'queId 5 (ישן) ו-7 (חדש) קיימים');
});
