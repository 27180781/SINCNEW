// ============================================================================
//  MasaLink — הפעלת אוטומציה ב-Inforu (שליחת מייל עם קישור לעמוד תוצאות המשחק)
//  Endpoint (GET): https://capi.inforu.co.il/api/Automation/TriggerParameters
//  פרמטרים: Username, Token, ApiEventName, Email, <linkParam> (למשל Text27)=<קישור>
// ============================================================================

const DEFAULT_BASE = 'https://capi.inforu.co.il/api/Automation/TriggerParameters';

/** בונה את כתובת ה-GET המלאה עם קידוד תקין של הפרמטרים. */
export function buildMasaLinkUrl({ baseUrl, username, token, apiEventName, email, link, linkParam = 'Text27', extra = {} } = {}) {
  const u = new URL(baseUrl || DEFAULT_BASE);
  if (username) u.searchParams.set('Username', username);
  if (token) u.searchParams.set('Token', token);
  if (apiEventName) u.searchParams.set('ApiEventName', apiEventName);
  if (email) u.searchParams.set('Email', email);
  if (link) u.searchParams.set(linkParam || 'Text27', link);
  for (const [k, v] of Object.entries(extra || {})) if (v != null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

/** גרסה מוסתרת של הכתובת (ללא חשיפת הטוקן) — לתיעוד/הצגה בטוחה. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('Token')) u.searchParams.set('Token', '***');
    return u.toString();
  } catch { return ''; }
}

/**
 * שולח את בקשת ה-GET ל-Inforu. fetchImpl ניתן להזרקה לבדיקות.
 * @returns {Promise<{ok:boolean, status?:number, statusId?:any, email?:string, link?:string, url?:string, error?:string, body?:string}>}
 */
export async function sendMasaLink(opts = {}, { fetchImpl = fetch } = {}) {
  const { username, token, email, link } = opts;
  if (!username || !token) return { ok: false, error: 'חסרים פרטי התחברות (Username/Token)' };
  if (!email) return { ok: false, error: 'אין מייל מפעיל לשליחה' };
  if (!link) return { ok: false, error: 'אין קישור לעמוד התוצאות (חסר מזהה משחק או כתובת בסיס)' };

  const url = buildMasaLinkUrl(opts);
  try {
    const res = await fetchImpl(url, { method: 'GET' });
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = JSON.parse(text); } catch { /* לא JSON — נשמור טקסט גולמי */ }
    // Inforu מחזיר לרוב StatusId=1 בהצלחה; אם קיים — נחדד לפיו, אחרת לפי סטטוס ה-HTTP.
    const statusId = data?.StatusId ?? data?.statusId;
    const ok = res.ok && (statusId == null || Number(statusId) === 1);
    return { ok, status: res.status, statusId, email, link, url: redactUrl(url), body: String(text).slice(0, 300) };
  } catch (e) {
    return { ok: false, error: 'שגיאת רשת: ' + (e?.message || e), email, link, url: redactUrl(url) };
  }
}
