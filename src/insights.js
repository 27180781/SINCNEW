// ============================================================================
//  תובנות אישיות + איתור לפי קוד אישי + הקצאת קוד לחסרי-טלפון
// ============================================================================

import { normalizePhone } from './tzintuk.js';
import { distance, maxDistance, DEFAULT_ELEMENT_KEYS } from './scoring.js';

const round = (n, d = 0) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };

/** מזהה ייחודי לתוצאה — טלפון מנורמל, או קוד אישי, או id. */
export function resultKey(r) {
  const phone = normalizePhone(r.game?.number ?? r.id);
  if (phone) return `p:${phone}`;
  if (r.personalCode) return `c:${r.personalCode}`;
  return `i:${r.id ?? ''}`;
}

/** מקצה קוד אישי (מספר) למשתתפים ללא טלפון תקין, בהמשך למקסימום הקיים. */
export function assignPersonalCodes(results, existingBatches, base = 1000) {
  let max = base;
  for (const b of existingBatches || []) {
    for (const r of b.result?.results || []) {
      const c = parseInt(r.personalCode, 10);
      if (Number.isFinite(c) && c > max) max = c;
    }
  }
  let next = max + 1;
  for (const r of results || []) {
    if (!r.personalCode && !normalizePhone(r.game?.number ?? r.id)) {
      r.personalCode = String(next++);
    }
  }
  return results;
}

/**
 * איתור תוצאה לפי predicate — מחזיר גם את המפגש.
 * מעדיף את המפגש העדכני ביותר שבו המשתתף **ענה** (answered>0), כדי שהשתתפות
 * מאוחרת וריקה לא תסתיר תוצאה קודמת. אם אין תוצאה עם מענה — מוחזר האחרון שנמצא.
 */
export function findLatest(batches, matchFn) {
  let bestAnswered = null;
  let bestAny = null;
  for (const b of batches || []) {
    for (const r of b.result?.results || []) {
      if (matchFn(r)) {
        const ts = Date.parse(b.createdAt || '') || 0;
        if (!bestAny || ts >= bestAny.ts) bestAny = { ts, result: r, batch: b };
        if ((r.answered || 0) > 0 && (!bestAnswered || ts >= bestAnswered.ts)) bestAnswered = { ts, result: r, batch: b };
      }
    }
  }
  return bestAnswered || bestAny; // { result, batch } | null
}

/** איתור תוצאה לפי קוד אישי (המפגש העדכני ביותר). */
export function findByPersonalCode(batches, code) {
  const c = String(code ?? '').trim();
  if (!c) return null;
  return findLatest(batches, (r) => String(r.personalCode ?? '') === c);
}

/** איתור תוצאה לפי טלפון (המפגש העדכני ביותר) — מחזיר גם את המפגש. */
export function findByPhone(batches, phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return findLatest(batches, (r) => normalizePhone(r.game?.number ?? r.id) === p);
}

/**
 * מחשב תובנות אישיות:
 * - group:   כמה אחוז מהמפגש (הסשן) חולקים את אותו יסוד דומיננטי
 * - global:  כמה אחוז מכלל המשתתפים במערכת חולקים את היסוד הדומיננטי
 * - closest: המשתתף הקרוב ביותר (מרחק יסודות קטן ביותר) מבין כל השאר
 */
export function computeInsights(target, targetBatch, allBatches, keys = DEFAULT_ELEMENT_KEYS) {
  const dom = target.dominant;
  const selfKey = resultKey(target);
  const targetProfile = target.percentagesRaw || target.percentages || {};

  const answered = (r) => (r.answered || 0) > 0;

  // קבוצה (אותו סשן)
  const groupResults = (targetBatch?.result?.results || []).filter(answered);
  const groupSame = dom ? groupResults.filter((r) => r.dominant === dom).length : 0;
  const group = {
    total: groupResults.length,
    same: groupSame,
    percent: groupResults.length ? round((groupSame / groupResults.length) * 100) : 0,
  };

  // כלל המערכת
  const allResults = [];
  for (const b of allBatches || []) for (const r of b.result?.results || []) if (answered(r)) allResults.push(r);
  const globalSame = dom ? allResults.filter((r) => r.dominant === dom).length : 0;
  const global = {
    total: allResults.length,
    same: globalSame,
    percent: allResults.length ? round((globalSame / allResults.length) * 100) : 0,
  };

  // הקרוב ביותר מבין השאר
  const maxD = maxDistance(keys) || 1;
  let closest = null;
  for (const r of allResults) {
    if (resultKey(r) === selfKey) continue; // דילוג על עצמי
    const d = distance(targetProfile, r.percentagesRaw || r.percentages || {}, keys);
    if (!closest || d < closest.distance) {
      closest = {
        name: r.name || null,
        personalCode: r.personalCode || null,
        distance: round(d, 2),
        similarity: round(Math.max(0, Math.min(100, 100 - (d / maxD) * 100)), 1),
        percentages: r.percentages,
        dominant: r.dominant,
        match: r.match ? { name: r.match.name, number: r.match.number } : null,
      };
    }
  }

  return { dominant: dom, group, global, closest };
}
