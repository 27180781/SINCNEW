import { api, setElements, meter, elLabel, elColor, elEmoji, toast, el, ELEMENT_ORDER } from './api.js';

let config = null;

async function boot() {
  config = await api.get('/api/config');
  setElements(config.elements);
  document.getElementById('title').textContent = config.title || 'מבחן ארבעת היסודות';
  document.getElementById('subtitle').textContent = config.subtitle || '';
}

function renderQuiz() {
  const form = document.getElementById('quizForm');
  form.innerHTML = '';
  form.style.display = 'block';
  document.getElementById('intro').style.display = 'none';

  config.questions.forEach((q, qi) => {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, `${qi + 1}. ${q.text}`));
    q.options.forEach((o) => {
      const id = `${q.id}__${o.id}`;
      const opt = el('label', {
        style: 'display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;cursor:pointer;font-weight:500;color:var(--ink)'
      });
      opt.appendChild(el('input', { type: 'radio', name: q.id, value: o.id, id, style: 'width:auto' }));
      opt.appendChild(el('span', {}, o.text));
      card.appendChild(opt);
    });
    form.appendChild(card);
  });

  const submit = el('div', { class: 'card', style: 'text-align:center' }, [
    el('button', { class: 'primary', type: 'button', onclick: submitQuiz }, 'חשב/י את התוצאה שלי ✨')
  ]);
  form.appendChild(submit);
  window.scrollTo(0, 0);
}

async function submitQuiz() {
  const answers = {};
  let answered = 0;
  for (const q of config.questions) {
    const sel = document.querySelector(`input[name="${q.id}"]:checked`);
    if (sel) { answers[q.id] = sel.value; answered++; }
  }
  if (answered === 0) { toast('נא לענות על לפחות שאלה אחת', true); return; }

  const name = document.getElementById('pname').value.trim();
  const res = await api.post('/api/score', { participants: [{ name: name || 'אנונימי', answers }] });
  renderResult(res.results[0]);
}

function renderResult(r) {
  document.getElementById('quizForm').style.display = 'none';
  const box = document.getElementById('result');
  box.style.display = 'block';
  box.innerHTML = '';

  const head = el('div', { class: 'card' });
  head.appendChild(el('h1', {}, `התוצאה של ${r.name || 'המשתתף'}`));
  head.appendChild(el('small', {}, `נענו ${r.answered} מתוך ${r.questionCount} שאלות`));
  const meters = el('div', { style: 'margin-top:14px' });
  for (const k of ELEMENT_ORDER) meters.appendChild(meter(k, r.percentages[k] || 0));
  head.appendChild(meters);
  box.appendChild(head);

  if (r.match) {
    const m = r.match;
    const card = el('div', { class: 'card', style: `border-inline-start:6px solid ${elColor(r.dominant)}` });
    card.appendChild(el('div', { class: 'badge' }, `התאמה ${m.similarity}%`));
    card.appendChild(el('h2', { style: 'margin-top:8px;font-size:1.5rem' }, `${elEmoji(r.dominant)} ${m.name}`));
    card.appendChild(el('p', {}, m.description || ''));
    box.appendChild(card);
  }

  if (r.topMatches && r.topMatches.length > 1) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, 'סוגי אישיות קרובים נוספים'));
    const t = el('table');
    t.innerHTML = '<thead><tr><th>סוג אישיות</th><th>התאמה</th></tr></thead>';
    const tb = el('tbody');
    r.topMatches.slice(1).forEach((m) => {
      tb.appendChild(el('tr', {}, [el('td', {}, m.name), el('td', {}, `${m.similarity}%`)]));
    });
    t.appendChild(tb);
    card.appendChild(t);
    box.appendChild(card);
  }

  const again = el('div', { class: 'card', style: 'text-align:center' }, [
    el('button', { class: 'primary', onclick: () => location.reload() }, 'מבחן חדש')
  ]);
  box.appendChild(again);
  window.scrollTo(0, 0);
}

document.getElementById('startBtn').addEventListener('click', renderQuiz);
boot().catch((e) => toast(e.message, true));
