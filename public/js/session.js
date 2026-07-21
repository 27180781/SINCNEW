// ============================================================
//  עמוד מפגש-משחק — ממוצעי היסודות + רשימת המשתתפים (לפי gameId)
// ============================================================
import { api, el, setElements, ELEMENT_ORDER, elLabel, elColor, elEmoji, miniProfile } from './api.js';
import { donut } from './chart.js';

const gameIdInput = document.getElementById('gameIdInput');
const lookupBtn = document.getElementById('lookupBtn');
const lookupErr = document.getElementById('lookupErr');
const lookupCard = document.getElementById('lookupCard');
const sessionView = document.getElementById('sessionView');

function showErr(msg) { lookupErr.textContent = msg; lookupErr.style.display = msg ? 'block' : 'none'; }

async function load(gameId) {
  showErr('');
  let d;
  try {
    d = await api.get(`/api/sessions/${encodeURIComponent(gameId)}`);
  } catch (e) {
    sessionView.style.display = 'none';
    showErr(e.message || 'המפגש לא נמצא');
    return;
  }
  try { history.replaceState(null, '', `/session/${encodeURIComponent(gameId)}`); } catch { /* no-op */ }
  render(d);
}

function render(d) {
  if (Array.isArray(d.elements)) setElements(d.elements);
  const order = ELEMENT_ORDER.filter((k) => d.averages && k in d.averages);
  const keys = order.length ? order : Object.keys(d.averages || {});
  sessionView.innerHTML = '';

  // כותרת + ממוצעי יסודות
  const head = el('div', { class: 'card' });
  head.appendChild(el('h1', {}, `🎮 ${d.gameName || 'מפגש'}`));
  head.appendChild(el('div', { class: 'row' }, [
    el('span', { class: 'badge' }, `${d.count} משתתפים`),
    d.sentAt ? el('small', {}, `נשלח: ${String(d.sentAt).slice(0, 16).replace('T', ' ')}`) : null,
    el('small', {}, `מזהה: ${d.gameId}`),
  ]));

  const entries = keys.map((k) => ({ key: k, label: elLabel(k), value: d.averages[k] || 0, color: elColor(k), emoji: elEmoji(k) }));
  let top = null, best = -1;
  for (const e of entries) if (e.value > best) { best = e.value; top = e; }
  const chart = donut(entries, { size: 240, centerMain: 'ממוצע', centerSub: top ? top.label : '' });
  head.appendChild(el('div', { class: 'donut-wrap' }, chart));
  const legend = el('div', { class: 'legend' });
  entries.forEach((e) => legend.appendChild(el('div', { class: 'li' }, [
    el('span', { class: 'sw', style: `background:${e.color}` }),
    el('span', {}, `${e.emoji} ${e.label}`),
    el('span', { class: 'val' }, `${Math.round(e.value)}%`),
  ])));
  head.appendChild(legend);
  sessionView.appendChild(head);

  // רשימת המשתתפים
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, `רשימת המשתתפים (${d.participants.length})`));
  const answered = d.participants.filter((p) => (p.answered || 0) > 0);
  if (!answered.length) {
    card.appendChild(el('div', { class: 'empty' }, 'אין עדיין תוצאות מחושבות למשתתפי המפגש.'));
  } else {
    const t = el('table');
    t.innerHTML = '<thead><tr><th>משתתף</th><th>יסוד דומיננטי</th><th>פילוח</th><th>סוג אישיות</th><th></th></tr></thead>';
    const tb = el('tbody');
    answered.forEach((p) => {
      const idLine = p.personalCode ? `קוד ${p.personalCode}` : (p.phoneMasked || '');
      const nameCell = el('td', {}, [
        el('div', { class: 'p-name' }, p.name || '—'),
        idLine ? el('div', { class: 'p-id' }, idLine) : null,
      ]);
      const domCell = el('td', {}, p.dominant
        ? el('span', { class: `dom-tag el-${p.dominant}` }, `${elEmoji(p.dominant)} ${elLabel(p.dominant)}`)
        : el('small', {}, '—'));
      const profCell = el('td', {}, p.percentages ? miniProfile(p.percentages) : el('small', {}, '—'));
      const matchCell = el('td', {}, p.match
        ? el('strong', {}, p.match.name || '—')
        : el('small', {}, '—'));
      // קישור לעמוד האישי (לפי קוד — אם אין טלפון)
      const linkCell = el('td', {}, p.personalCode
        ? el('a', { class: 'btn small', href: `/result/${encodeURIComponent(p.personalCode)}` }, 'עמוד אישי')
        : '');
      tb.appendChild(el('tr', {}, [nameCell, domCell, profCell, matchCell, linkCell]));
    });
    t.appendChild(tb);
    card.appendChild(t);
  }
  sessionView.appendChild(card);

  const again = el('div', { class: 'card', style: 'text-align:center' });
  again.appendChild(el('button', { onclick: () => { sessionView.style.display = 'none'; lookupCard.style.display = ''; window.scrollTo(0, 0); } }, 'מפגש אחר'));
  sessionView.appendChild(again);

  lookupCard.style.display = 'none';
  sessionView.style.display = 'block';
  window.scrollTo(0, 0);
}

lookupBtn.addEventListener('click', () => {
  const g = gameIdInput.value.trim();
  if (!g) return showErr('הזן מזהה משחק');
  load(g);
});
gameIdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBtn.click(); });

// טעינה אוטומטית: /session/<gameId>  או  ?game= / ?gameId=
(function boot() {
  const q = new URLSearchParams(location.search);
  const parts = location.pathname.split('/').filter(Boolean); // ['session', '<gameId>']
  const pathVal = parts[0] === 'session' && parts[1] ? decodeURIComponent(parts[1]) : '';
  const gameId = q.get('gameId') || q.get('game') || pathVal;
  if (gameId) { gameIdInput.value = gameId; load(gameId); }
})();
