import {
  api, setElements, ELEMENTS, ELEMENT_ORDER,
  elLabel, elColor, elEmoji, miniProfile, meter, toast, el,
} from './api.js';

const state = { settings: null, questions: [], persPage: 0, persLimit: 24, persSearch: '', lastScore: null };

// ---------------- מודאל ----------------
const modalBack = document.getElementById('modalBack');
function openModal(node) {
  const m = document.getElementById('modal');
  m.innerHTML = '';
  m.appendChild(node);
  modalBack.classList.add('open');
}
function closeModal() { modalBack.classList.remove('open'); }
modalBack.addEventListener('click', (e) => { if (e.target === modalBack) closeModal(); });

// ---------------- טאבים ----------------
document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  const tab = b.dataset.tab;
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  loaders[tab]?.();
});

// ============================================================
//  לוח בקרה
// ============================================================
async function loadDashboard() {
  const s = await api.get('/api/stats');
  const cards = document.getElementById('statCards');
  cards.innerHTML = '';
  const items = [
    ['שאלות', s.questions], ['סוגי אישיות', s.personalities],
    ['מפגשים', s.batches], ['משתתפים', s.participants],
  ];
  items.forEach(([lbl, num]) => {
    cards.appendChild(el('div', { class: 'card stat' }, [
      el('div', { class: 'num' }, String(num)), el('div', { class: 'lbl' }, lbl),
    ]));
  });

  const avg = document.getElementById('elemAverages');
  avg.innerHTML = '';
  if (!s.participants) avg.appendChild(el('div', { class: 'empty' }, 'אין עדיין נתוני משתתפים'));
  else for (const k of ELEMENT_ORDER) avg.appendChild(meter(k, s.elementAverages[k] || 0));

  const top = document.getElementById('topPersonalities');
  top.innerHTML = '';
  if (!s.topPersonalities.length) top.appendChild(el('div', { class: 'empty' }, 'אין עדיין התאמות'));
  else {
    const t = el('table');
    t.innerHTML = '<thead><tr><th>סוג אישיות</th><th>מספר משתתפים</th></tr></thead>';
    const tb = el('tbody');
    s.topPersonalities.forEach((p) => tb.appendChild(el('tr', {}, [el('td', {}, p.name), el('td', {}, String(p.count))])));
    t.appendChild(tb); top.appendChild(t);
  }
}

// ============================================================
//  שאלות
// ============================================================
async function loadQuestions() {
  state.questions = await api.get('/api/questions');
  const list = document.getElementById('questionsList');
  list.innerHTML = '';
  if (!state.questions.length) { list.appendChild(el('div', { class: 'empty' }, 'אין שאלות. הוסיפו שאלה חדשה.')); return; }
  state.questions.forEach((q, i) => {
    const card = el('div', { class: 'card', style: 'padding:14px' });
    const head = el('div', { class: 'row' }, [
      el('strong', {}, `${i + 1}. ${q.text}`), el('div', { class: 'spacer' }),
      el('button', { class: 'small', onclick: () => editQuestion(q) }, 'עריכה'),
      el('button', { class: 'small danger', onclick: () => delQuestion(q) }, 'מחיקה'),
    ]);
    card.appendChild(head);
    const opts = el('div', { class: 'row', style: 'margin-top:8px' });
    (q.options || []).forEach((o) => {
      opts.appendChild(el('span', { class: `el-chip el-${o.element}` }, `${elEmoji(o.element)} ${o.text}`));
    });
    card.appendChild(opts);
    list.appendChild(card);
  });
}

function elementSelect(value) {
  const sel = el('select');
  ELEMENT_ORDER.forEach((k) => {
    const o = el('option', { value: k }, `${elEmoji(k)} ${elLabel(k)}`);
    if (k === value) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

function editQuestion(q) {
  const isNew = !q;
  const data = q || { text: '', options: ELEMENT_ORDER.map((k) => ({ text: '', element: k })) };
  const form = el('div');
  form.appendChild(el('h2', {}, isNew ? 'שאלה חדשה' : 'עריכת שאלה'));
  const textField = el('div', { class: 'field' }, [el('label', {}, 'טקסט השאלה'), el('input', { id: 'q_text', value: data.text })]);
  form.appendChild(textField);
  form.appendChild(el('label', {}, 'אפשרויות (טקסט + יסוד)'));
  const optRows = [];
  const opts = (data.options && data.options.length ? data.options : ELEMENT_ORDER.map((k) => ({ text: '', element: k }))).slice(0, 4);
  while (opts.length < 4) opts.push({ text: '', element: ELEMENT_ORDER[opts.length] });
  opts.forEach((o) => {
    const input = el('input', { value: o.text, placeholder: 'טקסט התשובה' });
    const sel = elementSelect(o.element);
    optRows.push({ input, sel, id: o.id });
    form.appendChild(el('div', { class: 'row', style: 'margin-bottom:8px' }, [
      el('div', { style: 'flex:1' }, input), el('div', { style: 'width:130px' }, sel),
    ]));
  });
  const actions = el('div', { class: 'row', style: 'margin-top:12px' }, [
    el('button', { class: 'primary', onclick: save }, 'שמירה'),
    el('button', { onclick: closeModal }, 'ביטול'),
  ]);
  form.appendChild(actions);
  openModal(form);

  async function save() {
    const payload = {
      text: document.getElementById('q_text').value.trim(),
      options: optRows.map((r) => ({ id: r.id, text: r.input.value.trim(), element: r.sel.value, weight: 1 })),
    };
    if (!payload.text) return toast('טקסט השאלה חסר', true);
    try {
      if (isNew) await api.post('/api/questions', payload);
      else await api.put(`/api/questions/${q.id}`, payload);
      closeModal(); toast('נשמר'); loadQuestions();
    } catch (e) { toast(e.message, true); }
  }
}

async function delQuestion(q) {
  if (!confirm(`למחוק את השאלה "${q.text}"?`)) return;
  await api.del(`/api/questions/${q.id}`); toast('נמחק'); loadQuestions();
}
document.getElementById('addQuestionBtn').addEventListener('click', () => editQuestion(null));

// ============================================================
//  סוגי אישיות
// ============================================================
async function loadPersonalities() {
  const offset = state.persPage * state.persLimit;
  const qs = new URLSearchParams({ limit: state.persLimit, offset, search: state.persSearch });
  const data = await api.get(`/api/personalities?${qs}`);
  document.getElementById('persCount').textContent = data.total;
  const list = document.getElementById('personalitiesList');
  list.innerHTML = '';
  const t = el('table');
  t.innerHTML = '<thead><tr><th>שם</th><th>פרופיל</th><th>אחוזים</th><th></th></tr></thead>';
  const tb = el('tbody');
  data.items.forEach((p) => {
    const pct = ELEMENT_ORDER.map((k) => `${elEmoji(k)}${p.profile[k] || 0}`).join(' · ');
    tb.appendChild(el('tr', {}, [
      el('td', {}, [el('strong', {}, p.name), el('div', {}, el('small', {}, p.description || ''))]),
      el('td', {}, miniProfile(p.profile)),
      el('td', {}, el('small', {}, pct)),
      el('td', {}, el('div', { class: 'row' }, [
        el('button', { class: 'small', onclick: () => editPersonality(p) }, 'עריכה'),
        el('button', { class: 'small danger', onclick: () => delPersonality(p) }, '✕'),
      ])),
    ]));
  });
  t.appendChild(tb); list.appendChild(t);

  // עימוד
  const pager = document.getElementById('persPager');
  pager.innerHTML = '';
  const pages = Math.ceil(data.total / state.persLimit) || 1;
  pager.appendChild(el('button', { class: 'small', disabled: state.persPage === 0 ? '' : null, onclick: () => { state.persPage--; loadPersonalities(); } }, '‹ הקודם'));
  pager.appendChild(el('span', { style: 'padding:0 10px' }, `עמוד ${state.persPage + 1} מתוך ${pages}`));
  pager.appendChild(el('button', { class: 'small', disabled: state.persPage >= pages - 1 ? '' : null, onclick: () => { state.persPage++; loadPersonalities(); } }, 'הבא ›'));
}

let searchTimer;
document.getElementById('persSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.persSearch = e.target.value; state.persPage = 0; loadPersonalities(); }, 250);
});

function editPersonality(p) {
  const isNew = !p;
  const data = p || { name: '', description: '', profile: { fire: 25, water: 25, air: 25, earth: 25 } };
  const form = el('div');
  form.appendChild(el('h2', {}, isNew ? 'סוג אישיות חדש' : 'עריכת סוג אישיות'));
  const nameI = el('input', { value: data.name });
  const descI = el('textarea', { style: 'min-height:60px;font-family:inherit', value: data.description || '' });
  descI.value = data.description || '';
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'שם'), nameI]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'תיאור'), descI]));
  const inputs = {};
  const sumLabel = el('strong', {}, '');
  const grid = el('div', { class: 'grid cols-4' });
  ELEMENT_ORDER.forEach((k) => {
    const inp = el('input', { type: 'number', min: 0, max: 100, value: data.profile[k] ?? 0, oninput: updateSum });
    inputs[k] = inp;
    grid.appendChild(el('div', { class: 'field' }, [el('label', { class: `el-text-${k}` }, `${elEmoji(k)} ${elLabel(k)}`), inp]));
  });
  form.appendChild(el('label', {}, 'פרופיל היסודות (אחוזים)'));
  form.appendChild(grid);
  form.appendChild(el('div', { class: 'muted-box' }, [el('span', {}, 'סכום: '), sumLabel]));
  form.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
    el('button', { class: 'primary', onclick: save }, 'שמירה'),
    el('button', { onclick: closeModal }, 'ביטול'),
  ]));
  openModal(form);
  updateSum();

  function updateSum() {
    const sum = ELEMENT_ORDER.reduce((s, k) => s + (Number(inputs[k].value) || 0), 0);
    sumLabel.textContent = `${sum}%`;
    sumLabel.style.color = sum === 100 ? 'var(--earth)' : '#b91c1c';
  }
  async function save() {
    const profile = {};
    ELEMENT_ORDER.forEach((k) => { profile[k] = Number(inputs[k].value) || 0; });
    const payload = { name: nameI.value.trim(), description: descI.value.trim(), profile };
    if (!payload.name) return toast('שם חסר', true);
    try {
      if (isNew) await api.post('/api/personalities', payload);
      else await api.put(`/api/personalities/${p.id}`, payload);
      closeModal(); toast('נשמר'); loadPersonalities();
    } catch (e) { toast(e.message, true); }
  }
}

async function delPersonality(p) {
  if (!confirm(`למחוק את "${p.name}"?`)) return;
  await api.del(`/api/personalities/${p.id}`); toast('נמחק'); loadPersonalities();
}
document.getElementById('addPersBtn').addEventListener('click', () => editPersonality(null));

document.getElementById('genPersBtn').addEventListener('click', () => {
  const form = el('div');
  form.appendChild(el('h2', {}, 'חידוש מאגר סוגי אישיות'));
  form.appendChild(el('p', {}, 'המערכת תיצור אוטומטית סוגי אישיות עבור כל צירוף אחוזים אפשרי (בצעד שנבחר).'));
  const step = el('select');
  [[10, '286 סוגים (צעד 10%)'], [20, '56 סוגים (צעד 20%)'], [5, '1,771 סוגים (צעד 5%)']].forEach(([v, l]) => step.appendChild(el('option', { value: v }, l)));
  const mode = el('select');
  mode.appendChild(el('option', { value: 'replace' }, 'החלפת המאגר הקיים'));
  mode.appendChild(el('option', { value: 'append' }, 'הוספה למאגר הקיים'));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'רזולוציה'), step]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'אופן'), mode]));
  form.appendChild(el('div', { class: 'row' }, [
    el('button', { class: 'primary', onclick: async () => {
      try {
        const r = await api.post('/api/personalities/generate', { step: Number(step.value), mode: mode.value });
        closeModal(); toast(`נוצרו ${r.generated} סוגים`); state.persPage = 0; loadPersonalities();
      } catch (e) { toast(e.message, true); }
    } }, 'יצירה'),
    el('button', { onclick: closeModal }, 'ביטול'),
  ]));
  openModal(form);
});

document.getElementById('bulkPersBtn').addEventListener('click', () => {
  const form = el('div');
  form.appendChild(el('h2', {}, 'ייבוא סוגי אישיות (JSON)'));
  form.appendChild(el('div', { class: 'muted-box' }, 'מערך של אובייקטים: [{ "name": "...", "profile": { "fire": 40, "water": 30, "air": 20, "earth": 10 } }]'));
  const ta = el('textarea', { style: 'min-height:200px', placeholder: '[ … ]' });
  const mode = el('select');
  mode.appendChild(el('option', { value: 'append' }, 'הוספה למאגר'));
  mode.appendChild(el('option', { value: 'replace' }, 'החלפת המאגר'));
  form.appendChild(el('div', { class: 'field', style: 'margin-top:10px' }, ta));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'אופן'), mode]));
  form.appendChild(el('div', { class: 'row' }, [
    el('button', { class: 'primary', onclick: async () => {
      let arr;
      try { arr = JSON.parse(ta.value); } catch { return toast('JSON לא תקין', true); }
      if (!Array.isArray(arr)) return toast('נדרש מערך', true);
      try {
        const r = await api.post('/api/personalities/bulk', { personalities: arr, mode: mode.value });
        closeModal(); toast(`יובאו ${r.imported}`); state.persPage = 0; loadPersonalities();
      } catch (e) { toast(e.message, true); }
    } }, 'ייבוא'),
    el('button', { onclick: closeModal }, 'ביטול'),
  ]));
  openModal(form);
});

// ============================================================
//  שיוך משתתפים / ייבוא
// ============================================================
function exampleParticipants() {
  const qs = state.questions.length ? state.questions : [];
  const letters = ['A', 'B', 'C', 'D'];
  const mk = (name, pick) => ({ name, answers: Object.fromEntries(qs.map((q, i) => [q.id, letters[pick(i)]])) });
  return {
    name: 'מפגש לדוגמה',
    participants: [
      mk('דנה', (i) => i % 4),
      mk('יוסי', (i) => (i * 2) % 4),
      mk('מאיה', () => 1),
    ],
  };
}

function renderFormatHelp() {
  const box = document.getElementById('formatHelp');
  box.innerHTML = '';
  const example = {
    participants: [
      { id: 'p1', name: 'שם רשות', answers: { q1: 'A', q2: 'C', '…': '…' } },
    ],
  };
  box.appendChild(el('div', {}, 'כל משתתף: מזהה/שם (רשות) + answers הממפה שאלה → תשובה.'));
  box.appendChild(el('div', {}, 'תשובה יכולה להיות: אות (A/B/C/D), מספר (1–4), מזהה-אפשרות או מפתח יסוד.'));
  box.appendChild(el('pre', { style: 'white-space:pre-wrap;font-size:.78rem;margin-top:8px' }, JSON.stringify(example, null, 1)));
}

document.getElementById('loadExampleBtn').addEventListener('click', () => {
  const ex = exampleParticipants();
  document.getElementById('batchName').value = ex.name;
  document.getElementById('participantsJson').value = JSON.stringify({ participants: ex.participants }, null, 2);
  toast('נטענה דוגמה');
});

function parseParticipants() {
  const raw = document.getElementById('participantsJson').value.trim();
  if (!raw) { toast('אין קלט', true); return null; }
  let data;
  try { data = JSON.parse(raw); } catch { toast('JSON לא תקין', true); return null; }
  const participants = Array.isArray(data) ? data : data.participants;
  if (!Array.isArray(participants)) { toast('נדרש שדה participants (מערך)', true); return null; }
  return participants;
}

async function runScore(save) {
  const participants = parseParticipants();
  if (!participants) return;
  try {
    let result;
    if (save) {
      const name = document.getElementById('batchName').value.trim();
      const batch = await api.post('/api/batches', { name, participants });
      result = batch.result;
      toast('המפגש נשמר'); loadBatches();
    } else {
      result = await api.post('/api/score', { participants });
    }
    state.lastScore = result;
    renderScoreResults(result);
    document.getElementById('downloadResultsBtn').disabled = false;
  } catch (e) { toast(e.message, true); }
}
document.getElementById('runScoreBtn').addEventListener('click', () => runScore(false));
document.getElementById('saveBatchBtn').addEventListener('click', () => runScore(true));

document.getElementById('downloadResultsBtn').addEventListener('click', () => {
  if (!state.lastScore) return;
  const blob = new Blob([JSON.stringify(state.lastScore, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'results.json' });
  a.click(); URL.revokeObjectURL(a.href);
});

function renderScoreResults(result) {
  document.getElementById('scoreResults').style.display = 'block';
  const avg = document.getElementById('scoreAverages');
  avg.innerHTML = '<h3>ממוצע הקבוצה</h3>';
  const row = el('div', { class: 'grid cols-4' });
  for (const k of ELEMENT_ORDER) row.appendChild(el('div', { class: 'card stat', style: `border-top:3px solid ${elColor(k)}` }, [
    el('div', { class: 'num', style: `color:${elColor(k)}` }, `${result.averages[k] || 0}%`),
    el('div', { class: 'lbl' }, `${elEmoji(k)} ${elLabel(k)}`),
  ]));
  avg.appendChild(row);

  const wrap = document.getElementById('scoreTable');
  wrap.innerHTML = '';
  const t = el('table');
  t.innerHTML = `<thead><tr><th>משתתף</th>${ELEMENT_ORDER.map((k) => `<th>${elEmoji(k)}</th>`).join('')}<th>דומיננטי</th><th>סוג אישיות</th><th>התאמה</th></tr></thead>`;
  const tb = el('tbody');
  result.results.forEach((r) => {
    tb.appendChild(el('tr', {}, [
      el('td', {}, el('strong', {}, r.name || r.id)),
      ...ELEMENT_ORDER.map((k) => el('td', {}, `${r.percentages[k]}%`)),
      el('td', {}, r.dominant ? el('span', { class: `el-chip el-${r.dominant}` }, elLabel(r.dominant)) : '—'),
      el('td', {}, r.match ? r.match.name : '—'),
      el('td', {}, r.match ? `${r.match.similarity}%` : '—'),
    ]));
  });
  t.appendChild(tb); wrap.appendChild(t);
}

async function loadBatches() {
  const batches = await api.get('/api/batches');
  const box = document.getElementById('batchesList');
  box.innerHTML = '';
  if (!batches.length) { box.appendChild(el('div', { class: 'empty' }, 'אין מפגשים שמורים')); return; }
  batches.slice().reverse().forEach((b) => {
    box.appendChild(el('div', { class: 'row', style: 'border-bottom:1px solid var(--line);padding:6px 0' }, [
      el('div', {}, [el('strong', {}, b.name), el('div', {}, el('small', {}, `${b.count} משתתפים · ${new Date(b.createdAt).toLocaleDateString('he-IL')}`))]),
      el('div', { class: 'spacer' }),
      el('button', { class: 'small', onclick: () => viewBatch(b.id) }, 'הצגה'),
      el('button', { class: 'small danger', onclick: async () => { if (confirm('למחוק?')) { await api.del(`/api/batches/${b.id}`); loadBatches(); } } }, '✕'),
    ]));
  });
}
async function viewBatch(id) {
  const b = await api.get(`/api/batches/${id}`);
  state.lastScore = b.result;
  renderScoreResults(b.result);
  document.getElementById('downloadResultsBtn').disabled = false;
  document.getElementById('scoreResults').scrollIntoView({ behavior: 'smooth' });
}

// ============================================================
//  הגדרות
// ============================================================
async function loadSettings() {
  const s = state.settings || (state.settings = await api.get('/api/settings'));
  document.getElementById('setTitle').value = s.title || '';
  document.getElementById('setSubtitle').value = s.subtitle || '';
  document.getElementById('setMetric').value = s.matching?.metric || 'euclidean';
  document.getElementById('setTopN').value = s.matching?.topN || 3;

  const ed = document.getElementById('elementsEditor');
  ed.innerHTML = '';
  (s.elements || []).forEach((e, i) => {
    const card = el('div', { class: 'card', style: `border-inline-start:5px solid ${e.color}` });
    card.appendChild(el('div', { class: 'field' }, [el('label', {}, 'שם היסוד'), el('input', { value: e.label, id: `el_label_${i}` })]));
    card.appendChild(el('div', { class: 'row' }, [
      el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'צבע'), el('input', { type: 'color', value: e.color, id: `el_color_${i}` })]),
      el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'אימוג\'י'), el('input', { value: e.emoji, id: `el_emoji_${i}` })]),
    ]));
    ed.appendChild(card);
  });
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const s = state.settings;
  const elements = (s.elements || []).map((e, i) => ({
    ...e,
    label: document.getElementById(`el_label_${i}`).value,
    color: document.getElementById(`el_color_${i}`).value,
    emoji: document.getElementById(`el_emoji_${i}`).value,
  }));
  const payload = {
    title: document.getElementById('setTitle').value,
    subtitle: document.getElementById('setSubtitle').value,
    elements,
    matching: { metric: document.getElementById('setMetric').value, topN: Number(document.getElementById('setTopN').value) || 3 },
  };
  try {
    state.settings = await api.put('/api/settings', payload);
    setElements(state.settings.elements);
    toast('ההגדרות נשמרו');
  } catch (e) { toast(e.message, true); }
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  const data = await api.get('/api/export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'elements-db.json' });
  a.click(); URL.revokeObjectURL(a.href);
});
document.getElementById('resetBatchesBtn').addEventListener('click', async () => {
  if (!confirm('למחוק את כל המפגשים השמורים?')) return;
  await api.post('/api/reset', { what: 'batches' }); toast('נמחק'); loadBatches();
});
document.getElementById('resetAllBtn').addEventListener('click', async () => {
  if (!confirm('לאפס את כל המערכת לברירת המחדל? פעולה בלתי הפיכה.')) return;
  await api.post('/api/reset', { what: 'all' }); toast('המערכת אופסה'); location.reload();
});

// ============================================================
//  אתחול
// ============================================================
const loaders = {
  dashboard: loadDashboard,
  questions: loadQuestions,
  personalities: () => loadPersonalities(),
  participants: () => { renderFormatHelp(); loadBatches(); if (!state.questions.length) api.get('/api/questions').then((q) => { state.questions = q; }); },
  settings: loadSettings,
};

async function init() {
  state.settings = await api.get('/api/settings');
  setElements(state.settings.elements);
  state.questions = await api.get('/api/questions');
  loadDashboard();
}
init().catch((e) => toast(e.message, true));
