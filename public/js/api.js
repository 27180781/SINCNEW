// לקוח API משותף + כלי עזר
export const ELEMENT_ORDER = ['fire', 'water', 'air', 'earth'];

// טוקן ניהול אופציונלי (רלוונטי רק אם השרת הוגדר עם ADMIN_TOKEN)
let adminToken = '';
try { adminToken = localStorage.getItem('adminToken') || ''; } catch { /* no-op */ }
export function setAdminToken(t) {
  adminToken = t || '';
  try { localStorage.setItem('adminToken', adminToken); } catch { /* no-op */ }
}

async function req(method, path, body, retried) {
  const opts = { method, headers: {} };
  if (adminToken) opts.headers['x-admin-token'] = adminToken;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  // אם השרת מוגן ואין טוקן תקין — בקשת טוקן וניסיון חוזר פעם אחת
  if (res.status === 401 && !retried && typeof prompt === 'function') {
    const t = prompt('נדרש טוקן ניהול (הוגדר בשרת כמשתנה הסביבה ADMIN_TOKEN):', adminToken || '');
    if (t) { setAdminToken(t); return req(method, path, body, true); }
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

// בריחת HTML — לשימוש בכל מקום שבו נתוני משתמש/מאגר נכנסים ל-innerHTML
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
// אימות ערך צבע (מונע הזרקת CSS דרך שדה הצבע של יסוד)
const SAFE_COLOR = /^#(?:[0-9a-fA-F]{3,8})$|^[a-zA-Z]{1,20}$/;
export function safeColor(c) { return SAFE_COLOR.test(String(c || '')) ? String(c) : '#888888'; }

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  put: (p, b) => req('PUT', p, b),
  del: (p) => req('DELETE', p),
};

// מפת יסודות (נטענת פעם אחת מההגדרות)
export let ELEMENTS = {
  fire: { label: 'אש', color: '#E4572E', emoji: '🔥' },
  water: { label: 'מים', color: '#2A7DE1', emoji: '💧' },
  air: { label: 'רוח', color: '#7C6BD6', emoji: '🌬️' },
  earth: { label: 'עפר', color: '#6A8E3F', emoji: '🌱' },
};

export function setElements(list) {
  if (!Array.isArray(list)) return;
  const map = {};
  for (const e of list) map[e.key] = e;
  ELEMENTS = map;
}

export function elLabel(key) { return ELEMENTS[key]?.label || key; }
export function elColor(key) { return safeColor(ELEMENTS[key]?.color); }
export function elEmoji(key) { return ELEMENTS[key]?.emoji || ''; }

// יוצר פס-פרופיל מיני (התפלגות אחוזים בצבעי היסודות)
export function miniProfile(profile) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-profile';
  for (const k of ELEMENT_ORDER) {
    const seg = document.createElement('span');
    seg.style.width = (profile[k] || 0) + '%';
    seg.style.background = elColor(k);
    seg.title = `${elLabel(k)} ${profile[k] || 0}%`;
    wrap.appendChild(seg);
  }
  return wrap;
}

// מד אחוזים גדול — נבנה ב-DOM (ללא innerHTML) כדי למנוע XSS דרך תווית/אימוג'י יסוד
export function meter(key, value) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const wrap = document.createElement('div');
  wrap.className = 'meter';

  const head = document.createElement('div');
  head.className = 'meter-head';
  const left = document.createElement('span');
  left.textContent = `${elEmoji(key)} ${elLabel(key)}`;
  const right = document.createElement('strong');
  right.textContent = `${value}%`;
  head.append(left, right);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('span');
  fill.style.width = pct + '%';
  fill.style.background = elColor(key); // עבר דרך safeColor
  bar.appendChild(fill);

  wrap.append(head, bar);
  return wrap;
}

let toastTimer;
export function toast(msg, isError = false) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}
