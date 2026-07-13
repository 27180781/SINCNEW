// לקוח API משותף + כלי עזר
export const ELEMENT_ORDER = ['fire', 'water', 'air', 'earth'];

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

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
export function elColor(key) { return ELEMENTS[key]?.color || '#888'; }
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

// מד אחוזים גדול
export function meter(key, value) {
  const el = document.createElement('div');
  el.className = 'meter';
  el.innerHTML = `
    <div class="meter-head">
      <span>${elEmoji(key)} ${elLabel(key)}</span>
      <strong>${value}%</strong>
    </div>
    <div class="bar"><span style="width:${value}%;background:${elColor(key)}"></span></div>`;
  return el;
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
