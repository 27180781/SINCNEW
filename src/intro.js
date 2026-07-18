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

// תווים אסורים ל-TTS של ימות (לפי yemot-router): . - " ' & | ; וגם '=' מפריד פורמט.
function sanitizeYemotSegment(s) {
  return String(s)
    .replace(/[.\-"'&|=]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// בונה את מחרוזת ההודעות של ימות: t-<שורה1>.t-<שורה2>... (כל שורה קטע הקראה נפרד).
function messagesCombined(text) {
  const parts = String(text)
    .split('\n')
    .map(sanitizeYemotSegment)
    .filter((s) => s.length > 0);
  return parts.length ? parts.map((p) => `t-${p}`).join('.') : 't- ';
}

/**
 * id_list_message=<messages> — משמיע את הטקסט וממשיך (מתאים ל-api_end_goto).
 * זהו הפורמט הנכון להשמעה בלבד (הפורמט של yemot-router).
 */
export function toYemotIdList(text) {
  return 'id_list_message=' + messagesCombined(text);
}

/**
 * read=<messages>=<options> — פקודת "קרא" מלאה (משמיע וממתין לקלט).
 * פחות מתאים כאן (עדיף id_list_message), אך זמין כחלופה.
 */
export function toYemotRead(text) {
  // אפשרויות tap עם ברירות מחדל של ימות: valName,re_enter,max,min,sec_wait,playback,...
  return `read=${messagesCombined(text)}=res,no,,1,7,No,no,no,,,,,,`;
}
