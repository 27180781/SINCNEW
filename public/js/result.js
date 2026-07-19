// ============================================================
//  עמוד תוצאה אישית — עוגת יסודות + תובנות (לפי טלפון או קוד אישי)
// ============================================================
import { api, el, setElements, ELEMENT_ORDER, elLabel, elColor, elEmoji, escapeHtml } from './api.js';
import { donut } from './chart.js';

const phoneInput = document.getElementById('phoneInput');
const codeInput = document.getElementById('codeInput');
const lookupBtn = document.getElementById('lookupBtn');
const lookupErr = document.getElementById('lookupErr');
const resultView = document.getElementById('resultView');

function showErr(msg) {
  lookupErr.textContent = msg;
  lookupErr.style.display = msg ? 'block' : 'none';
}

async function lookup({ phone, code }) {
  showErr('');
  const qs = phone ? `phone=${encodeURIComponent(phone)}` : `code=${encodeURIComponent(code)}`;
  let data;
  try {
    data = await api.get(`/api/my-result?${qs}`);
  } catch (e) {
    resultView.style.display = 'none';
    showErr(e.message || 'לא נמצאו תוצאות');
    return;
  }
  // עדכון כתובת (לשיתוף / שרשור) — ללא טעינה מחדש
  try {
    const url = code ? `/result/${encodeURIComponent(code)}` : `/result?phone=${encodeURIComponent(phone)}`;
    history.replaceState(null, '', url);
  } catch { /* no-op */ }
  render(data);
}

function render(d) {
  if (Array.isArray(d.elements)) setElements(d.elements);
  resultView.innerHTML = '';

  const keys = ELEMENT_ORDER.filter((k) => d.percentages && k in d.percentages);
  const order = keys.length ? keys : Object.keys(d.percentages || {});

  // --- כרטיס ראשי: עוגה + מקרא ---
  const entries = order.map((k) => ({ key: k, label: elLabel(k), value: d.percentages[k] || 0, color: elColor(k), emoji: elEmoji(k) }));
  const domLabel = d.dominant ? `${elEmoji(d.dominant)} ${elLabel(d.dominant)}` : '—';
  const domPct = d.dominant ? `${d.percentages[d.dominant] || 0}%` : '';

  const hero = el('div', { class: 'card result-hero' });
  hero.appendChild(el('h1', {}, d.name ? `שלום ${d.name} 👋` : 'התוצאה האישית שלך'));
  if (d.session?.gameName) hero.appendChild(el('p', { class: 'muted-box', style: 'display:inline-block' }, `מתוך: ${d.session.gameName}`));

  const chart = donut(entries, { size: 260, centerMain: domLabel.split(' ')[0], centerSub: d.dominant ? elLabel(d.dominant) : '' });
  hero.appendChild(el('div', { class: 'donut-wrap' }, chart));

  if (d.dominant) {
    hero.appendChild(el('div', { style: 'margin:6px 0 4px' }, [
      el('span', { class: `dom-chip el-${d.dominant}` }, `היסוד הדומיננטי שלך: ${elLabel(d.dominant)} ${domPct}`),
    ]));
  }

  const legend = el('div', { class: 'legend' });
  entries.forEach((e) => {
    legend.appendChild(el('div', { class: 'li' }, [
      el('span', { class: 'sw', style: `background:${e.color}` }),
      el('span', {}, `${e.emoji} ${e.label}`),
      el('span', { class: 'val' }, `${e.value}%`),
    ]));
  });
  hero.appendChild(legend);
  resultView.appendChild(hero);

  // --- סוג האישיות התואם ---
  if (d.match) {
    const mc = el('div', { class: 'card match-card' });
    mc.appendChild(el('div', { style: 'font-size:.9rem;color:var(--muted)' }, 'סוג האישיות התואם לך'));
    mc.appendChild(el('h2', { style: 'font-size:1.5rem;margin:.2em 0' }, d.match.name || '—'));
    if (d.match.number != null) mc.appendChild(el('span', { class: 'badge' }, `מספר ${d.match.number}`));
    if (d.match.similarity != null) mc.appendChild(el('div', { style: 'margin-top:6px' }, el('small', {}, `${d.match.similarity}% דמיון`)));
    if (d.match.description) mc.appendChild(el('p', { style: 'margin-top:10px' }, d.match.description));
    resultView.appendChild(mc);
  }

  // --- תובנות אישיות ---
  const ins = d.insights || {};
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, '✨ תובנות אישיות'));
  const grid = el('div', { class: 'grid cols-2' });

  grid.appendChild(insightBox('👥', `${ins.group?.percent ?? 0}%`,
    `מהמשתתפים בקבוצה שלך חולקים איתך את אותו יסוד דומיננטי (${ins.group?.same ?? 0} מתוך ${ins.group?.total ?? 0})`));
  grid.appendChild(insightBox('🌐', `${ins.global?.percent ?? 0}%`,
    `מכלל המשתתפים במערכת דומים לך ביסוד הדומיננטי (${ins.global?.same ?? 0} מתוך ${ins.global?.total ?? 0})`));
  card.appendChild(grid);

  if (ins.closest) {
    const c = ins.closest;
    const who = c.name || (c.personalCode ? `משתתף/ת (קוד ${c.personalCode})` : 'משתתף/ת אחר/ת');
    const box = el('div', { class: 'insight', style: 'margin-top:12px' });
    box.appendChild(el('div', { class: 'ic' }, '🤝'));
    const txt = el('div', {});
    txt.appendChild(el('div', {}, [el('strong', {}, 'הכי קרוב אליך בפילוח: '), el('span', {}, who)]));
    txt.appendChild(el('div', {}, el('small', {}, `${c.similarity ?? 0}% דמיון${c.dominant ? ` · יסוד דומיננטי ${elLabel(c.dominant)}` : ''}`)));
    box.appendChild(txt);
    card.appendChild(box);
  }
  resultView.appendChild(card);

  // --- כפתור חיפוש נוסף ---
  const again = el('div', { class: 'card', style: 'text-align:center' });
  again.appendChild(el('button', { onclick: () => { resultView.style.display = 'none'; document.getElementById('lookupCard').style.display = ''; window.scrollTo(0, 0); } }, 'חיפוש תוצאה נוספת'));
  resultView.appendChild(again);

  document.getElementById('lookupCard').style.display = 'none';
  resultView.style.display = 'block';
  window.scrollTo(0, 0);
}

function insightBox(icon, big, text) {
  return el('div', { class: 'insight' }, [
    el('div', { class: 'ic' }, icon),
    el('div', {}, [el('div', { class: 'big' }, big), el('small', {}, text)]),
  ]);
}

lookupBtn.addEventListener('click', () => {
  const phone = phoneInput.value.trim();
  const code = codeInput.value.trim();
  if (!phone && !code) return showErr('הזן מספר טלפון או קוד אישי');
  lookup(phone ? { phone } : { code });
});
[phoneInput, codeInput].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBtn.click(); }));

// טעינה אוטומטית לפי הכתובת: /result/<code>  או  ?phone= / ?code=
(function boot() {
  const q = new URLSearchParams(location.search);
  const parts = location.pathname.split('/').filter(Boolean); // ['result', '<val>']
  const pathVal = parts[0] === 'result' && parts[1] ? decodeURIComponent(parts[1]) : '';
  const phone = q.get('phone');
  const code = q.get('code') || pathVal;
  if (phone) { phoneInput.value = phone; lookup({ phone }); }
  else if (code) { codeInput.value = code; lookup({ code }); }
})();
