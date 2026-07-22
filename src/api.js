// ============================================================================
//  שכבת ה-API — מגדירה את כל ה-endpoints ומחברת בין ה-repository למנוע השקלול
//  כל ה-handlers אסינכרוניים ופועלים מול repo (Postgres או JSON, אותו ממשק).
// ============================================================================

import { scoreBatch, matchPersonality, roundTo100, DEFAULT_ELEMENT_KEYS } from './scoring.js';
import { buildSeedData, generatePersonalities, defaultSettings, buildSampleQuestions, newId } from './seed.js';
import { validateGamePayload, gamePayloadToParticipants } from './game.js';
import { parseXlsx } from './xlsx.js';
import { parseCsv, rowsToQuestions, mappingObjectsToQuestions } from './mapping.js';
import { parsePersonalitiesInput } from './personalities-import.js';
import { collectPhones, sendTzintuk, normalizePhone } from './tzintuk.js';
import { sendMasaLink } from './masalink.js';
import { sanitizeVariants, resolveVariant, applyVariantToMatch } from './variants.js';
import { findLatestParticipantByPhone, buildIntroText, toYemotRead, toYemotIdList } from './intro.js';
import { assignPersonalCodes, findByPersonalCode, findByPhone, computeInsights } from './insights.js';

const ok = (body, status = 200) => ({ status, body });
const err = (message, status = 400) => ({ status, body: { error: message } });
const textResp = (body, status = 200) => ({ status, body: String(body), contentType: 'text/plain; charset=utf-8' });

function elementKeysFrom(settings) {
  const keys = (settings?.elements || []).map((e) => e.key);
  return keys.length ? keys : DEFAULT_ELEMENT_KEYS;
}

function matchOptions(settings) {
  return {
    elementKeys: elementKeysFrom(settings),
    metric: settings?.matching?.metric || 'euclidean',
    topN: settings?.matching?.topN || 3,
  };
}

// ולידציה בסיסית של שאלה
const toNumOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function sanitizeQuestion(input, fallbackOrder) {
  const q = {
    id: input.id || newId('q'),
    order: Number.isFinite(input.order) ? input.order : fallbackOrder,
    queId: toNumOrNull(input.queId), // מזהה השאלה במערכת המשחק (לאינטגרציה)
    text: String(input.text || '').trim(),
    options: [],
  };
  const opts = Array.isArray(input.options) ? input.options : [];
  q.options = opts.map((o, i) => {
    let weight = o.weight == null ? 1 : Number(o.weight);
    if (!Number.isFinite(weight)) weight = 1; // ערך לא-מספרי -> ברירת מחדל
    if (weight < 0) weight = 0; // משקל שלילי אינו חוקי
    return {
      id: o.id || `${q.id}o${i + 1}`,
      answerId: toNumOrNull(o.answerId), // מזהה התשובה במערכת המשחק (לאינטגרציה)
      text: String(o.text || '').trim(),
      element: String(o.element || '').trim(),
      weight, // משקל 0 נשמר כפי שהוא (בעבר הומר בטעות ל-1)
    };
  });
  return q;
}

// ולידציה של הגדרות היסודות (מונע XSS/הזרקת CSS דרך תווית/אימוג'י/צבע)
const SAFE_COLOR = /^#(?:[0-9a-fA-F]{3,8})$|^[a-zA-Z]{1,20}$/;
function sanitizeElements(elements, fallback = []) {
  if (!Array.isArray(elements)) return fallback;
  return elements.map((e, i) => ({
    key: String(e.key || fallback[i]?.key || `el${i}`).slice(0, 20),
    label: String(e.label ?? '').slice(0, 40),
    color: SAFE_COLOR.test(String(e.color || '')) ? String(e.color) : (fallback[i]?.color || '#888888'),
    emoji: String(e.emoji ?? '').slice(0, 8),
    trait: String(e.trait ?? '').slice(0, 200),
  }));
}

// ולידציה של הגדרות הצינתוק
function sanitizeNotify(input, fallback = {}) {
  const src = input || fallback || {};
  let t = Number(src.tzintukTimeOut);
  if (!Number.isFinite(t) || t <= 0) t = 9;
  return {
    enabled: !!src.enabled,
    callerId: String(src.callerId ?? '').slice(0, 40),
    tzintukTimeOut: Math.min(16, t),
    onlyAnswered: src.onlyAnswered !== false, // ברירת מחדל: true
  };
}

// ולידציה של הגדרות MasaLink (Inforu)
function sanitizeMasaLink(input, fallback = {}) {
  const src = input || fallback || {};
  const str = (v, def = '', max = 400) => (v != null ? String(v) : def).slice(0, max);
  return {
    enabled: !!src.enabled,
    baseUrl: str(src.baseUrl, fallback.baseUrl || 'https://capi.inforu.co.il/api/Automation/TriggerParameters'),
    username: str(src.username, fallback.username || '', 100),
    token: str(src.token, fallback.token || '', 200),
    apiEventName: str(src.apiEventName, fallback.apiEventName || 'MASALINK', 100),
    linkParam: str(src.linkParam, fallback.linkParam || 'Text27', 40) || 'Text27',
    resultsBaseUrl: str(src.resultsBaseUrl, fallback.resultsBaseUrl || '', 300).replace(/\/+$/, ''),
  };
}

// גזירת כתובת הבסיס הציבורית מבקשת ה-webhook (מאחורי פרוקסי כמו CapRover)
function originFromReq(req) {
  if (!req) return '';
  const h = req.headers || {};
  const host = h['x-forwarded-host'] || h.host;
  if (!host) return '';
  const proto = String(h['x-forwarded-proto'] || '').split(',')[0].trim()
    || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

// בונה את הקישור הישיר לעמוד תוצאות המפגש (עם מזהה המשחק משורשר)
function buildResultsLink(base, gameId) {
  const b = String(base || '').replace(/\/+$/, '');
  if (!b || !gameId) return '';
  return `${b}/session/${encodeURIComponent(gameId)}`;
}

// בונה תוצאת "דמו" מאחוזי יסודות שהוזנו ידנית (לסימולטור / לשמירה לפי טלפון)
function buildDemoResult(name, phone, enteredPct, keys, personalities, matchOpts) {
  const counts = {};
  let total = 0;
  for (const k of keys) {
    const v = Math.max(0, Math.round(Number(enteredPct?.[k]) || 0));
    counts[k] = v;
    total += v;
  }
  const percentagesRaw = {};
  for (const k of keys) percentagesRaw[k] = total > 0 ? (counts[k] / total) * 100 : 0;
  const percentages = roundTo100(percentagesRaw, keys);
  let dominant = null;
  let best = -1;
  for (const k of keys) if (percentagesRaw[k] > best) { best = percentagesRaw[k]; dominant = k; }
  if (total === 0) dominant = null;
  const m = matchPersonality(percentagesRaw, personalities || [], matchOpts || {});
  return {
    id: String(phone || ''),
    name: name != null ? String(name) : '',
    counts,
    total,
    answered: total > 0 ? total : 0,
    questionCount: total,
    percentages,
    percentagesRaw,
    dominant,
    game: { number: String(phone || ''), score: 0, numAnswers: total, numCorrect: 0, groupId: null },
    match: m.best,
    topMatches: m.matches,
  };
}

// ולידציה של סוג אישיות
function sanitizePersonality(input, keys) {
  const profile = {};
  let sum = 0;
  for (const k of keys) {
    const v = Math.max(0, Number(input.profile?.[k]) || 0);
    profile[k] = v;
    sum += v;
  }
  return {
    id: input.id || newId('type'),
    name: String(input.name || 'ללא שם').trim(),
    number: toNumOrNull(input.number), // מספר קובץ השמע בימות
    description: String(input.description || '').trim(),
    profile,
    generated: !!input.generated,
    variantTexts: sanitizeVariantTexts(input.variantTexts),
  };
}

// ולידציה של טקסטי הגרסאות של סוג אישיות: { [variantId]: { name, description } }
function sanitizeVariantTexts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [vid, val] of Object.entries(input)) {
    if (!val || typeof val !== 'object') continue;
    const key = String(vid).slice(0, 40);
    const name = String(val.name ?? '').trim().slice(0, 200);
    const description = String(val.description ?? '').trim().slice(0, 5000);
    if (!name && !description) continue; // דילוג על ערך ריק
    out[key] = { name, description };
  }
  return out;
}

export function createRouter(repo) {
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  // ---- Health ----
  add('GET', '/api/health', async () => ok({ ok: true, storage: repo.kind, time: new Date().toISOString() }));

  // ---- הגדרות ----
  add('GET', '/api/settings', async () => ok(await repo.getSettings()));
  add('PUT', '/api/settings', async ({ body }) => {
    const cur = await repo.getSettings();
    const next = {
      ...cur,
      ...body,
      title: body.title != null ? String(body.title).slice(0, 200) : cur.title,
      subtitle: body.subtitle != null ? String(body.subtitle).slice(0, 200) : cur.subtitle,
      elements: Array.isArray(body.elements) ? sanitizeElements(body.elements, cur.elements) : cur.elements,
      matching: { ...cur.matching, ...(body.matching || {}) },
      notify: body.notify ? sanitizeNotify(body.notify, cur.notify) : (cur.notify || sanitizeNotify(null)),
      masaLink: body.masaLink ? sanitizeMasaLink(body.masaLink, cur.masaLink) : (cur.masaLink || sanitizeMasaLink(null)),
      variants: Array.isArray(body.variants) ? sanitizeVariants(body.variants, cur.variants) : (cur.variants || []),
    };
    await repo.saveSettings(next);
    return ok(next);
  });

  // ---- קונפיגורציה למבחן הציבורי (ללא חשיפת מיפוי היסודות) ----
  add('GET', '/api/config', async () => {
    const [settings, questions] = await Promise.all([repo.getSettings(), repo.listQuestions()]);
    return ok({
      title: settings.title,
      subtitle: settings.subtitle,
      elements: settings.elements,
      questions: questions.map((q) => ({
        id: q.id,
        text: q.text,
        options: (q.options || []).map((o) => ({ id: o.id, text: o.text })),
      })),
    });
  });

  // ---- שאלות ----
  add('GET', '/api/questions', async () => ok(await repo.listQuestions()));

  add('POST', '/api/questions', async ({ body }) => {
    const count = (await repo.listQuestions()).length;
    const q = sanitizeQuestion(body, count + 1);
    if (!q.text) return err('טקסט השאלה חסר');
    await repo.addQuestion(q);
    return ok(q, 201);
  });

  add('PUT', '/api/questions/:id', async ({ params, body }) => {
    const existing = await repo.getQuestion(params.id);
    if (!existing) return err('שאלה לא נמצאה', 404);
    const updated = sanitizeQuestion({ ...existing, ...body, id: params.id }, existing.order);
    await repo.updateQuestion(params.id, updated);
    return ok(updated);
  });

  add('DELETE', '/api/questions/:id', async ({ params }) => {
    const okDel = await repo.deleteQuestion(params.id);
    if (!okDel) return err('שאלה לא נמצאה', 404);
    return ok({ deleted: params.id });
  });

  // החלפת כל השאלות בבת אחת (סדר/ייבוא)
  add('PUT', '/api/questions', async ({ body }) => {
    const list = Array.isArray(body) ? body : body.questions;
    if (!Array.isArray(list)) return err('נדרש מערך שאלות');
    const clean = list.map((q, i) => sanitizeQuestion(q, i + 1));
    await repo.setQuestions(clean);
    return ok(clean);
  });

  // ייבוא מיפוי יסודות מקובץ Excel/CSV (queId × תשובה→יסוד) או מ-JSON ({question_id, question_text, answers_mapping})
  add('POST', '/api/questions/import-mapping', async ({ body }) => {
    const settings = await repo.getSettings();
    const validKeys = elementKeysFrom(settings);
    const labelToKey = {};
    for (const el of settings.elements || []) labelToKey[el.label] = el.key;

    const existing = await repo.listQuestions();
    const existingByQueId = {};
    for (const q of existing) if (q.queId != null) existingByQueId[q.queId] = q;

    let questions, warnings;
    // פורמט JSON: מערך של { question_id, question_text, answers_mapping }
    const mappingArr = Array.isArray(body.mapping) ? body.mapping : (Array.isArray(body) ? body : null);
    if (mappingArr) {
      ({ questions, warnings } = mappingObjectsToQuestions(mappingArr, { validKeys, labelToKey, existingByQueId }));
    } else {
      let rows;
      try {
        if (Array.isArray(body.rows)) rows = body.rows;
        else if (typeof body.csv === 'string') rows = parseCsv(body.csv);
        else if (typeof body.dataBase64 === 'string') {
          const buf = Buffer.from(body.dataBase64, 'base64');
          // זיהוי xlsx (חתימת ZIP 'PK') מול csv טקסטואלי
          if (buf[0] === 0x50 && buf[1] === 0x4b) rows = parseXlsx(buf);
          else rows = parseCsv(buf.toString('utf8'));
        } else return err('נדרש קובץ (dataBase64) או שדה rows/csv/mapping');
      } catch (e) {
        return err('כשל בקריאת הקובץ: ' + (e?.message || e));
      }
      ({ questions, warnings } = rowsToQuestions(rows, { validKeys, labelToKey, existingByQueId }));
    }
    if (!questions.length) return err('לא נמצאו שאלות תקינות בקובץ. ' + warnings.join(' '));

    const mode = body.mode === 'merge' ? 'merge' : 'replace';
    let finalList;
    if (mode === 'merge') {
      const map = new Map();
      for (const q of existing) map.set(q.queId != null ? `q:${q.queId}` : `id:${q.id}`, q);
      for (const q of questions) {
        const key = `q:${q.queId}`;
        const prev = map.get(key);
        // עדכון טקסט-בלבד (JSON ללא answers_mapping) לא ימחק את מיפוי היסודות הקיים
        if (prev && q.noMapping && (prev.options || []).length) {
          map.set(key, { ...prev, text: q.text || prev.text });
        } else {
          map.set(key, q);
        }
      }
      finalList = [...map.values()];
    } else {
      finalList = questions;
    }
    // מזהים ייחודיים בלבד (מונע התנגשות PRIMARY KEY ב-Postgres / כפילות ב-JSON)
    const seenIds = new Set();
    const clean = finalList.map((q, i) => {
      const sq = sanitizeQuestion({ ...q, order: i + 1 }, i + 1);
      if (seenIds.has(sq.id)) sq.id = newId('q');
      seenIds.add(sq.id);
      return sq;
    });
    await repo.setQuestions(clean);
    return ok({ imported: questions.length, total: clean.length, mode, warnings }, 201);
  });

  // ---- סוגי אישיות ----
  add('GET', '/api/personalities', async ({ query }) => {
    const search = (query.search || '').trim();
    const offset = Math.max(0, parseInt(query.offset, 10) || 0);
    const limit = query.limit === 'all' ? 'all' : Math.max(1, parseInt(query.limit, 10) || 50);
    return ok(await repo.listPersonalities({ search, offset, limit }));
  });

  add('POST', '/api/personalities', async ({ body }) => {
    const keys = elementKeysFrom(await repo.getSettings());
    const p = sanitizePersonality(body, keys);
    if (!p.name) return err('שם סוג האישיות חסר');
    if (p.number == null) {
      const all = await repo.allPersonalities();
      p.number = 1 + all.reduce((m, x) => Math.max(m, x.number || 0), 0);
    }
    await repo.addPersonality(p);
    return ok(p, 201);
  });

  add('PUT', '/api/personalities/:id', async ({ params, body }) => {
    const existing = await repo.getPersonality(params.id);
    if (!existing) return err('סוג אישיות לא נמצא', 404);
    const keys = elementKeysFrom(await repo.getSettings());
    const updated = sanitizePersonality({ ...existing, ...body, id: params.id }, keys);
    await repo.updatePersonality(params.id, updated);
    return ok(updated);
  });

  add('DELETE', '/api/personalities/:id', async ({ params }) => {
    const okDel = await repo.deletePersonality(params.id);
    if (!okDel) return err('סוג אישיות לא נמצא', 404);
    return ok({ deleted: params.id });
  });

  // ייבוא מרובה
  add('POST', '/api/personalities/bulk', async ({ body }) => {
    const keys = elementKeysFrom(await repo.getSettings());
    const list = Array.isArray(body) ? body : body.personalities;
    if (!Array.isArray(list)) return err('נדרש מערך סוגי אישיות');
    const mode = (Array.isArray(body) ? 'append' : body.mode) || 'append';
    const clean = list.map((p) => sanitizePersonality(p, keys));
    // הקצאת מספרים סידוריים לחסרים (ממשיך מהמקסימום הקיים במצב append)
    let next = 1;
    if (mode !== 'replace') {
      const all = await repo.allPersonalities();
      next = 1 + all.reduce((m, x) => Math.max(m, x.number || 0), 0);
    }
    for (const p of clean) if (p.number == null) p.number = next++;
    if (mode === 'replace') await repo.setPersonalities(clean);
    else await repo.appendPersonalities(clean);
    return ok({ imported: clean.length, total: await repo.countPersonalities() }, 201);
  });

  // מספור סידורי לכל סוגי האישיות (מספרי קבצי השמע בימות)
  // mode='fill' (ברירת מחדל) — משלים מספר רק לחסרים, בהמשך למקסימום הקיים.
  // mode='all'  — ממספר מחדש 1..N לפי הסדר (מאפס מספרים קיימים).
  add('POST', '/api/personalities/renumber', async ({ body }) => {
    const mode = body?.mode === 'all' ? 'all' : 'fill';
    const all = await repo.allPersonalities();
    if (!all.length) return ok({ renumbered: 0, mode });
    if (mode === 'all') {
      all.forEach((p, i) => { p.number = i + 1; });
    } else {
      let next = 1 + all.reduce((m, x) => Math.max(m, Number(x.number) || 0), 0);
      for (const p of all) if (p.number == null || p.number === '') p.number = next++;
    }
    await repo.setPersonalities(all);
    return ok({ renumbered: all.length, mode });
  });

  // ייבוא סוגי אישיות מקובץ Excel/CSV (מספר · שם · אחוזי יסודות · תיאור מלא)
  // עם body.variant — מעדכן רק את טקסט הגרסה (שם/תיאור) לפי מספר האישיות, ללא נגיעה בפרופילים.
  add('POST', '/api/personalities/import-file', async ({ body }) => {
    const settings = await repo.getSettings();
    const keys = elementKeysFrom(settings);
    const keyToLabel = {};
    for (const el of settings.elements || []) keyToLabel[el.key] = el.label;

    const variant = String(body.variant || '').trim();
    const isVariant = !!variant;

    let parsed;
    try {
      // ייבוא גרסה: שם ריק נשאר ריק, ואחוזים אינם חובה (מעדכנים רק טקסט)
      parsed = parsePersonalitiesInput(body, parseXlsx, {
        keys, keyToLabel, nameFallback: !isVariant, requireProfile: !isVariant,
      });
    } catch (e) {
      return err('כשל בקריאת הקובץ: ' + (e?.message || e));
    }
    const { personalities, warnings } = parsed;
    if (!personalities.length) return err('לא נמצאו סוגי אישיות תקינים בקובץ. ' + warnings.join(' '));

    // ---- ייבוא לגרסה: עדכון טקסט (שם/תיאור) לפי מספר האישיות ----
    if (isVariant) {
      if (!(settings.variants || []).some((v) => v.id === variant)) return err(`גרסה לא מוכרת: ${variant}`, 400);
      const all = await repo.allPersonalities();
      const byNumber = new Map();
      for (const p of all) if (p.number != null) byNumber.set(Number(p.number), p);
      let updated = 0;
      const missing = [];
      for (const src of personalities) {
        if (src.number == null) continue;
        const p = byNumber.get(Number(src.number));
        if (!p) { missing.push(src.number); continue; }
        const name = String(src.name || '').trim();
        const description = String(src.description || '').trim();
        if (!name && !description) continue; // אין מה לעדכן לשורה זו
        p.variantTexts = { ...(p.variantTexts || {}), [variant]: { name, description } };
        updated += 1;
      }
      await repo.setPersonalities(all);
      const w = [...warnings];
      if (missing.length) w.push(`לא נמצאו סוגי אישיות עם המספרים: ${missing.slice(0, 20).join(', ')}`);
      return ok({ variant, updated, total: all.length, warnings: w }, 201);
    }

    const clean = personalities.map((p) => sanitizePersonality(p, keys));
    // השלמת מספרים סידוריים לחסרים (ממשיך מהמקסימום הקיים במצב append)
    const mode = body.mode === 'append' ? 'append' : 'replace';
    let next = 1;
    if (mode !== 'replace') {
      const all = await repo.allPersonalities();
      next = 1 + all.reduce((m, x) => Math.max(m, x.number || 0), 0);
    }
    for (const p of clean) if (p.number == null) p.number = next++;

    if (mode === 'replace') await repo.setPersonalities(clean);
    else await repo.appendPersonalities(clean);
    return ok({ imported: clean.length, total: await repo.countPersonalities(), mode, warnings }, 201);
  });

  // חידוש המאגר האלגוריתמי
  add('POST', '/api/personalities/generate', async ({ body }) => {
    const step = Math.max(5, Math.min(50, parseInt(body?.step, 10) || 10));
    const generated = generatePersonalities(step);
    if (body?.mode === 'append') await repo.appendPersonalities(generated);
    else await repo.setPersonalities(generated);
    return ok({ generated: generated.length, step, total: await repo.countPersonalities() }, 201);
  });

  // מחיקת כל סוגי האישיות
  add('DELETE', '/api/personalities', async () => {
    await repo.clearPersonalities();
    return ok({ cleared: true });
  });

  // ---- שקלול (ללא שמירה) ----
  add('POST', '/api/score', async ({ body }) => {
    const [settings, questions, personalities] = await Promise.all([
      repo.getSettings(), repo.listQuestions(), repo.allPersonalities(),
    ]);
    const opts = matchOptions(settings);

    let participants;
    if (Array.isArray(body)) participants = body;
    else if (Array.isArray(body.participants)) participants = body.participants;
    else if (body.answers) participants = [body];
    else return err('נדרש { participants: [...] } או { answers: {...} }');

    return ok(scoreBatch(participants, questions, personalities, opts));
  });

  // ---- מפגשים ----
  add('GET', '/api/batches', async () => ok(await repo.listBatches()));

  add('GET', '/api/batches/:id', async ({ params }) => {
    const b = await repo.getBatch(params.id);
    if (!b) return err('קבוצה לא נמצאה', 404);
    return ok(b);
  });

  add('POST', '/api/batches', async ({ body }) => {
    const [settings, questions, personalities] = await Promise.all([
      repo.getSettings(), repo.listQuestions(), repo.allPersonalities(),
    ]);
    const participants = Array.isArray(body.participants) ? body.participants : (Array.isArray(body) ? body : null);
    if (!participants) return err('נדרש { participants: [...] }');
    const result = scoreBatch(participants, questions, personalities, matchOptions(settings));
    const batch = {
      id: newId('batch'),
      name: String(body.name || `מפגש ${new Date().toISOString().slice(0, 10)}`),
      createdAt: new Date().toISOString(),
      participants,
      result,
    };
    await repo.addBatch(batch);
    return ok(batch, 201);
  });

  add('DELETE', '/api/batches/:id', async ({ params }) => {
    const okDel = await repo.deleteBatch(params.id);
    if (!okDel) return err('קבוצה לא נמצאה', 404);
    return ok({ deleted: params.id });
  });

  // ---- אינטגרציית משחק: קבלת תוצאות (webhook) ----
  // טוקן אופציונלי דרך ?token= (המערכת ציבורית מהדפדפן, ראו מסמך האינטגרציה)
  const checkGameToken = (query) => {
    const token = process.env.GAME_TOKEN || '';
    return !token || query.token === token;
  };

  // "תיבת קלט" בזיכרון — שומרת את הקלט הגולמי האחרון שהתקבל (עד 25), כולל כשלים,
  // כדי לאפשר לראות בדיוק באיזה פורמט המשחק שולח ואיך זה מתפרש למיפוי.
  const INBOX_MAX = 25;
  const inbox = [];
  const recordInbox = (entry) => {
    inbox.unshift(entry);
    if (inbox.length > INBOX_MAX) inbox.length = INBOX_MAX;
  };

  async function handleGameSubmission(raw, method, origin) {
    const entry = {
      id: newId('in'),
      receivedAt: new Date().toISOString(),
      method: method || 'POST',
      status: 'error',
      error: null,
      raw, // הקלט הגולמי כפי שהתקבל
    };
    const finish = (resp) => { recordInbox(entry); return resp; };

    const v = validateGamePayload(raw);
    if (!v.ok) {
      entry.error = v.error;
      return finish(err(v.error, 400));
    }
    const game = v.payload;
    entry.gameId = game.gameId;
    entry.gameName = game.gameName;
    entry.sentAt = game.sentAt;
    entry.email = game.email || null; // מייל מפעיל המשחק (לטיפול בהמשך)
    entry.cloudinaryFolder = game.cloudinaryFolder || null; // תיקיית Cloudinary (לטיפול בהמשך)
    entry.participantCount = game.participants.length;

    // מניעת כפילויות לפי gameId + sentAt
    if (game.gameId) {
      const existing = await repo.findGameBatch(game.gameId, game.sentAt);
      if (existing) {
        entry.status = 'duplicate';
        entry.batchId = existing.id;
        return finish(ok({ ok: true, duplicate: true, batchId: existing.id, participants: existing.result?.count || 0 }));
      }
    }

    const [settings, questions, personalities] = await Promise.all([
      repo.getSettings(), repo.listQuestions(), repo.allPersonalities(),
    ]);
    const participants = gamePayloadToParticipants(game, questions);
    const result = scoreBatch(participants, questions, personalities, matchOptions(settings));

    // צירוף נתוני המשחק (ניקוד/נכונות/קבוצה) לכל תוצאה מחושבת
    const gameById = new Map(participants.map((p) => [p.id, p.game]));
    for (const r of result.results) if (gameById.has(r.id)) r.game = gameById.get(r.id);

    // גרסת אפיון לפי שם המשחק — מחליפה רק את הטקסט (שם/תיאור) של ההתאמה, לפי מספר האישיות.
    // הפרופיל, ההתאמה ומספר קובץ השמע נשארים זהים לכל הגרסאות.
    const variantId = resolveVariant(game.gameName, settings.variants);
    entry.variant = variantId; // null = ברירת מחדל
    if (variantId) {
      const persById = new Map(personalities.map((p) => [p.id, p]));
      for (const r of result.results) {
        if (r.match) r.match = applyVariantToMatch(r.match, persById.get(r.match.id), variantId);
      }
    }

    // הקצאת קוד אישי למשתתפים ללא טלפון תקין (רק שם) — כדי שיוכלו לקבל תוצאה לפי הקוד
    const existingBatches = await repo.allBatches();
    assignPersonalCodes(result.results, existingBatches);

    const batch = {
      id: newId('batch'),
      name: `🎮 ${game.gameName || 'משחק'} · ${String(game.sentAt).slice(0, 10)}`,
      createdAt: game.sentAt || new Date().toISOString(),
      source: 'game',
      gameId: game.gameId,
      sentAt: game.sentAt,
      email: game.email || null, // מייל מפעיל המשחק — נשמר לטיפול בהמשך
      cloudinaryFolder: game.cloudinaryFolder || null, // תיקיית Cloudinary — נשמר לטיפול בהמשך
      game: {
        gameId: game.gameId, gameName: game.gameName, sentAt: game.sentAt,
        email: game.email || null, cloudinaryFolder: game.cloudinaryFolder || null,
        variantId: variantId || null, // גרסת האפיון שנבחרה לפי שם המשחק (נשמר בתוך game)
        participantCount: game.participantCount, questions: game.questions, groups: game.groups,
      },
      participants,
      result,
    };
    await repo.addBatch(batch);
    entry.status = 'stored';
    entry.batchId = batch.id;
    entry.mappedMissing = questions.length === 0; // אין מיפוי מוגדר -> לא ימופה כלום
    // פירוש: איך כל משתתף מופה ליסודות (לתצוגה במסך הבדיקה)
    entry.results = result.results.map((r) => ({
      name: r.name, number: r.game?.number || r.id, answered: r.answered,
      counts: r.counts, percentages: r.percentages, dominant: r.dominant,
      match: r.match ? { name: r.match.name, similarity: r.match.similarity } : null,
    }));

    // ---- צינתוק למשתתפים עם תוצאה (fire-and-forget — לא מעכב את התשובה למשחק) ----
    const notifyCfg = settings.notify || {};
    if (!notifyCfg.enabled) {
      entry.notify = { attempted: false, reason: 'disabled' };
    } else if (!process.env.YEMOT_TOKEN) {
      entry.notify = { attempted: false, reason: 'no-token' };
    } else {
      const phones = collectPhones(result.results, { onlyAnswered: notifyCfg.onlyAnswered });
      if (!phones.length) {
        entry.notify = { attempted: false, phones: 0, reason: 'no-valid-phones' };
      } else {
        entry.notify = { attempted: true, phones: phones.length, pending: true };
        sendTzintuk(phones, {
          token: process.env.YEMOT_TOKEN, callerId: notifyCfg.callerId, timeout: notifyCfg.tzintukTimeOut,
        })
          .then((r) => { entry.notify = { attempted: true, ...r }; })
          .catch((e) => { entry.notify = { attempted: true, phones: phones.length, ok: false, error: String(e?.message || e) }; });
      }
    }

    // ---- MasaLink: הפעלת אוטומציה ב-Inforu עם מייל המפעיל + קישור לעמוד התוצאות ----
    // (fire-and-forget — לא מעכב את התשובה למשחק)
    const ml = settings.masaLink || {};
    const mlUsername = ml.username || process.env.INFORU_USERNAME || '';
    const mlToken = ml.token || process.env.INFORU_TOKEN || '';
    const link = buildResultsLink(ml.resultsBaseUrl || origin, game.gameId);
    if (!ml.enabled) {
      entry.masaLink = { attempted: false, reason: 'disabled' };
    } else if (!mlUsername || !mlToken) {
      entry.masaLink = { attempted: false, reason: 'no-credentials' };
    } else if (!game.email) {
      entry.masaLink = { attempted: false, reason: 'no-email' };
    } else if (!link) {
      entry.masaLink = { attempted: false, reason: 'no-link' }; // אין מזהה משחק / כתובת בסיס
    } else {
      entry.masaLink = { attempted: true, email: game.email, link, pending: true };
      sendMasaLink({
        baseUrl: ml.baseUrl, username: mlUsername, token: mlToken,
        apiEventName: ml.apiEventName || process.env.INFORU_EVENT, linkParam: ml.linkParam,
        email: game.email, link,
      })
        .then((r) => { entry.masaLink = { attempted: true, ...r }; })
        .catch((e) => { entry.masaLink = { attempted: true, email: game.email, link, ok: false, error: String(e?.message || e) }; });
    }

    return finish(ok({ ok: true, stored: true, batchId: batch.id, participants: result.count,
      email: batch.email, cloudinaryFolder: batch.cloudinaryFolder, resultsLink: link || null,
      notify: entry.notify, masaLink: entry.masaLink }));
  }

  add('POST', '/api/games/webhook', async ({ body, query, req }) => {
    if (!checkGameToken(query)) return err('טוקן שגוי', 401);
    return handleGameSubmission(body, 'POST', originFromReq(req));
  });

  add('GET', '/api/games/webhook', async ({ query, req }) => {
    if (!checkGameToken(query)) return err('טוקן שגוי', 401);
    if (!query.payload) return err('חסר פרמטר payload', 400);
    let parsed;
    try {
      parsed = JSON.parse(query.payload);
    } catch {
      return err('payload אינו JSON תקין', 400);
    }
    return handleGameSubmission(parsed, 'GET', originFromReq(req));
  });

  // תיבת הקלט של ה-webhook (לצפייה בקלט הגולמי + הפירוש) — מוגן ADMIN_TOKEN
  add('GET', '/api/games/inbox', async () => ok({ count: inbox.length, items: inbox }));
  add('DELETE', '/api/games/inbox', async () => { inbox.length = 0; return ok({ cleared: true }); });

  // פרטי האינטגרציה לפאנל הניהול (כתובת ה-webhook, האם נדרש טוקן)
  add('GET', '/api/integration', async () => {
    const s = await repo.getSettings();
    const ml = s.masaLink || {};
    return ok({
      webhookPath: '/api/games/webhook',
      introTextPath: '/api/get-intro-text',
      archetypePath: '/api/get-archetype/by-phone',
      method: 'POST',
      tokenRequired: !!process.env.GAME_TOKEN,
      notifyTokenSet: !!process.env.YEMOT_TOKEN, // האם YEMOT_TOKEN הוגדר בשרת
      masaLink: {
        enabled: !!ml.enabled,
        credentialsSet: !!((ml.username || process.env.INFORU_USERNAME) && (ml.token || process.env.INFORU_TOKEN)),
        resultsBaseUrl: ml.resultsBaseUrl || '',
      },
    });
  });

  // בדיקת MasaLink — שולח הפעלת אוטומציה למייל שנבחר עם קישור לדוגמה
  add('POST', '/api/masalink/test', async ({ body, req }) => {
    const s = await repo.getSettings();
    const ml = s.masaLink || {};
    const username = ml.username || process.env.INFORU_USERNAME || '';
    const token = ml.token || process.env.INFORU_TOKEN || '';
    const email = String(body?.email || '').trim();
    if (!username || !token) return err('חסרים Username/Token של Inforu (הגדר בטאב הגדרות)', 400);
    if (!email) return err('נדרש מייל לבדיקה');
    const gameId = String(body?.gameId || 'DEMO').trim();
    const link = buildResultsLink(ml.resultsBaseUrl || originFromReq(req), gameId);
    const r = await sendMasaLink({
      baseUrl: ml.baseUrl, username, token, apiEventName: ml.apiEventName || process.env.INFORU_EVENT,
      linkParam: ml.linkParam, email, link,
    });
    return ok(r);
  });

  // בדיקת צינתוק — שולח צינתוק בודד למספר שנבחר
  add('POST', '/api/notify/test', async ({ body }) => {
    const phone = normalizePhone(body?.phone);
    if (!phone) return err('מספר טלפון לא תקין');
    if (!process.env.YEMOT_TOKEN) return err('YEMOT_TOKEN לא הוגדר בשרת', 400);
    const settings = await repo.getSettings();
    const cfg = settings.notify || {};
    const r = await sendTzintuk([phone], {
      token: process.env.YEMOT_TOKEN, callerId: cfg.callerId, timeout: cfg.tzintukTimeOut,
    });
    return ok(r);
  });

  // ---- טקסט פתיח אישי להקראה (ימות המשיח קוראת עם ApiPhone) ----
  async function introTextHandler({ query, body }) {
    // ימות שולחת POST בפורמט form-urlencoded — הפרמטרים מגיעים ב-body
    const phoneRaw = query.ApiPhone ?? query.apiPhone ?? query.phone ?? body?.ApiPhone ?? body?.phone;
    const settings = await repo.getSettings();
    const elements = settings.elements || [];
    // פורמט התשובה: ברירת מחדל id_list_message (משמיע וממשיך ל-api_end_goto);
    // 'read' = read=t- ; 'text' = טקסט גולמי (לבדיקה בדפדפן)
    const fmt = query.format ?? body?.format;
    const respond = (t) => {
      if (fmt === 'text') return textResp(t);
      if (fmt === 'read') return textResp(toYemotRead(t));
      return textResp(toYemotIdList(t));
    };

    if (!normalizePhone(phoneRaw)) return respond('שלום, לא זוהה מספר טלפון תקין');

    const batches = await repo.allBatches();
    const result = findLatestParticipantByPhone(batches, phoneRaw);
    if (!result || !(result.answered > 0)) {
      return respond('שלום, לא נמצאו עבורך תוצאות במערכת ייתכן שטרם השתתפת במשחק');
    }
    return respond(buildIntroText(result, elements));
  }
  add('GET', '/api/get-intro-text', introTextHandler);
  add('POST', '/api/get-intro-text', introTextHandler);

  // תצוגה מקדימה של טקסט הפתיח מנתוני דמו (לסימולטור בפאנל)
  add('POST', '/api/intro-preview', async ({ body }) => {
    const settings = await repo.getSettings();
    const keys = elementKeysFrom(settings);
    const personalities = await repo.allPersonalities();
    const r = buildDemoResult(body?.name, body?.phone, body?.percentages, keys, personalities, matchOptions(settings));
    const text = buildIntroText(r, settings.elements || []);
    return ok({ text, yemot: toYemotIdList(text), match: r.match });
  });

  // שמירת תוצאת דמו למספר טלפון — כדי להתקשר לימות ולשמוע את התוצאה בפועל
  add('POST', '/api/intro-demo', async ({ body }) => {
    const phone = normalizePhone(body?.phone);
    if (!phone) return err('מספר טלפון לא תקין');
    const settings = await repo.getSettings();
    const keys = elementKeysFrom(settings);
    const personalities = await repo.allPersonalities();
    const r = buildDemoResult(body?.name, phone, body?.percentages, keys, personalities, matchOptions(settings));
    if (!(r.answered > 0)) return err('סכום אחוזי היסודות חייב להיות גדול מ-0');

    const text = buildIntroText(r, settings.elements || []);
    const batch = {
      id: newId('batch'),
      name: `🧪 דמו · ${phone}`,
      createdAt: new Date().toISOString(),
      source: 'demo',
      participants: [{ id: phone, name: r.name, answers: {}, game: r.game }],
      result: {
        count: 1,
        results: [r],
        averages: r.percentages,
        personalityTally: r.match ? { [r.match.id]: { name: r.match.name, count: 1 } } : {},
      },
    };
    await repo.addBatch(batch);
    return ok({ ok: true, phone, batchId: batch.id, text, yemot: toYemotIdList(text), match: r.match });
  });

  // ---- מספר סוג האישיות לפי טלפון (לשלוחה 1 בימות — מחזיר רק מספר גולמי) ----
  // ימות תשמיע את קובץ השמע ששמו המספר.
  async function archetypeByPhoneHandler({ query, body }) {
    const phoneRaw = query.ApiPhone ?? query.apiPhone ?? query.phone ?? body?.ApiPhone ?? body?.phone;
    const notFound = query.notFound ?? body?.notFound ?? '0'; // מספר ברירת מחדל אם אין תוצאה

    const batches = await repo.allBatches();
    const result = findLatestParticipantByPhone(batches, phoneRaw);
    let number = result?.match?.number;
    if (number == null && result?.match?.id) {
      // גיבוי לתוצאות ישנות: איתור המספר לפי מזהה סוג האישיות
      const all = await repo.allPersonalities();
      number = all.find((p) => p.id === result.match.id)?.number;
    }
    return textResp(number != null ? String(number) : String(notFound)); // רק מספר
  }
  add('GET', '/api/get-archetype/by-phone', archetypeByPhoneHandler);
  add('POST', '/api/get-archetype/by-phone', archetypeByPhoneHandler);

  // ---- סשנים / תוצאות אישיות (עמודי משתתפים) ----
  const maskPhone = (num) => {
    const d = String(num ?? '').replace(/\D/g, '');
    if (d.length < 5) return null;
    return d.slice(0, 3) + '***' + d.slice(-2);
  };
  // תצוגה ציבורית למשתתפים — ללא מספר סוג האישיות וללא אחוז הדמיון (נשמרים למנהל בלבד)
  const publicResult = (r) => ({
    name: r.name || null,
    personalCode: r.personalCode || null,
    phoneMasked: maskPhone(r.game?.number),
    percentages: r.percentages,
    dominant: r.dominant,
    answered: r.answered,
    match: r.match ? { name: r.match.name } : null,
    game: r.game ? { score: r.game.score, numCorrect: r.game.numCorrect, numAnswers: r.game.numAnswers, groupId: r.game.groupId } : null,
  });

  // רשימת סשנים (מפגשי משחק) — לפאנל
  add('GET', '/api/sessions', async () => {
    const batches = await repo.allBatches();
    const list = batches
      .filter((b) => b.gameId)
      .map((b) => ({
        gameId: b.gameId,
        gameName: b.game?.gameName || b.name,
        sentAt: b.sentAt,
        createdAt: b.createdAt,
        count: b.result?.count || 0,
      }))
      .sort((a, c) => (Date.parse(c.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    return ok(list);
  });

  // צפייה בסשן לפי מזהה משחק (ציבורי — הקישור הייחודי)
  add('GET', '/api/sessions/:gameId', async ({ params }) => {
    const batches = await repo.allBatches();
    const matching = batches.filter((b) => String(b.gameId) === String(params.gameId));
    if (!matching.length) return err('סשן לא נמצא', 404);
    const b = matching.sort((x, y) => (Date.parse(y.createdAt) || 0) - (Date.parse(x.createdAt) || 0))[0];
    const settings = await repo.getSettings();
    return ok({
      gameId: b.gameId,
      gameName: b.game?.gameName || b.name,
      sentAt: b.sentAt,
      count: b.result?.count || 0,
      averages: b.result?.averages || {},
      elements: settings.elements,
      groups: b.game?.groups || [],
      participants: (b.result?.results || []).map(publicResult),
    });
  });

  // תוצאה אישית + תובנות (לפי טלפון או קוד אישי) — ציבורי
  add('GET', '/api/my-result', async ({ query }) => {
    const batches = await repo.allBatches();
    const settings = await repo.getSettings();
    const keys = elementKeysFrom(settings);
    let found = null;
    if (query.phone) found = findByPhone(batches, query.phone);
    else if (query.code) found = findByPersonalCode(batches, query.code);
    else return err('נדרש פרמטר phone או code');

    if (!found || !found.result || !(found.result.answered > 0)) return err('לא נמצאו תוצאות למספר/קוד שהוזן', 404);
    const insights = computeInsights(found.result, found.batch, batches, keys);
    // תובנות ציבוריות למשתתף: ללא מספרים מוחלטים בכלל-המערכת (לא חושפים כמה משתמשים יש),
    // וללא אחוז דמיון של המשתתף הקרוב. הנתונים המלאים שמורים למנהל בתצוגות הניהול.
    const publicInsights = {
      dominant: insights.dominant,
      group: { percent: insights.group?.percent ?? 0, same: insights.group?.same ?? 0, total: insights.group?.total ?? 0 },
      global: { percent: insights.global?.percent ?? 0 }, // רק אחוז — ללא total/same
      closest: insights.closest
        ? { name: insights.closest.name, personalCode: insights.closest.personalCode, dominant: insights.closest.dominant }
        : null, // ללא similarity / מספר סוג אישיות
    };
    return ok({
      name: found.result.name || null,
      personalCode: found.result.personalCode || null,
      percentages: found.result.percentages,
      dominant: found.result.dominant,
      // ללא number ו-similarity — נשמרים למנהל בלבד; למשתתף מוצגים שם הסוג והתיאור
      match: found.result.match ? { name: found.result.match.name, description: found.result.match.description } : null,
      elements: settings.elements,
      session: { gameId: found.batch?.gameId || null, gameName: found.batch?.game?.gameName || found.batch?.name || null },
      insights: publicInsights,
    });
  });

  // ---- סטטיסטיקה ללוח הבקרה ----
  add('GET', '/api/stats', async () => {
    const [settings, questions, personalityCount, batches] = await Promise.all([
      repo.getSettings(), repo.listQuestions(), repo.countPersonalities(), repo.allBatches(),
    ]);
    const keys = elementKeysFrom(settings);
    let participantCount = 0;
    const elementSum = Object.fromEntries(keys.map((k) => [k, 0]));
    const personalityTally = {}; // לפי מזהה (שמות עשויים לחזור בין סוגים שונים)
    for (const b of batches) {
      for (const r of b.result?.results || []) {
        participantCount += 1;
        for (const k of keys) elementSum[k] += r.percentagesRaw?.[k] || 0;
        if (r.match) {
          const id = r.match.id;
          if (!personalityTally[id]) personalityTally[id] = { name: r.match.name, count: 0 };
          personalityTally[id].count += 1;
        }
      }
    }
    const elementAverages = Object.fromEntries(
      keys.map((k) => [k, participantCount ? Math.round((elementSum[k] / participantCount) * 10) / 10 : 0])
    );
    const topPersonalities = Object.values(personalityTally)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(({ name, count }) => ({ name, count }));

    return ok({
      questions: questions.length,
      personalities: personalityCount,
      batches: batches.length,
      participants: participantCount,
      elementAverages,
      topPersonalities,
    });
  });

  // ---- כלים: איפוס / ייצוא / ייבוא ----
  add('POST', '/api/reset', async ({ body }) => {
    const what = body?.what || 'all';
    if (what === 'all') await repo.replaceAll(buildSeedData());
    else if (what === 'questions') await repo.setQuestions(buildSampleQuestions());
    else if (what === 'settings') await repo.saveSettings(defaultSettings());
    else if (what === 'batches') await repo.clearBatches();
    else return err('ערך what לא מוכר');
    return ok({ reset: what });
  });

  add('GET', '/api/export', async () => ok(await repo.exportAll()));

  add('POST', '/api/import', async ({ body }) => {
    if (!body || typeof body !== 'object' || !body.settings) return err('מבנה מאגר לא תקין');
    // נרמול: מבטיח שכל הקולקציות הן מערכים והגדרות תקינות
    const base = defaultSettings();
    const settings = {
      ...base,
      ...body.settings,
      elements: sanitizeElements(body.settings.elements, base.elements),
      matching: { ...base.matching, ...(body.settings.matching || {}) },
    };
    const normalized = {
      version: body.version || 1,
      settings,
      questions: Array.isArray(body.questions) ? body.questions : [],
      personalities: Array.isArray(body.personalities) ? body.personalities : [],
      batches: Array.isArray(body.batches) ? body.batches : [],
    };
    await repo.replaceAll(normalized);
    return ok({ imported: true });
  });

  return routes;
}
