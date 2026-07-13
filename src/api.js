// ============================================================================
//  שכבת ה-API — מגדירה את כל ה-endpoints ומחברת בין ה-repository למנוע השקלול
//  כל ה-handlers אסינכרוניים ופועלים מול repo (Postgres או JSON, אותו ממשק).
// ============================================================================

import { scoreBatch, DEFAULT_ELEMENT_KEYS } from './scoring.js';
import { buildSeedData, generatePersonalities, defaultSettings, buildSampleQuestions, newId } from './seed.js';
import { validateGamePayload, gamePayloadToParticipants } from './game.js';
import { parseXlsx } from './xlsx.js';
import { parseCsv, rowsToQuestions } from './mapping.js';

const ok = (body, status = 200) => ({ status, body });
const err = (message, status = 400) => ({ status, body: { error: message } });

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
    description: String(input.description || '').trim(),
    profile,
    generated: !!input.generated,
  };
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

  // ייבוא מיפוי יסודות מקובץ Excel/CSV (queId × תשובה→יסוד)
  add('POST', '/api/questions/import-mapping', async ({ body }) => {
    let rows;
    try {
      if (Array.isArray(body.rows)) rows = body.rows;
      else if (typeof body.csv === 'string') rows = parseCsv(body.csv);
      else if (typeof body.dataBase64 === 'string') {
        const buf = Buffer.from(body.dataBase64, 'base64');
        // זיהוי xlsx (חתימת ZIP 'PK') מול csv טקסטואלי
        if (buf[0] === 0x50 && buf[1] === 0x4b) rows = parseXlsx(buf);
        else rows = parseCsv(buf.toString('utf8'));
      } else return err('נדרש קובץ (dataBase64) או שדה rows/csv');
    } catch (e) {
      return err('כשל בקריאת הקובץ: ' + (e?.message || e));
    }

    const settings = await repo.getSettings();
    const validKeys = elementKeysFrom(settings);
    const labelToKey = {};
    for (const el of settings.elements || []) labelToKey[el.label] = el.key;

    const existing = await repo.listQuestions();
    const existingByQueId = {};
    for (const q of existing) if (q.queId != null) existingByQueId[q.queId] = q;

    const { questions, warnings } = rowsToQuestions(rows, { validKeys, labelToKey, existingByQueId });
    if (!questions.length) return err('לא נמצאו שאלות תקינות בקובץ. ' + warnings.join(' '));

    const mode = body.mode === 'merge' ? 'merge' : 'replace';
    let finalList;
    if (mode === 'merge') {
      const map = new Map();
      for (const q of existing) map.set(q.queId != null ? `q:${q.queId}` : `id:${q.id}`, q);
      for (const q of questions) map.set(`q:${q.queId}`, q);
      finalList = [...map.values()];
    } else {
      finalList = questions;
    }
    const clean = finalList.map((q, i) => sanitizeQuestion({ ...q, order: i + 1 }, i + 1));
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
    if (mode === 'replace') await repo.setPersonalities(clean);
    else await repo.appendPersonalities(clean);
    return ok({ imported: clean.length, total: await repo.countPersonalities() }, 201);
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

  async function handleGameSubmission(raw) {
    const v = validateGamePayload(raw);
    if (!v.ok) return err(v.error, 400);
    const game = v.payload;

    // מניעת כפילויות לפי gameId + sentAt
    if (game.gameId) {
      const existing = await repo.findGameBatch(game.gameId, game.sentAt);
      if (existing) {
        return ok({ ok: true, duplicate: true, batchId: existing.id, participants: existing.result?.count || 0 });
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

    const batch = {
      id: newId('batch'),
      name: `🎮 ${game.gameName || 'משחק'} · ${String(game.sentAt).slice(0, 10)}`,
      createdAt: game.sentAt || new Date().toISOString(),
      source: 'game',
      gameId: game.gameId,
      sentAt: game.sentAt,
      game: {
        gameId: game.gameId, gameName: game.gameName, sentAt: game.sentAt,
        participantCount: game.participantCount, questions: game.questions, groups: game.groups,
      },
      participants,
      result,
    };
    await repo.addBatch(batch);
    return ok({ ok: true, stored: true, batchId: batch.id, participants: result.count });
  }

  add('POST', '/api/games/webhook', async ({ body, query }) => {
    if (!checkGameToken(query)) return err('טוקן שגוי', 401);
    return handleGameSubmission(body);
  });

  add('GET', '/api/games/webhook', async ({ query }) => {
    if (!checkGameToken(query)) return err('טוקן שגוי', 401);
    if (!query.payload) return err('חסר פרמטר payload', 400);
    let parsed;
    try {
      parsed = JSON.parse(query.payload);
    } catch {
      return err('payload אינו JSON תקין', 400);
    }
    return handleGameSubmission(parsed);
  });

  // פרטי האינטגרציה לפאנל הניהול (כתובת ה-webhook, האם נדרש טוקן)
  add('GET', '/api/integration', async () => ok({
    webhookPath: '/api/games/webhook',
    method: 'POST',
    tokenRequired: !!process.env.GAME_TOKEN,
  }));

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
