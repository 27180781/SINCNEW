// ============================================================================
//  צינתוק — שליחת התראה טלפונית דרך ה-API של ימות המשיח (call2all)
//  Endpoint: POST https://www.call2all.co.il/ym/api/RunTzintuk
//  Body: { phones: [...], callerId?, TzintukTimeOut? }  Header: Authorization: <token>
// ============================================================================

const YEMOT_URL = 'https://www.call2all.co.il/ym/api/RunTzintuk';

/** נרמול מספר טלפון ישראלי: מחזיר מחרוזת ספרות תקינה, או null. */
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3); // +972 -> 0
  if (/^0\d{8,9}$/.test(d)) return d; // 0 ואחריו 8-9 ספרות (סה"כ 9-10)
  return null;
}

/** אוסף מספרי טלפון ייחודיים מתוצאות השקלול (למי שיש תוצאה מוכנה). */
export function collectPhones(results, { onlyAnswered = true } = {}) {
  const set = new Set();
  for (const r of results || []) {
    if (onlyAnswered && !(r.answered > 0)) continue; // רק מי שבאמת ענה
    const p = normalizePhone(r.game?.number ?? r.number ?? r.id);
    if (p) set.add(p);
  }
  return [...set];
}

/** בונה את גוף הבקשה ל-RunTzintuk. */
export function buildTzintukPayload(phones, { callerId, timeout } = {}) {
  const payload = { phones };
  if (callerId) payload.callerId = callerId;
  const t = Number(timeout);
  if (Number.isFinite(t) && t > 0) payload.TzintukTimeOut = Math.min(16, t);
  return payload;
}

/**
 * שולח צינתוק. fetchImpl ניתן להזרקה לצורך בדיקות.
 * @returns {Promise<{ok:boolean, status?:string, message?:string, phones?:number, error?:string}>}
 */
export async function sendTzintuk(phones, { token, callerId, timeout, url = YEMOT_URL, fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, error: 'YEMOT_TOKEN לא הוגדר' };
  if (!Array.isArray(phones) || phones.length === 0) return { ok: false, error: 'אין מספרי טלפון לחיוג' };

  const payload = buildTzintukPayload(phones, { callerId, timeout });
  let data;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify(payload),
    });
    data = await res.json();
  } catch (e) {
    return { ok: false, error: 'שגיאת רשת: ' + (e?.message || e), phones: phones.length };
  }
  return {
    ok: data?.responseStatus === 'OK',
    status: data?.responseStatus,
    message: data?.message,
    messageCode: data?.messageCode,
    phones: phones.length,
  };
}
