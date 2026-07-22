// ============================================================================
//  גרסאות אפיון (variants) — בחירת ערכת טקסט לפי שם המשחק
//  אותם פרופילים, אותה התאמה, אותו מספר קובץ שמע — רק השם/התיאור מתחלפים.
//  כל גרסה מזוהה לפי מילת-מפתח בשם המשחק (gameName). ברירת מחדל = אין התאמה.
// ============================================================================

/** ולידציה של רשימת הגרסאות מההגדרות. */
export function sanitizeVariants(list, fallback = []) {
  if (!Array.isArray(list)) return Array.isArray(fallback) ? fallback : [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    let id = String(v.id ?? '').trim().slice(0, 40);
    if (!id) id = `v${out.length + 1}`;
    if (seen.has(id)) continue; // מזהה ייחודי
    seen.add(id);
    out.push({
      id,
      label: String(v.label ?? '').slice(0, 60),
      // מילות זיהוי בשם המשחק — מופרדות בפסיקים (די שאחת תופיע כדי להתאים)
      matchText: String(v.matchText ?? '').slice(0, 200),
    });
  }
  return out;
}

/** מפרק את מילות הזיהוי של גרסה לרשימה נקייה. */
export function variantKeywords(v) {
  return String(v?.matchText ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * מחזיר את מזהה הגרסה המתאימה לשם המשחק, או null (ברירת מחדל).
 * הגרסאות נבדקות לפי סדר; הראשונה שאחת ממילות-המפתח שלה מופיעה ב-gameName מנצחת.
 */
export function resolveVariant(gameName, variants) {
  const name = String(gameName ?? '');
  if (!name) return null;
  for (const v of variants || []) {
    if (!v?.id) continue;
    const keys = variantKeywords(v);
    if (keys.some((k) => name.includes(k))) return v.id;
  }
  return null;
}

/**
 * מחיל את טקסט הגרסה על אובייקט התאמה (match) לפי סוג האישיות שהותאם.
 * משנה רק name/description אם קיימים בגרסה. אינו נוגע במספר/בפרופיל.
 * מקבל את רשומת סוג האישיות המלאה (עם variantTexts). מחזיר match חדש (לא מוטציה).
 */
export function applyVariantToMatch(match, personality, variantId) {
  if (!match || !variantId) return match;
  const vt = personality?.variantTexts?.[variantId];
  if (!vt) return match;
  const next = { ...match };
  if (vt.name) next.name = vt.name;
  if (vt.description != null && vt.description !== '') next.description = vt.description;
  return next;
}
