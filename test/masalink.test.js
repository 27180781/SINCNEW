// בדיקות MasaLink (Inforu) — בניית כתובת, הסתרת טוקן, ושליחה
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMasaLinkUrl, redactUrl, sendMasaLink } from '../src/masalink.js';

const BASE = {
  baseUrl: 'https://capi.inforu.co.il/api/Automation/TriggerParameters',
  username: 'K12002200', token: 'secret-token', apiEventName: 'MASALINK', linkParam: 'Text27',
  email: 'owner@example.com', link: 'https://app.example.com/session/gm-1',
};

test('buildMasaLinkUrl: כולל את כל הפרמטרים עם קידוד תקין', () => {
  const url = buildMasaLinkUrl(BASE);
  const u = new URL(url);
  assert.equal(u.searchParams.get('Username'), 'K12002200');
  assert.equal(u.searchParams.get('Token'), 'secret-token');
  assert.equal(u.searchParams.get('ApiEventName'), 'MASALINK');
  assert.equal(u.searchParams.get('Email'), 'owner@example.com');
  assert.equal(u.searchParams.get('Text27'), 'https://app.example.com/session/gm-1');
});

test('buildMasaLinkUrl: פרמטר קישור מותאם אישית', () => {
  const url = buildMasaLinkUrl({ ...BASE, linkParam: 'Text30' });
  assert.equal(new URL(url).searchParams.get('Text30'), BASE.link);
  assert.equal(new URL(url).searchParams.get('Text27'), null);
});

test('redactUrl: מסתיר את הטוקן', () => {
  const red = redactUrl(buildMasaLinkUrl(BASE));
  assert.equal(new URL(red).searchParams.get('Token'), '***');
  assert.ok(!red.includes('secret-token'));
});

test('sendMasaLink: שגיאות ולידציה', async () => {
  assert.equal((await sendMasaLink({ ...BASE, username: '' })).ok, false);
  assert.equal((await sendMasaLink({ ...BASE, token: '' })).ok, false);
  assert.equal((await sendMasaLink({ ...BASE, email: '' })).ok, false);
  assert.equal((await sendMasaLink({ ...BASE, link: '' })).ok, false);
});

test('sendMasaLink: הצלחה עם StatusId=1', async () => {
  let calledUrl = '';
  const fetchImpl = async (url) => { calledUrl = url; return { ok: true, status: 200, text: async () => JSON.stringify({ StatusId: 1, StatusDescription: 'Success' }) }; };
  const r = await sendMasaLink(BASE, { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.statusId, 1);
  assert.equal(r.email, 'owner@example.com');
  assert.ok(calledUrl.includes('ApiEventName=MASALINK'));
  assert.ok(!r.url.includes('secret-token'), 'הכתובת המוחזרת מוסתרת');
});

test('sendMasaLink: כשל כאשר StatusId שונה מ-1', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ StatusId: -1, StatusDescription: 'Error' }) });
  const r = await sendMasaLink(BASE, { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.statusId, -1);
});

test('sendMasaLink: שגיאת רשת נתפסת', async () => {
  const fetchImpl = async () => { throw new Error('boom'); };
  const r = await sendMasaLink(BASE, { fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
});
