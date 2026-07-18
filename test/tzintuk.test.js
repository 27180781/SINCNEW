// בדיקות מודול הצינתוק (ימות המשיח)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, collectPhones, buildTzintukPayload, sendTzintuk } from '../src/tzintuk.js';

test('normalizePhone: נרמול מספרים ישראליים', () => {
  assert.equal(normalizePhone('0501234567'), '0501234567');
  assert.equal(normalizePhone('050-123-4567'), '0501234567');
  assert.equal(normalizePhone('03-1234567'), '031234567'); // קווי 9 ספרות
  assert.equal(normalizePhone('+972501234567'), '0501234567');
  assert.equal(normalizePhone('972501234567'), '0501234567');
  assert.equal(normalizePhone('123'), null); // קצר מדי
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('clicker7'), null); // לא טלפון
});

test('collectPhones: אוסף רק ממי שענה, ומנכה כפילויות', () => {
  const results = [
    { answered: 3, game: { number: '0501234567' } },
    { answered: 0, game: { number: '0509999999' } }, // לא ענה -> מדולג
    { answered: 2, game: { number: '050-123-4567' } }, // כפילות של הראשון
    { answered: 1, game: { number: 'not-a-phone' } }, // לא תקין -> מדולג
    { answered: 1, id: '0527654321' }, // ללא game -> נופל ל-id
  ];
  const phones = collectPhones(results, { onlyAnswered: true });
  assert.deepEqual(phones.sort(), ['0501234567', '0527654321']);
});

test('collectPhones: onlyAnswered=false כולל את כולם', () => {
  const results = [
    { answered: 0, game: { number: '0501234567' } },
    { answered: 1, game: { number: '0527654321' } },
  ];
  assert.equal(collectPhones(results, { onlyAnswered: false }).length, 2);
});

test('buildTzintukPayload: מבנה + חיתוך timeout ל-16', () => {
  assert.deepEqual(buildTzintukPayload(['0501234567']), { phones: ['0501234567'] });
  const p = buildTzintukPayload(['0501234567'], { callerId: '077', timeout: 30 });
  assert.equal(p.callerId, '077');
  assert.equal(p.TzintukTimeOut, 16); // נחתך למקסימום
});

test('sendTzintuk: ללא טוקן / ללא מספרים', async () => {
  assert.equal((await sendTzintuk(['05'], {})).ok, false);
  assert.equal((await sendTzintuk([], { token: 't' })).ok, false);
});

test('sendTzintuk: הצלחה + בקשה נכונה (fetch מדומה)', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { json: async () => ({ yemotAPIVersion: '1', responseStatus: 'OK', message: 'done' }) };
  };
  const r = await sendTzintuk(['0501234567', '0527654321'], { token: '077000000:1234', timeout: 10, fetchImpl: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'OK');
  assert.equal(r.phones, 2);
  // הבקשה נשלחה נכון
  assert.equal(captured.url, 'https://www.call2all.co.il/ym/api/RunTzintuk');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, '077000000:1234');
  assert.equal(captured.opts.headers['Content-Type'], 'application/json');
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body.phones, ['0501234567', '0527654321']);
  assert.equal(body.TzintukTimeOut, 10);
});

test('sendTzintuk: תשובת שגיאה מהשרת', async () => {
  const fakeFetch = async () => ({ json: async () => ({ responseStatus: 'ERROR', message: 'Username or password is incorrect', messageCode: 1 }) });
  const r = await sendTzintuk(['0501234567'], { token: 'bad', fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'ERROR');
  assert.equal(r.messageCode, 1);
});

test('sendTzintuk: שגיאת רשת', async () => {
  const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
  const r = await sendTzintuk(['0501234567'], { token: 't', fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.match(r.error, /שגיאת רשת/);
});
