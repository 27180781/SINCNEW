// ============================================================================
//  שכבת ה-API — מגדירה את כל ה-endpoints ומחברת בין ה-Store למנוע השקלול
// ============================================================================

import { scoreBatch, scoreParticipant, matchPersonality, DEFAULT_ELEMENT_KEYS } from './scoring.js';
import { buildSeedData, generatePersonalities, defaultSettings, buildSampleQuestions, newId } from './seed.js';

const ok = (body, status = 200) => ({ status, body });
const err = (message, status = 400) => ({ status, body: { error: message } });

function elementKeysFrom(state) {
  const keys = (state.settings?.elements || []).map((e) => e.key);
  return keys.length ? keys : DEFAULT_ELEMENT_KEYS;
}

function matchOptions(state) {
  return {
    elementKeys: elementKeysFrom(state),
    metric: state.settings?.matching?.metric || 'euclidean',
    topN: state.settings?.matching?.topN || 3,
  };
}

// ולידציה בסיסית של שאלה
function sanitizeQuestion(input, fallbackOrder) {
  const q = {
    id: input.id || newId('q'),
    order: Number.isFinite(input.order) ? input.order : fallbackOrder,
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
    profileSum: Math.round(sum),
    generated: !!input.generated,
  };
}

export function createRouter(store) {
  const S = () => store.get();

  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  // ---- Health ----
  add('GET', '/api/health', () => ok({ ok: true, time: new Date().toISOString() }));

  // ---- הגדרות ----
  add('GET', '/api/settings', () => ok(S().settings));
  add('PUT', '/api/settings', ({ body }) => {
    const state = S();
    const cur = state.settings;
    state.settings = {
      ...cur,
      ...body,
      title: body.title != null ? String(body.title).slice(0, 200) : cur.title,
      subtitle: body.subtitle != null ? String(body.subtitle).slice(0, 200) : cur.subtitle,
      elements: Array.isArray(body.elements) ? sanitizeElements(body.elements, cur.elements) : cur.elements,
      matching: { ...cur.matching, ...(body.matching || {}) },
    };
    store.save();
    return ok(state.settings);
  });

  // ---- קונפיגורציה למבחן הציבורי (ללא חשיפת מיפוי היסודות) ----
  add('GET', '/api/config', () => {
    const state = S();
    return ok({
      title: state.settings.title,
      subtitle: state.settings.subtitle,
      elements: state.settings.elements,
      questions: (state.questions || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((q) => ({
          id: q.id,
          text: q.text,
          options: (q.options || []).map((o) => ({ id: o.id, text: o.text })),
        })),
    });
  });

  // ---- שאלות ----
  add('GET', '/api/questions', () => {
    const list = (S().questions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    return ok(list);
  });

  add('POST', '/api/questions', ({ body }) => {
    const state = S();
    const order = (state.questions?.length || 0) + 1;
    const q = sanitizeQuestion(body, order);
    if (!q.text) return err('טקסט השאלה חסר');
    state.questions.push(q);
    store.save();
    return ok(q, 201);
  });

  add('PUT', '/api/questions/:id', ({ params, body }) => {
    const state = S();
    const idx = state.questions.findIndex((q) => q.id === params.id);
    if (idx < 0) return err('שאלה לא נמצאה', 404);
    const updated = sanitizeQuestion({ ...state.questions[idx], ...body, id: params.id }, state.questions[idx].order);
    state.questions[idx] = updated;
    store.save();
    return ok(updated);
  });

  add('DELETE', '/api/questions/:id', ({ params }) => {
    const state = S();
    const before = state.questions.length;
    state.questions = state.questions.filter((q) => q.id !== params.id);
    if (state.questions.length === before) return err('שאלה לא נמצאה', 404);
    store.save();
    return ok({ deleted: params.id });
  });

  // החלפת כל השאלות בבת אחת (סדר/ייבוא)
  add('PUT', '/api/questions', ({ body }) => {
    const state = S();
    const list = Array.isArray(body) ? body : body.questions;
    if (!Array.isArray(list)) return err('נדרש מערך שאלות');
    state.questions = list.map((q, i) => sanitizeQuestion(q, i + 1));
    store.save();
    return ok(state.questions);
  });

  // ---- סוגי אישיות ----
  add('GET', '/api/personalities', ({ query }) => {
    const state = S();
    let list = state.personalities || [];
    const search = (query.search || '').trim();
    if (search) {
      list = list.filter((p) => (p.name || '').includes(search) || (p.description || '').includes(search));
    }
    const total = list.length;
    const offset = Math.max(0, parseInt(query.offset, 10) || 0);
    const limit = query.limit === 'all' ? total : Math.max(1, parseInt(query.limit, 10) || 50);
    const page = list.slice(offset, offset + limit);
    return ok({ total, offset, limit, items: page });
  });

  add('POST', '/api/personalities', ({ body }) => {
    const state = S();
    const keys = elementKeysFrom(state);
    const p = sanitizePersonality(body, keys);
    if (!p.name) return err('שם סוג האישיות חסר');
    state.personalities.push(p);
    store.save();
    return ok(p, 201);
  });

  add('PUT', '/api/personalities/:id', ({ params, body }) => {
    const state = S();
    const keys = elementKeysFrom(state);
    const idx = state.personalities.findIndex((p) => p.id === params.id);
    if (idx < 0) return err('סוג אישיות לא נמצא', 404);
    const updated = sanitizePersonality({ ...state.personalities[idx], ...body, id: params.id }, keys);
    state.personalities[idx] = updated;
    store.save();
    return ok(updated);
  });

  add('DELETE', '/api/personalities/:id', ({ params }) => {
    const state = S();
    const before = state.personalities.length;
    state.personalities = state.personalities.filter((p) => p.id !== params.id);
    if (state.personalities.length === before) return err('סוג אישיות לא נמצא', 404);
    store.save();
    return ok({ deleted: params.id });
  });

  // ייבוא מרובה
  add('POST', '/api/personalities/bulk', ({ body }) => {
    const state = S();
    const keys = elementKeysFrom(state);
    const list = Array.isArray(body) ? body : body.personalities;
    if (!Array.isArray(list)) return err('נדרש מערך סוגי אישיות');
    const mode = (Array.isArray(body) ? 'append' : body.mode) || 'append';
    const sanitized = list.map((p) => sanitizePersonality(p, keys));
    if (mode === 'replace') state.personalities = sanitized;
    else state.personalities.push(...sanitized);
    store.save();
    return ok({ imported: sanitized.length, total: state.personalities.length }, 201);
  });

  // חידוש המאגר האלגוריתמי
  add('POST', '/api/personalities/generate', ({ body }) => {
    const state = S();
    const step = Math.max(5, Math.min(50, parseInt(body?.step, 10) || 10));
    const generated = generatePersonalities(step);
    if (body?.mode === 'append') state.personalities.push(...generated);
    else state.personalities = generated;
    store.save();
    return ok({ generated: generated.length, step, total: state.personalities.length }, 201);
  });

  // מחיקת כל סוגי האישיות
  add('DELETE', '/api/personalities', () => {
    const state = S();
    state.personalities = [];
    store.save();
    return ok({ cleared: true });
  });

  // ---- שקלול (ללא שמירה) ----
  add('POST', '/api/score', ({ body }) => {
    const state = S();
    const opts = matchOptions(state);
    const questions = (state.questions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

    // תמיכה גם במשתתף בודד וגם בקבוצה
    let participants;
    if (Array.isArray(body)) participants = body;
    else if (Array.isArray(body.participants)) participants = body.participants;
    else if (body.answers) participants = [body];
    else return err('נדרש { participants: [...] } או { answers: {...} }');

    const result = scoreBatch(participants, questions, state.personalities, opts);
    return ok(result);
  });

  // ---- קבוצות (שמירת מפגש שקלול) ----
  add('GET', '/api/batches', () => {
    const list = (S().batches || []).map((b) => ({
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      count: b.result?.count || 0,
    }));
    return ok(list);
  });

  add('GET', '/api/batches/:id', ({ params }) => {
    const b = (S().batches || []).find((x) => x.id === params.id);
    if (!b) return err('קבוצה לא נמצאה', 404);
    return ok(b);
  });

  add('POST', '/api/batches', ({ body }) => {
    const state = S();
    const opts = matchOptions(state);
    const questions = (state.questions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const participants = Array.isArray(body.participants) ? body.participants : (Array.isArray(body) ? body : null);
    if (!participants) return err('נדרש { participants: [...] }');
    const result = scoreBatch(participants, questions, state.personalities, opts);
    const batch = {
      id: newId('batch'),
      name: String(body.name || `מפגש ${new Date().toISOString().slice(0, 10)}`),
      createdAt: new Date().toISOString(),
      participants,
      result,
    };
    state.batches.push(batch);
    store.save();
    return ok(batch, 201);
  });

  add('DELETE', '/api/batches/:id', ({ params }) => {
    const state = S();
    const before = state.batches.length;
    state.batches = state.batches.filter((b) => b.id !== params.id);
    if (state.batches.length === before) return err('קבוצה לא נמצאה', 404);
    store.save();
    return ok({ deleted: params.id });
  });

  // ---- סטטיסטיקה ללוח הבקרה ----
  add('GET', '/api/stats', () => {
    const state = S();
    const keys = elementKeysFrom(state);
    const batches = state.batches || [];
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
      questions: (state.questions || []).length,
      personalities: (state.personalities || []).length,
      batches: batches.length,
      participants: participantCount,
      elementAverages,
      topPersonalities,
    });
  });

  // ---- כלים: איפוס / ייצוא / ייבוא מאגר שלם ----
  add('POST', '/api/reset', ({ body }) => {
    const what = body?.what || 'all';
    const state = S();
    if (what === 'all') {
      store.replace(buildSeedData());
    } else if (what === 'questions') {
      state.questions = buildSampleQuestions();
      store.save();
    } else if (what === 'settings') {
      state.settings = defaultSettings();
      store.save();
    } else if (what === 'batches') {
      state.batches = [];
      store.save();
    }
    return ok({ reset: what });
  });

  add('GET', '/api/export', () => ok(S()));

  add('POST', '/api/import', ({ body }) => {
    if (!body || typeof body !== 'object' || !body.settings) return err('מבנה מאגר לא תקין');
    // נרמול: מבטיח שכל הקולקציות הן מערכים, אחרת נקודות הכתיבה יקרסו והמאגר יושחת
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
    store.replace(normalized);
    return ok({ imported: true });
  });

  return routes;
}
