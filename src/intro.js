// ============================================================================
//  טקסט פתיח אישי להקראה (לימות המשיח) — לפי תוצאת המשתתף
//  מוצא את התוצאה האחרונה של מספר טלפון, ובונה טקסט עם היסוד הדומיננטי והפירוט.
// ============================================================================

import { normalizePhone } from './tzintuk.js';

/** מאתר את התוצאה האחרונה (המפגש העדכני ביותר) של מספר טלפון נתון. */
export function findLatestParticipantByPhone(batches, phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  let best = null;
  for (const b of batches || []) {
    for (const r of b.result?.results || []) {
      const rn = normalizePhone(r.game?.number ?? r.id);
      if (rn && rn === phone) {
        const ts = Date.parse(b.createdAt || '') || 0;
        if (!best || ts >= best.ts) best = { ts, r };
      }
    }
  }
  return best?.r || null;
}

/**
 * בונה את טקסט הפתיח האישי.
 * - "שלום ל<שם>" אם יש שם, אחרת "שלום לך".
 * - שורת "היסוד הדומיננטי" רק אם יש יסוד יחיד עם הכי הרבה תשובות (בתיקו — מדלגים).
 * - פירוט האחוזים לכל יסוד.
 */
export function buildIntroText(result, elements) {
  const number = String(result.game?.number ?? result.id ?? '');
  const rawName = result.name ? String(result.name).trim() : '';
  const hasName = rawName && rawName !== number;
  const greeting = hasName ? `שלום ל${rawName}` : 'שלום לך';

  const counts = result.counts || {};
  const pct = result.percentages || {};
  const keys = (elements || []).map((e) => e.key);
  const labelOf = Object.fromEntries((elements || []).map((e) => [e.key, e.label]));

  const lines = [greeting, 'על פי הנתונים שהגיעו מהמשחק התוצאה האישית שלך היא כדלהלן'];

  // דומיננטי = היסוד עם הכי הרבה תשובות; בתיקו (כמה עם המקסימום) — מדלגים
  const maxCount = keys.length ? Math.max(...keys.map((k) => counts[k] || 0)) : 0;
  const topKeys = keys.filter((k) => (counts[k] || 0) === maxCount);
  if (maxCount > 0 && topKeys.length === 1) {
    lines.push(`היסוד הדומיננטי שלך הוא יסוד ה${labelOf[topKeys[0]]}`);
  }

  lines.push('ובפירוט');
  // מהגבוה לנמוך; שובר-שוויון לפי סדר היסודות המוגדר
  const ordered = keys
    .map((k, i) => ({ k, i }))
    .sort((a, b) => (pct[b.k] || 0) - (pct[a.k] || 0) || a.i - b.i)
    .map((x) => x.k);
  for (const k of ordered) lines.push(`${pct[k] || 0} אחוז יסוד ה${labelOf[k]}`);

  lines.push('מיד תועבר לשמוע בפירוט על התכונות שמאפיינות אותך');
  return lines.join('\n');
}
