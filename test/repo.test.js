// בדיקת פאריטי: JsonRepo ו-PgRepo (דרך pg-mem) עוברים את אותה חבילת בדיקות
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRepo } from '../src/repo/json-repo.js';

async function makeJsonRepo() {
  const file = join(tmpdir(), `repo-test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
  const repo = new JsonRepo(file);
  await repo.init();
  return repo;
}

async function makePgRepo() {
  const { newDb, DataType } = await import('pg-mem');
  const { PgRepo } = await import('../src/repo/pg-repo.js');
  const db = newDb();
  // pg-mem אינו מממש את jsonb_array_length המובנה של Postgres — רושמים אותו לצורך הבדיקה
  db.public.registerFunction({
    name: 'jsonb_array_length',
    args: [DataType.jsonb],
    returns: DataType.integer,
    implementation: (arr) => (Array.isArray(arr) ? arr.length : 0),
  });
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const repo = new PgRepo(pool);
  await repo.init();
  return repo;
}

// חבילת הבדיקות המשותפת
async function checkRepo(repo) {
  // זריעה
  assert.equal(await repo.countPersonalities(), 286, 'seed: 286 סוגי אישיות');
  assert.equal((await repo.listQuestions()).length, 12, 'seed: 12 שאלות');
  const settings = await repo.getSettings();
  assert.ok(settings.title, 'seed: יש כותרת');
  assert.equal(settings.elements.length, 4, 'seed: 4 יסודות');

  // שאלות — CRUD
  const q = { id: 'qtest', order: 99, text: 'שאלת בדיקה', options: [{ id: 'o1', text: 'א', element: 'fire', weight: 1 }] };
  await repo.addQuestion(q);
  const got = await repo.getQuestion('qtest');
  assert.equal(got.text, 'שאלת בדיקה');
  assert.equal(got.options[0].element, 'fire');
  await repo.updateQuestion('qtest', { ...q, text: 'עודכן' });
  assert.equal((await repo.getQuestion('qtest')).text, 'עודכן');
  assert.equal(await repo.deleteQuestion('qtest'), true);
  assert.equal(await repo.getQuestion('qtest'), null);
  assert.equal(await repo.deleteQuestion('nope'), false);

  // סוגי אישיות — עימוד וחיפוש
  const page = await repo.listPersonalities({ offset: 0, limit: 10 });
  assert.equal(page.total, 286);
  assert.equal(page.items.length, 10);
  const page2 = await repo.listPersonalities({ offset: 10, limit: 10 });
  assert.notEqual(page.items[0].id, page2.items[0].id, 'עימוד מחזיר פריטים שונים');
  const search = await repo.listPersonalities({ search: 'טהור', limit: 5 });
  assert.ok(search.total > 0, 'חיפוש "טהור" מחזיר תוצאות');
  assert.ok(search.items.every((p) => p.name.includes('טהור') || (p.description || '').includes('טהור')));

  // סוג אישיות — CRUD
  const p = { id: 'ptest', name: 'בדיקה', description: 'תיאור', profile: { fire: 40, water: 30, air: 20, earth: 10 }, generated: false };
  await repo.addPersonality(p);
  assert.equal(await repo.countPersonalities(), 287);
  assert.equal((await repo.getPersonality('ptest')).profile.fire, 40);
  await repo.updatePersonality('ptest', { ...p, name: 'עודכן' });
  assert.equal((await repo.getPersonality('ptest')).name, 'עודכן');
  assert.equal(await repo.deletePersonality('ptest'), true);
  assert.equal(await repo.countPersonalities(), 286);

  // append / set / clear
  await repo.appendPersonalities([
    { id: 'a1', name: 'a1', description: '', profile: { fire: 100, water: 0, air: 0, earth: 0 }, generated: false },
    { id: 'a2', name: 'a2', description: '', profile: { fire: 0, water: 100, air: 0, earth: 0 }, generated: false },
  ]);
  assert.equal(await repo.countPersonalities(), 288);
  await repo.setPersonalities([{ id: 's1', name: 's1', description: '', profile: { fire: 25, water: 25, air: 25, earth: 25 }, generated: false }]);
  assert.equal(await repo.countPersonalities(), 1);
  const all = await repo.allPersonalities();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 's1');
  await repo.clearPersonalities();
  assert.equal(await repo.countPersonalities(), 0);

  // מפגשים
  const batch = {
    id: 'btest', name: 'מפגש', createdAt: new Date().toISOString(),
    participants: [{ id: 'x', answers: { q1: 'A' } }],
    result: { count: 2, results: [{ id: 'x' }, { id: 'y' }], averages: {}, personalityTally: {} },
  };
  await repo.addBatch(batch);
  const list = await repo.listBatches();
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2, 'listBatches מחשב count מתוך result.results');
  assert.equal((await repo.getBatch('btest')).name, 'מפגש');
  const allB = await repo.allBatches();
  assert.equal(allB[0].result.count, 2);
  assert.equal(await repo.deleteBatch('btest'), true);
  assert.equal((await repo.listBatches()).length, 0);

  // הגדרות — שמירה
  const s2 = { ...settings, title: 'כותרת חדשה' };
  await repo.saveSettings(s2);
  assert.equal((await repo.getSettings()).title, 'כותרת חדשה');

  // מאגר מלא — replaceAll / exportAll
  await repo.replaceAll({
    version: 1,
    settings: { title: 'מיובא', subtitle: '', elements: settings.elements, matching: { metric: 'euclidean', topN: 3 } },
    questions: [{ id: 'iq', order: 1, text: 'שאלה מיובאת', options: [] }],
    personalities: [{ id: 'ip', name: 'סוג מיובא', description: '', profile: { fire: 50, water: 50, air: 0, earth: 0 }, generated: false }],
    batches: [],
  });
  assert.equal((await repo.getSettings()).title, 'מיובא');
  assert.equal((await repo.listQuestions()).length, 1);
  assert.equal(await repo.countPersonalities(), 1);
  const exported = await repo.exportAll();
  assert.equal(exported.questions[0].id, 'iq');
  assert.equal(exported.personalities[0].id, 'ip');
}

test('JsonRepo — פאריטי מלא', async () => {
  await checkRepo(await makeJsonRepo());
});

test('PgRepo (pg-mem) — פאריטי מלא', async () => {
  await checkRepo(await makePgRepo());
});
