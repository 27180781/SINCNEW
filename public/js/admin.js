import {
  api, setElements, ELEMENTS, ELEMENT_ORDER,
  elLabel, elColor, elEmoji, miniProfile, meter, toast, el, escapeHtml,
} from './api.js';

const state = { settings: null, questions: [], persPage: 0, persLimit: 24, persSearch: '', lastScore: null, mapping: [] };

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
  clearTimeout(inboxTimer); // עצירת רענון-הקלט האוטומטי במעבר טאב
  loaders[tab]?.();
});

// ============================================================
//  לוח בקרה
// ============================================================
async function loadDashboard() {
  // חיווי אחסון — כדי לוודא שהתוצאות נשמרות ב-PostgreSQL (קבוע) ולא בקובץ זמני
  const box = document.getElementById('storageInfo');
  box.innerHTML = '';
  try {
    const h = await api.get('/api/health');
    const isPg = h.storage === 'postgres';
    box.appendChild(el('div', {
      class: 'muted-box',
      style: `display:flex;align-items:center;gap:10px;border-color:${isPg ? 'var(--earth)' : '#e0b000'};background:${isPg ? '#f2f8ee' : '#fff8e6'};color:var(--ink)`,
    }, [
      el('span', { style: 'font-size:1.3rem' }, isPg ? '🗄️' : '⚠️'),
      isPg
        ? el('span', {}, [el('strong', {}, 'אחסון: PostgreSQL '), el('span', {}, '— התוצאות נשמרות לצמיתות (טלפון + עמוד אישי).')])
        : el('span', {}, [el('strong', { style: 'color:#b26a00' }, 'אחסון: קובץ JSON (זמני!) '), el('span', {}, '— בקפרובר הנתונים עלולים להימחק בפריסה. הגדר DATABASE_URL כדי לשמור ב-PostgreSQL.')]),
    ]));
  } catch { /* לא קריטי */ }

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
//  מיפוי יסודות (רשת עריכה + ייבוא Excel/CSV) — המקור היחיד למיפוי השאלות
// ============================================================
async function loadMapping() {
  const qs = await api.get('/api/questions');
  state.mapping = qs.map((q) => ({
    id: q.id,
    queId: q.queId ?? null,
    text: q.text || '',
    options: (q.options || []).map((o) => ({ id: o.id, answerId: o.answerId ?? null, text: o.text || '', element: o.element || '', weight: o.weight ?? 1 })),
  }));
  renderMappingGrid();
}

function mappingElementSelect(value, onChange) {
  const sel = el('select', { style: 'min-width:96px' });
  sel.appendChild(el('option', { value: '' }, '—'));
  ELEMENT_ORDER.forEach((k) => {
    const o = el('option', { value: k }, `${elEmoji(k)} ${elLabel(k)}`);
    if (k === value) o.selected = true;
    sel.appendChild(o);
  });
  const paint = () => { sel.style.color = sel.value ? elColor(sel.value) : ''; sel.style.fontWeight = sel.value ? '700' : ''; };
  paint();
  sel.addEventListener('change', () => { paint(); onChange(sel.value); });
  return sel;
}

function renderMappingGrid() {
  const box = document.getElementById('mappingGrid');
  box.innerHTML = '';
  const qs = state.mapping;
  document.getElementById('mappingCount').textContent = qs.length;
  if (!qs.length) { box.appendChild(el('div', { class: 'empty' }, 'אין שאלות. העלו קובץ או הוסיפו שאלה.')); return; }
  const maxOpts = Math.max(4, ...qs.map((q) => (q.options || []).length));

  const t = el('table');
  let head = '<thead><tr><th>מס׳ שאלה</th><th>טקסט השאלה (לזיהוי בלבד)</th>';
  for (let i = 1; i <= maxOpts; i++) head += `<th>תשובה ${i}</th>`;
  head += '<th></th></tr></thead>';
  t.innerHTML = head;
  const tb = el('tbody');
  qs.forEach((q, ri) => {
    const tr = el('tr');
    tr.appendChild(el('td', {}, el('input', {
      type: 'number', value: q.queId ?? '', style: 'width:70px',
      oninput: (e) => { q.queId = e.target.value === '' ? null : Number(e.target.value); },
    })));
    // טקסט חופשי לשאלה — לזיהוי ע"י העורך בלבד (לא נשלח למשחק; טקסט השאלה חי במערכת המשחק)
    tr.appendChild(el('td', {}, el('input', {
      type: 'text', value: q.text || '', placeholder: 'תיאור קצר לזיהוי', style: 'min-width:180px',
      oninput: (e) => { q.text = e.target.value; },
    })));
    for (let c = 0; c < maxOpts; c++) {
      if (!q.options[c]) q.options[c] = { answerId: c + 1, text: '', element: '', weight: 1 };
      const opt = q.options[c];
      if (opt.answerId == null) opt.answerId = c + 1;
      tr.appendChild(el('td', {}, mappingElementSelect(opt.element, (v) => { opt.element = v; })));
    }
    tr.appendChild(el('td', {}, el('button', {
      class: 'small danger', onclick: () => { state.mapping.splice(ri, 1); renderMappingGrid(); },
    }, '✕')));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  box.appendChild(t);
}

document.getElementById('addMappingRowBtn').addEventListener('click', () => {
  const maxQ = Math.max(0, ...state.mapping.map((q) => q.queId || 0));
  state.mapping.push({ queId: maxQ + 1, text: '', options: [1, 2, 3, 4].map((a) => ({ answerId: a, text: '', element: '', weight: 1 })) });
  renderMappingGrid();
});

document.getElementById('saveMappingBtn').addEventListener('click', async () => {
  const payload = state.mapping.map((q, i) => ({
    id: q.id,
    queId: q.queId,
    order: i + 1,
    text: q.text != null ? q.text : '', // שומר טקסט ריק כפי שהוא (לא כופה ברירת מחדל)
    options: q.options.map((o, ci) => ({ id: o.id, answerId: o.answerId ?? ci + 1, text: o.text || '', element: o.element || '', weight: 1 })),
  }));
  try {
    await api.put('/api/questions', payload);
    toast('המיפוי נשמר');
    loadMapping();
  } catch (e) { toast(e.message, true); }
});

document.getElementById('clearMappingBtn').addEventListener('click', async () => {
  if (!confirm('למחוק את כל המיפוי? כל השאלות יימחקו (אפשר להעלות מחדש מקובץ).')) return;
  try {
    await api.put('/api/questions', []);
    toast('כל המיפוי נמחק');
    loadMapping();
  } catch (e) { toast(e.message, true); }
});

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

document.getElementById('importMappingBtn').addEventListener('click', () => document.getElementById('mappingFile').click());
document.getElementById('mappingFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const mode = confirm('להחליף את כל השאלות הקיימות במיפוי מהקובץ?\n\nאישור = החלפה מלאה · ביטול = מיזוג לפי מספר שאלה') ? 'replace' : 'merge';
  try {
    const buf = await file.arrayBuffer();
    const r = await api.post('/api/questions/import-mapping', { filename: file.name, dataBase64: arrayBufferToBase64(buf), mode });
    toast(`יובאו ${r.imported} שאלות (${r.mode === 'replace' ? 'החלפה' : 'מיזוג'})`);
    if (r.warnings && r.warnings.length) alert('אזהרות:\n' + r.warnings.slice(0, 25).join('\n'));
    loadMapping();
  } catch (err) {
    toast(err.message, true);
  }
  e.target.value = '';
});

document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  const csv = 'מספר שאלה,תשובה 1,תשובה 2,תשובה 3,תשובה 4\n7,water,fire,earth,air\n8,fire,earth,air,water\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'mapping-template.csv' });
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('importMappingJsonBtn').addEventListener('click', () => {
  const form = el('div');
  form.appendChild(el('h2', {}, 'ייבוא מיפוי מ-JSON'));
  form.appendChild(el('div', { class: 'muted-box' }, [
    el('div', {}, 'מערך של שאלות. לכל שאלה: מספר שאלה, טקסט (לזיהוי), ושיוך כל תשובה ליסוד:'),
    el('div', { style: 'margin-top:6px;font-family:monospace;font-size:.8rem;direction:ltr;text-align:left' },
      '[{"question_id":"q7","question_text":"…","answers_mapping":{"1":"water","2":"fire","3":"earth","4":"air"}}]'),
  ]));
  const ta = el('textarea', { style: 'min-height:220px;direction:ltr;text-align:left', placeholder: '[ … ]' });
  const mode = el('select');
  mode.appendChild(el('option', { value: 'replace' }, 'החלפת כל המיפוי'));
  mode.appendChild(el('option', { value: 'merge' }, 'מיזוג לפי מספר שאלה'));
  form.appendChild(el('div', { class: 'field', style: 'margin-top:10px' }, ta));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'אופן'), mode]));
  form.appendChild(el('div', { class: 'row' }, [
    el('button', { class: 'primary', onclick: async () => {
      let arr;
      try { arr = JSON.parse(ta.value); } catch { return toast('JSON לא תקין', true); }
      if (!Array.isArray(arr)) return toast('נדרש מערך שאלות', true);
      try {
        const r = await api.post('/api/questions/import-mapping', { mapping: arr, mode: mode.value });
        closeModal();
        toast(`יובאו ${r.imported} שאלות (${r.mode === 'replace' ? 'החלפה' : 'מיזוג'})`);
        if (r.warnings && r.warnings.length) alert('אזהרות:\n' + r.warnings.slice(0, 25).join('\n'));
        loadMapping();
      } catch (e) { toast(e.message, true); }
    } }, 'ייבוא'),
    el('button', { onclick: closeModal }, 'ביטול'),
  ]));
  openModal(form);
});

// ============================================================
//  סוגי אישיות
// ============================================================
async function loadPersonalities() {
  if (!state.settings) { try { state.settings = await api.get('/api/settings'); } catch { /* לא קריטי */ } }
  const offset = state.persPage * state.persLimit;
  const qs = new URLSearchParams({ limit: state.persLimit, offset, search: state.persSearch });
  const data = await api.get(`/api/personalities?${qs}`);
  // אם העמוד הנוכחי התרוקן (למשל אחרי מחיקה) — חזרה לעמוד תקין אחרון
  if (data.items.length === 0 && state.persPage > 0 && data.total > 0) {
    state.persPage = Math.max(0, Math.ceil(data.total / state.persLimit) - 1);
    return loadPersonalities();
  }
  document.getElementById('persCount').textContent = data.total;
  const list = document.getElementById('personalitiesList');
  list.innerHTML = '';
  const variants = (state.settings?.variants) || [];
  const t = el('table');
  t.innerHTML = '<thead><tr><th>מס׳</th><th>שם</th><th>פרופיל</th><th>אחוזים</th><th></th></tr></thead>';
  const tb = el('tbody');
  data.items.forEach((p) => {
    const pct = ELEMENT_ORDER.map((k) => `${elEmoji(k)}${p.profile[k] || 0}`).join(' · ');
    // תגיות גרסאות: לכל גרסה שיש לה טקסט לסוג הזה — תגית עם תצוגה מקדימה בריחוף, ולחיצה פותחת עריכה
    const vBadges = [];
    for (const v of variants) {
      const vt = p.variantTexts && p.variantTexts[v.id];
      if (vt && (vt.name || vt.description)) {
        const preview = `${v.label || v.id}\nשם: ${vt.name || '(ברירת מחדל)'}\n${(vt.description || '').slice(0, 400)}`;
        vBadges.push(el('span', {
          class: 'badge', title: preview,
          style: 'background:#efe9ff;color:#6b4fd6;cursor:pointer;margin-inline-end:4px',
          onclick: () => editPersonality(p),
        }, `🎭 ${v.label || v.id}`));
      }
    }
    tb.appendChild(el('tr', {}, [
      el('td', {}, el('span', { class: 'badge' }, p.number != null ? String(p.number) : '—')),
      el('td', {}, [
        el('strong', {}, p.name),
        el('div', {}, el('small', {}, p.description || '')),
        vBadges.length ? el('div', { style: 'margin-top:5px' }, vBadges) : null,
      ]),
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
  const numberI = el('input', { type: 'number', value: data.number ?? '', placeholder: 'ריק = אוטומטי' });
  const descI = el('textarea', { style: 'min-height:60px;font-family:inherit', value: data.description || '' });
  descI.value = data.description || '';
  form.appendChild(el('div', { class: 'grid cols-2' }, [
    el('div', { class: 'field' }, [el('label', {}, 'שם'), nameI]),
    el('div', { class: 'field' }, [el('label', {}, 'מספר (קובץ שמע בימות)'), numberI]),
  ]));
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

  // טקסטי גרסאות (אם הוגדרו גרסאות) — שם/תיאור חלופיים לפי גרסה
  const variantInputs = {};
  const variants = (state.settings?.variants) || [];
  if (variants.length) {
    form.appendChild(el('label', { style: 'margin-top:8px' }, '🎭 טקסט לפי גרסה (ריק = משתמש בברירת המחדל)'));
    variants.forEach((v) => {
      const vt = (data.variantTexts && data.variantTexts[v.id]) || {};
      const nameV = el('input', { value: vt.name || '', placeholder: 'שם (ריק = ברירת מחדל)' });
      const descV = el('textarea', { style: 'min-height:50px;font-family:inherit', value: vt.description || '' });
      descV.value = vt.description || '';
      variantInputs[v.id] = { nameV, descV };
      form.appendChild(el('div', { class: 'card', style: 'padding:12px' }, [
        el('div', { style: 'font-weight:700;margin-bottom:6px' }, `גרסה: ${v.label || v.id}`),
        el('div', { class: 'field' }, [el('label', {}, 'שם'), nameV]),
        el('div', { class: 'field', style: 'margin:0' }, [el('label', {}, 'תיאור'), descV]),
      ]));
    });
  }

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
    const payload = {
      name: nameI.value.trim(),
      number: numberI.value.trim() === '' ? null : Number(numberI.value),
      description: descI.value.trim(),
      profile,
    };
    // טקסטי גרסאות: משמרים את הקיים ומעדכנים לפי מה שהוזן
    const variantTexts = { ...(data.variantTexts || {}) };
    for (const [vid, { nameV, descV }] of Object.entries(variantInputs)) {
      const nm = nameV.value.trim(); const ds = descV.value.trim();
      if (nm || ds) variantTexts[vid] = { name: nm, description: ds };
      else delete variantTexts[vid];
    }
    payload.variantTexts = variantTexts;
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

document.getElementById('renumberPersBtn').addEventListener('click', async () => {
  const all = confirm('למספר מחדש 1..N את כל סוגי האישיות לפי הסדר?\n\nאישור = מספור מלא 1..N (מאפס מספרים קיימים)\nביטול = השלמת מספרים חסרים בלבד');
  try {
    const r = await api.post('/api/personalities/renumber', { mode: all ? 'all' : 'fill' });
    toast(`מוספרו ${r.renumbered} סוגים`);
    loadPersonalities();
  } catch (e) { toast(e.message, true); }
});

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

document.getElementById('clearPersBtn').addEventListener('click', async () => {
  const total = document.getElementById('persCount').textContent;
  if (!confirm(`למחוק את כל ${total} סוגי האישיות הקיימים?\n\nפעולה זו אינה הפיכה. (טיפ: אפשר גם פשוט להעלות קובץ במצב "החלפת המאגר הקיים".)`)) return;
  try {
    await api.del('/api/personalities');
    toast('כל סוגי האישיות נמחקו');
    state.persPage = 0; loadPersonalities();
  } catch (e) { toast(e.message, true); }
});

document.getElementById('importPersFileBtn').addEventListener('click', async () => {
  const form = el('div');
  form.appendChild(el('h2', {}, 'העלאת סוגי אישיות מקובץ Excel/CSV'));
  form.appendChild(el('div', { class: 'muted-box' }, [
    el('div', {}, 'מבנה העמודות (עם שורת כותרת):'),
    el('div', { style: 'margin-top:6px;font-weight:700' }, 'מספר אישיות · שם (אופציונלי) · אחוז אש · אחוז מים · אחוז רוח · אחוז עפר · תיאור'),
    el('div', { style: 'margin-top:6px' }, 'התיאור המלא יוצג בעמוד האישי של כל מי שהאישיות הזו הותאמה לו.'),
  ]));
  const file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: 'padding:8px' });
  const mode = el('select');
  mode.appendChild(el('option', { value: 'replace' }, 'החלפת המאגר הקיים'));
  mode.appendChild(el('option', { value: 'append' }, 'הוספה למאגר הקיים'));
  // בחירת יעד: המאגר הראשי (ברירת מחדל) או גרסה — לגרסה מעדכנים רק שם/תיאור לפי מספר האישיות
  const target = el('select');
  target.appendChild(el('option', { value: '' }, 'המאגר הראשי (ברירת מחדל)'));
  const s = state.settings || (state.settings = await api.get('/api/settings').catch(() => ({})));
  (s.variants || []).forEach((v) => target.appendChild(el('option', { value: v.id }, `גרסה: ${v.label || v.id}`)));
  const modeField = el('div', { class: 'field' }, [el('label', {}, 'אופן'), mode]);
  const targetNote = el('div', { class: 'muted-box', style: 'display:none' }, 'ייבוא לגרסה: מעדכן רק את השם והתיאור לפי מספר האישיות (האחוזים נשמרים מהמאגר הראשי).');
  target.addEventListener('change', () => {
    const isVariant = !!target.value;
    modeField.style.display = isVariant ? 'none' : '';
    targetNote.style.display = isVariant ? '' : 'none';
  });
  form.appendChild(el('div', { class: 'field', style: 'margin-top:12px' }, [el('label', {}, 'קובץ (xlsx / csv)'), file]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'יעד'), target]));
  form.appendChild(targetNote);
  form.appendChild(modeField);
  const status = el('div', { style: 'margin:8px 0;color:var(--muted)' });
  form.appendChild(status);
  form.appendChild(el('div', { class: 'row' }, [
    el('button', { class: 'primary', onclick: async () => {
      const f = file.files && file.files[0];
      if (!f) return toast('בחר קובץ', true);
      status.textContent = 'מעלה ומעבד…';
      try {
        const dataBase64 = await fileToBase64(f);
        const payload = target.value ? { dataBase64, variant: target.value } : { dataBase64, mode: mode.value };
        const r = await api.post('/api/personalities/import-file', payload);
        closeModal();
        toast(target.value ? `עודכנו ${r.updated} סוגים בגרסה` : `יובאו ${r.imported} סוגי אישיות`);
        if (r.warnings && r.warnings.length) alert('אזהרות:\n' + r.warnings.slice(0, 25).join('\n'));
        state.persPage = 0; loadPersonalities();
      } catch (e) { status.textContent = ''; toast(e.message, true); }
    } }, 'ייבוא'),
    el('button', { onclick: closeModal }, 'ביטול'),
  ]));
  openModal(form);
});

// קריאת קובץ ל-base64 (ללא הקידומת data:)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const s = String(reader.result); resolve(s.slice(s.indexOf(',') + 1)); };
    reader.onerror = () => reject(new Error('כשל בקריאת הקובץ'));
    reader.readAsDataURL(file);
  });
}

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
async function loadIntegration() {
  try {
    const info = await api.get('/api/integration');
    document.getElementById('webhookUrl').value = window.location.origin + info.webhookPath;
    document.getElementById('integrationToken').textContent = info.tokenRequired ? '🔒 נדרש token ב-URL' : 'ללא טוקן';
    if (info.introTextPath) document.getElementById('introTextUrl').value = window.location.origin + info.introTextPath;
    if (info.archetypePath) document.getElementById('archetypeUrl').value = window.location.origin + info.archetypePath;
  } catch { /* אין קריטי */ }
}
function copyInput(id) {
  const inp = document.getElementById(id);
  inp.select();
  const done = () => toast('הכתובת הועתקה');
  if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(done).catch(() => { document.execCommand('copy'); done(); });
  else { document.execCommand('copy'); done(); }
}
document.getElementById('copyWebhookBtn').addEventListener('click', () => copyInput('webhookUrl'));
document.getElementById('copyIntroUrlBtn').addEventListener('click', () => copyInput('introTextUrl'));
document.getElementById('copyArchetypeUrlBtn').addEventListener('click', () => copyInput('archetypeUrl'));

// ---- סימולטור שיחה (תצוגה + הקראה בדפדפן) ----
let simText = '';
const SIM_DEFAULTS = { fire: 40, water: 30, air: 20, earth: 10 };

function buildSimElements() {
  const box = document.getElementById('simElements');
  if (!box || box.childElementCount) return; // בונים פעם אחת
  ELEMENT_ORDER.forEach((k) => {
    box.appendChild(el('div', { class: 'field' }, [
      el('label', { class: `el-text-${k}` }, `${elEmoji(k)} ${elLabel(k)}`),
      el('input', { type: 'number', min: 0, max: 100, id: `sim_${k}`, value: SIM_DEFAULTS[k] ?? 25 }),
    ]));
  });
}

function renderSimResult(text, yemot, archetype) {
  simText = text || '';
  const box = document.getElementById('simResult');
  box.style.display = 'block';
  box.innerHTML = '';
  box.appendChild(el('div', { class: 'muted-box', style: 'white-space:pre-wrap;line-height:1.8;font-size:1.02rem' }, text || '(אין טקסט)'));
  if (archetype && (archetype.number != null || archetype.name)) {
    const parts = [];
    if (archetype.name) parts.push(`🎭 ${archetype.name}`);
    if (archetype.number != null) parts.push(`מספר: ${archetype.number}`);
    if (archetype.similarity != null) parts.push(`התאמה ${archetype.similarity}%`);
    box.appendChild(el('div', { class: 'muted-box', style: 'margin-top:8px;font-weight:700;border-inline-start:4px solid var(--accent)' },
      `🔢 שלוחה 1 תחזיר את המספר: ${parts.join(' · ')}`));
  }
  if (yemot) {
    const det = el('details', { style: 'margin-top:8px' });
    det.appendChild(el('summary', { style: 'cursor:pointer;font-weight:700' }, 'פורמט ימות (id_list_message — מה שנשלח לפתיח)'));
    const pre = el('pre', { style: 'white-space:pre-wrap;background:#f8f9fc;padding:10px;border-radius:8px;font-size:.78rem;overflow:auto' });
    pre.textContent = yemot;
    det.appendChild(pre);
    box.appendChild(det);
  }
}

function simSpeak() {
  if (!simText) return toast('צור תצוגה קודם', true);
  if (!('speechSynthesis' in window)) return toast('הדפדפן לא תומך בהקראה', true);
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(simText);
  u.lang = 'he-IL';
  u.rate = 0.95;
  const voices = window.speechSynthesis.getVoices();
  const he = voices.find((v) => (v.lang || '').toLowerCase().startsWith('he'));
  if (he) u.voice = he;
  window.speechSynthesis.speak(u);
}

document.getElementById('simGenerate').addEventListener('click', async () => {
  const name = document.getElementById('simName').value.trim();
  const percentages = {};
  ELEMENT_ORDER.forEach((k) => { percentages[k] = Number(document.getElementById(`sim_${k}`).value) || 0; });
  try {
    const r = await api.post('/api/intro-preview', { name, percentages });
    renderSimResult(r.text, r.yemot, r.match);
  } catch (e) { toast(e.message, true); }
});

document.getElementById('simLoadPhone').addEventListener('click', async () => {
  const phone = document.getElementById('simPhone').value.trim();
  if (!phone) return toast('הזן מספר טלפון', true);
  const enc = encodeURIComponent(phone);
  try {
    const [text, yemot, number] = await Promise.all([
      fetch(`/api/get-intro-text?ApiPhone=${enc}&format=text`).then((r) => r.text()),
      fetch(`/api/get-intro-text?ApiPhone=${enc}`).then((r) => r.text()),
      fetch(`/api/get-archetype/by-phone?ApiPhone=${enc}`).then((r) => r.text()),
    ]);
    renderSimResult(text, yemot, { number: number.trim() });
  } catch (e) { toast(e.message, true); }
});

document.getElementById('simSaveDemo').addEventListener('click', async () => {
  const phone = document.getElementById('simPhone').value.trim();
  if (!phone) return toast('הזן מספר טלפון לשמירת הדמו', true);
  const name = document.getElementById('simName').value.trim();
  const percentages = {};
  ELEMENT_ORDER.forEach((k) => { percentages[k] = Number(document.getElementById(`sim_${k}`).value) || 0; });
  try {
    const r = await api.post('/api/intro-demo', { phone, name, percentages });
    renderSimResult(r.text, r.yemot, r.match);
    toast(`נשמר! התקשר לימות עם ${r.phone} כדי לשמוע`);
    loadBatches();
  } catch (e) { toast(e.message, true); }
});

document.getElementById('simSpeak').addEventListener('click', simSpeak);
document.getElementById('simStop').addEventListener('click', () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); });

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
  const hasGame = result.results.some((r) => r.game);
  const t = el('table');
  const gameHead = hasGame ? '<th>🎮 ניקוד</th><th>✓ נכונות</th>' : '';
  t.innerHTML = `<thead><tr><th>משתתף</th>${ELEMENT_ORDER.map((k) => `<th>${escapeHtml(elEmoji(k))}</th>`).join('')}<th>דומיננטי</th><th>סוג אישיות</th><th>התאמה</th>${gameHead}</tr></thead>`;
  const tb = el('tbody');
  result.results.forEach((r) => {
    const cells = [
      el('td', {}, el('strong', {}, r.name || r.id)),
      ...ELEMENT_ORDER.map((k) => el('td', {}, `${r.percentages[k]}%`)),
      el('td', {}, r.dominant ? el('span', { class: `el-chip el-${r.dominant}` }, elLabel(r.dominant)) : '—'),
      el('td', {}, r.match ? [el('span', {}, r.match.name), r.match.number != null ? el('span', { class: 'badge', style: 'margin-inline-start:6px' }, `#${r.match.number}`) : null] : '—'),
      el('td', {}, r.match ? `${r.match.similarity}%` : '—'),
    ];
    if (hasGame) {
      cells.push(el('td', {}, r.game ? String(r.game.score ?? '—') : '—'));
      cells.push(el('td', {}, r.game ? `${r.game.numCorrect ?? 0}/${r.game.numAnswers ?? 0}` : '—'));
    }
    tb.appendChild(el('tr', {}, cells));
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
      el('div', {}, [
        b.source === 'game' ? el('span', { class: 'badge', title: 'התקבל ממערכת המשחק' }, '🎮 משחק') : null,
        b.source === 'import' ? el('span', { class: 'badge', style: 'background:#e6f0ff;color:#2a5db0', title: 'יובא ממערכת אחרת' }, '📥 ייבוא') : null,
        el('strong', { style: 'margin-inline-start:6px' }, b.name),
        el('div', {}, el('small', {}, `${b.count} משתתפים · ${new Date(b.createdAt).toLocaleDateString('he-IL')}`)),
      ]),
      el('div', { class: 'spacer' }),
      b.gameId ? el('a', { class: 'btn small', href: `/session/${encodeURIComponent(b.gameId)}`, target: '_blank', title: 'קישור ציבורי לצפייה בתוצאות המפגש' }, '🔗 קישור סשן') : null,
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

document.getElementById('importResultsBtn').addEventListener('click', () => {
  const form = el('div');
  form.appendChild(el('h2', {}, 'ייבוא תוצאות קיימות (CSV)'));
  form.appendChild(el('div', { class: 'muted-box' }, [
    el('div', {}, 'העלאת תוצאות שכבר חושבו במערכת אחרת — כדי שיוצגו כאן (עמוד אישי, סשן, טלפון בימות).'),
    el('div', { style: 'margin-top:6px' }, 'עמודות: game_id · processed_at · participant_id_phone · name · access_code · profile_fire/water/air/earth · archetype_id · archetype_score'),
    el('div', { style: 'margin-top:6px' }, 'archetype_id = מספר סוג האישיות · archetype_score = אחוז הסטיה. מיובא לפי מזהה משחק; ייבוא חוזר מעדכן.'),
  ]));
  const file = el('input', { type: 'file', accept: '.csv,.txt', style: 'padding:8px' });
  form.appendChild(el('div', { class: 'field', style: 'margin-top:12px' }, [el('label', {}, 'קובץ CSV'), file]));
  const status = el('div', { style: 'margin:8px 0;color:var(--muted)' });
  form.appendChild(status);
  form.appendChild(el('div', { class: 'row' }, [
    el('button', { class: 'primary', onclick: async () => {
      const f = file.files && file.files[0];
      if (!f) return toast('בחר קובץ', true);
      status.textContent = 'מעלה ומעבד…';
      try {
        const dataBase64 = await fileToBase64(f);
        const r = await api.post('/api/results/import', { dataBase64 });
        closeModal();
        toast(`יובאו ${r.imported} משחקים · ${r.participants} משתתפים`);
        const notes = [];
        if (r.replaced) notes.push(`${r.replaced} מפגשים עודכנו`);
        if (r.codeOnly) notes.push(`${r.codeOnly} ללא טלפון (לפי קוד)`);
        if (r.noProfile) notes.push(`${r.noProfile} ללא פילוח`);
        if (r.missingArchetype) notes.push(`${r.missingArchetype} עם סוג אישיות שלא קיים במאגר`);
        if (notes.length) alert('פרטים:\n' + notes.join('\n') + (r.warnings && r.warnings.length ? '\n\nאזהרות:\n' + r.warnings.slice(0, 15).join('\n') : ''));
        loadBatches();
      } catch (e) { status.textContent = ''; toast(e.message, true); }
    } }, 'ייבוא'),
    el('button', { onclick: closeModal }, 'ביטול'),
  ]));
  openModal(form);
});

// ============================================================
//  קלט Webhook — צפייה בקלט הגולמי שהמשחק שולח + הפירוש
// ============================================================
const INBOX_STATUS = {
  stored: { color: 'var(--earth)', label: '✓ נקלט ומופה' },
  duplicate: { color: '#b8860b', label: '↺ כפילות (כבר נקלט)' },
  error: { color: '#b91c1c', label: '✕ שגיאה' },
};

function inboxNotifyText(n) {
  if (!n.attempted) {
    const reasons = { disabled: 'צינתוק כבוי בהגדרות', 'no-token': 'YEMOT_TOKEN לא הוגדר בשרת', 'no-valid-phones': 'אין מספרי טלפון תקינים לחיוג' };
    return '📞 לא נשלח צינתוק — ' + (reasons[n.reason] || 'לא הופעל');
  }
  if (n.pending) return `📞 שולח צינתוק ל-${n.phones} מספרים… (רענן לעדכון)`;
  if (n.ok) return `📞 ✓ צינתוק נשלח בהצלחה ל-${n.phones} מספרים`;
  return `📞 ✕ צינתוק נכשל (${n.phones ?? '?'} מספרים): ${n.message || n.error || n.status || 'שגיאה'}`;
}

function inboxMasaLinkText(m) {
  if (!m.attempted) {
    const reasons = { disabled: 'MasaLink כבוי בהגדרות', 'no-credentials': 'חסרים Username/Token', 'no-email': 'אין מייל מפעיל במטען', 'no-link': 'אין מזהה משחק / כתובת בסיס לקישור' };
    return '🔗 לא נשלח MasaLink — ' + (reasons[m.reason] || 'לא הופעל');
  }
  if (m.pending) return `🔗 שולח MasaLink ל-${m.email}… (רענן לעדכון)`;
  if (m.ok) return `🔗 ✓ MasaLink נשלח ל-${m.email} · קישור: ${m.link || ''}`;
  return `🔗 ✕ MasaLink נכשל (${m.email || '?'}): ${m.error || m.status || 'שגיאה'}`;
}

function renderInboxEntry(e) {
  const card = el('div', { class: 'card' });
  const st = INBOX_STATUS[e.status] || { color: '#888', label: e.status };
  card.appendChild(el('div', { class: 'row' }, [
    el('span', { class: 'badge', style: `background:${st.color};color:#fff` }, st.label),
    el('strong', { style: 'margin-inline-start:6px' }, e.gameName || '(ללא שם משחק)'),
    el('small', { style: 'margin-inline-start:8px' },
      `${e.participantCount ?? '?'} משתתפים · ${e.method} · ${new Date(e.receivedAt).toLocaleString('he-IL')}`),
  ]));
  if (e.error) card.appendChild(el('div', { class: 'muted-box', style: 'color:#b91c1c;margin-top:8px' }, 'שגיאה: ' + e.error));
  // גרסת אפיון שנבחרה לפי שם המשחק
  if (e.variant) {
    const vlabel = ((state.settings?.variants) || []).find((v) => v.id === e.variant)?.label || e.variant;
    card.appendChild(el('div', { class: 'muted-box', style: 'margin-top:8px' }, `🎭 גרסת אפיון: ${vlabel}`));
  }
  // מטא-דאטה של מפעיל המשחק (נשמר לטיפול בהמשך)
  if (e.email || e.cloudinaryFolder) {
    const meta = el('div', { class: 'muted-box', style: 'margin-top:8px' }, [el('strong', {}, '📎 נשמר לטיפול בהמשך: ')]);
    if (e.email) meta.appendChild(el('span', { style: 'margin-inline-start:6px' }, `✉ מייל מפעיל: ${e.email}`));
    if (e.cloudinaryFolder) meta.appendChild(el('span', { style: 'margin-inline-start:12px' }, `🖼 תיקיית Cloudinary: ${e.cloudinaryFolder}`));
    card.appendChild(meta);
  }
  if (e.mappedMissing) card.appendChild(el('div', { class: 'muted-box', style: 'color:#b8860b;margin-top:8px' },
    'שים לב: אין מיפוי מוגדר במערכת — התשובות לא מופו ליסודות. העלה קובץ מיפוי בטאב "מיפוי יסודות".'));
  if (e.notify) card.appendChild(el('div', { class: 'muted-box', style: 'margin-top:8px' }, inboxNotifyText(e.notify)));
  if (e.masaLink) card.appendChild(el('div', { class: 'muted-box', style: 'margin-top:8px' }, inboxMasaLinkText(e.masaLink)));

  if (e.results && e.results.length) {
    const t = el('table');
    t.innerHTML = `<thead><tr><th>משתתף</th>${ELEMENT_ORDER.map((k) => `<th>${escapeHtml(elEmoji(k))}</th>`).join('')}<th>דומיננטי</th><th>סוג אישיות</th></tr></thead>`;
    const tb = el('tbody');
    e.results.forEach((r) => {
      tb.appendChild(el('tr', {}, [
        el('td', {}, el('strong', {}, r.name || String(r.number))),
        ...ELEMENT_ORDER.map((k) => el('td', {}, `${r.percentages?.[k] ?? 0}%`)),
        el('td', {}, r.dominant ? el('span', { class: `el-chip el-${r.dominant}` }, elLabel(r.dominant)) : '—'),
        el('td', {}, r.match ? `${r.match.name} (${r.match.similarity}%)` : '—'),
      ]));
    });
    t.appendChild(tb);
    card.appendChild(el('h4', { style: 'margin:12px 0 6px' }, 'פירוש — איך מופה ליסודות:'));
    card.appendChild(t);
  }

  const details = el('details', { style: 'margin-top:10px' });
  const summary = el('summary', { style: 'cursor:pointer;font-weight:700' }, 'הצג JSON גולמי כפי שהתקבל');
  details.appendChild(summary);
  const pre = el('pre', { style: 'white-space:pre-wrap;background:#f8f9fc;padding:12px;border-radius:8px;font-size:.78rem;max-height:340px;overflow:auto' });
  pre.textContent = JSON.stringify(e.raw, null, 2);
  details.appendChild(pre);
  card.appendChild(details);
  return card;
}

let inboxTimer = null;
async function loadInbox() {
  try {
    const info = await api.get('/api/integration');
    document.getElementById('inboxWebhookUrl').value = window.location.origin + info.webhookPath;
    document.getElementById('inboxTokenBadge').textContent = info.tokenRequired ? '🔒 נדרש token ב-URL' : 'ללא טוקן';
  } catch { /* לא קריטי */ }

  try {
    const data = await api.get('/api/games/inbox');
    const box = document.getElementById('inboxList');
    box.innerHTML = '';
    if (!data.items.length) {
      box.appendChild(el('div', { class: 'empty' }, 'עדיין לא התקבל קלט. שלח תוצאת משחק לכתובת שלמעלה — זה יופיע כאן.'));
    } else {
      data.items.forEach((entry) => box.appendChild(renderInboxEntry(entry)));
    }
  } catch (e) { toast(e.message, true); }

  // רענון אוטומטי כל 5 שניות כל עוד הטאב פעיל
  clearTimeout(inboxTimer);
  if (document.getElementById('tab-inbox').classList.contains('active')) {
    inboxTimer = setTimeout(loadInbox, 5000);
  }
}

document.getElementById('refreshInboxBtn').addEventListener('click', loadInbox);
document.getElementById('clearInboxBtn').addEventListener('click', async () => {
  if (!confirm('לנקות את תיבת הקלט?')) return;
  try { await api.del('/api/games/inbox'); toast('נוקה'); loadInbox(); } catch (e) { toast(e.message, true); }
});
document.getElementById('copyInboxUrlBtn').addEventListener('click', () => {
  const inp = document.getElementById('inboxWebhookUrl');
  inp.select();
  const done = () => toast('הכתובת הועתקה');
  if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(done).catch(() => { document.execCommand('copy'); done(); });
  else { document.execCommand('copy'); done(); }
});

// ============================================================
//  הגדרות
// ============================================================
async function loadSettings() {
  const s = state.settings || (state.settings = await api.get('/api/settings'));
  document.getElementById('setTitle').value = s.title || '';
  document.getElementById('setSubtitle').value = s.subtitle || '';
  document.getElementById('setMetric').value = s.matching?.metric || 'euclidean';
  document.getElementById('setTopN').value = s.matching?.topN || 3;

  // הגדרות צינתוק
  const n = s.notify || {};
  document.getElementById('notifyEnabled').checked = !!n.enabled;
  document.getElementById('notifyOnlyAnswered').checked = n.onlyAnswered !== false;
  document.getElementById('notifyCallerId').value = n.callerId || '';
  document.getElementById('notifyTimeout').value = n.tzintukTimeOut || 9;
  // הגדרות MasaLink (Inforu)
  const ml = s.masaLink || {};
  document.getElementById('mlEnabled').checked = !!ml.enabled;
  document.getElementById('mlUsername').value = ml.username || '';
  document.getElementById('mlToken').value = ml.token || '';
  document.getElementById('mlEventName').value = ml.apiEventName || 'MASALINK';
  document.getElementById('mlLinkParam').value = ml.linkParam || 'Text27';
  document.getElementById('mlResultsBaseUrl').value = ml.resultsBaseUrl || '';
  document.getElementById('mlBaseUrl').value = ml.baseUrl || '';

  try {
    const info = await api.get('/api/integration');
    const badge = document.getElementById('notifyTokenBadge');
    badge.textContent = info.notifyTokenSet ? '🔑 YEMOT_TOKEN מוגדר' : '⚠ YEMOT_TOKEN חסר בשרת';
    badge.style.background = info.notifyTokenSet ? 'var(--earth)' : '#b91c1c';
    badge.style.color = '#fff';
    const mb = document.getElementById('masaLinkBadge');
    const mlInfo = info.masaLink || {};
    mb.textContent = !mlInfo.enabled ? 'כבוי' : (mlInfo.credentialsSet ? '🔑 מוגדר ופעיל' : '⚠ חסרים Username/Token');
    mb.style.background = !mlInfo.enabled ? '#9ca3af' : (mlInfo.credentialsSet ? 'var(--earth)' : '#b91c1c');
    mb.style.color = '#fff';
  } catch { /* לא קריטי */ }

  // גרסאות אפיון
  state.variants = (s.variants || []).map((v) => ({ ...v }));
  renderVariants();

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

// ---- גרסאות אפיון ----
function newVariantId() { return 'v_' + Math.random().toString(36).slice(2, 9); }
function renderVariants() {
  const box = document.getElementById('variantsEditor');
  box.innerHTML = '';
  const list = state.variants || [];
  if (!list.length) { box.appendChild(el('div', { class: 'empty', style: 'padding:12px' }, 'אין גרסאות. הוסף גרסה כדי לתמוך בכמה נוסחי אפיון (למשל זכר/נקבה).')); return; }
  list.forEach((v, i) => {
    const row = el('div', { class: 'row', style: 'border-bottom:1px solid var(--line);padding:8px 0;gap:8px' }, [
      el('div', { class: 'field', style: 'flex:1;margin:0' }, [el('label', {}, 'תווית'),
        el('input', { value: v.label || '', placeholder: 'למשל בנות', oninput: (e) => { v.label = e.target.value; } })]),
      el('div', { class: 'field', style: 'flex:2;margin:0' }, [el('label', {}, 'מילות זיהוי בשם המשחק (מופרד בפסיקים)'),
        el('input', { value: v.matchText || '', placeholder: 'למשל לבנות, נשים', oninput: (e) => { v.matchText = e.target.value; } })]),
      el('button', { class: 'small danger', title: 'מחיקת גרסה', onclick: () => { state.variants.splice(i, 1); renderVariants(); } }, '✕'),
    ]);
    box.appendChild(row);
  });
}
document.getElementById('addVariantBtn').addEventListener('click', () => {
  state.variants = state.variants || [];
  state.variants.push({ id: newVariantId(), label: '', matchText: '' });
  renderVariants();
});
document.getElementById('saveVariantsBtn').addEventListener('click', async () => {
  const variants = (state.variants || []).map((v) => ({ id: v.id || newVariantId(), label: (v.label || '').trim(), matchText: (v.matchText || '').trim() }));
  try {
    state.settings = await api.put('/api/settings', { variants });
    state.variants = (state.settings.variants || []).map((v) => ({ ...v }));
    renderVariants();
    toast('הגרסאות נשמרו');
  } catch (e) { toast(e.message, true); }
});

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

document.getElementById('saveNotifyBtn').addEventListener('click', async () => {
  const notify = {
    enabled: document.getElementById('notifyEnabled').checked,
    onlyAnswered: document.getElementById('notifyOnlyAnswered').checked,
    callerId: document.getElementById('notifyCallerId').value.trim(),
    tzintukTimeOut: Number(document.getElementById('notifyTimeout').value) || 9,
  };
  try {
    state.settings = await api.put('/api/settings', { notify });
    toast('הגדרות הצינתוק נשמרו');
  } catch (e) { toast(e.message, true); }
});

document.getElementById('notifyTestBtn').addEventListener('click', async () => {
  const phone = document.getElementById('notifyTestPhone').value.trim();
  if (!phone) return toast('הזן מספר טלפון', true);
  try {
    const r = await api.post('/api/notify/test', { phone });
    if (r.ok) toast('צינתוק בדיקה נשלח בהצלחה');
    else toast('נכשל: ' + (r.message || r.error || r.status || 'שגיאה'), true);
  } catch (e) { toast(e.message, true); }
});

document.getElementById('saveMasaLinkBtn').addEventListener('click', async () => {
  const masaLink = {
    enabled: document.getElementById('mlEnabled').checked,
    username: document.getElementById('mlUsername').value.trim(),
    token: document.getElementById('mlToken').value.trim(),
    apiEventName: document.getElementById('mlEventName').value.trim() || 'MASALINK',
    linkParam: document.getElementById('mlLinkParam').value.trim() || 'Text27',
    resultsBaseUrl: document.getElementById('mlResultsBaseUrl').value.trim(),
    baseUrl: document.getElementById('mlBaseUrl').value.trim() || undefined,
  };
  try {
    state.settings = await api.put('/api/settings', { masaLink });
    toast('הגדרות MasaLink נשמרו');
    loadSettings();
  } catch (e) { toast(e.message, true); }
});

document.getElementById('mlTestBtn').addEventListener('click', async () => {
  const email = document.getElementById('mlTestEmail').value.trim();
  const gameId = document.getElementById('mlTestGameId').value.trim();
  const box = document.getElementById('mlTestResult');
  box.innerHTML = '';
  if (!email) return toast('הזן מייל לבדיקה', true);
  try {
    const r = await api.post('/api/masalink/test', { email, gameId });
    const okMsg = r.ok ? '✓ נשלח בהצלחה' : '✕ נכשל';
    box.appendChild(el('div', { class: 'muted-box' }, [
      el('div', {}, `${okMsg} (סטטוס ${r.status ?? '?'}${r.statusId != null ? `, StatusId ${r.statusId}` : ''})`),
      r.link ? el('div', {}, [el('strong', {}, 'קישור שנשלח: '), el('a', { href: r.link, target: '_blank' }, r.link)]) : null,
      r.error ? el('div', { style: 'color:#b91c1c' }, r.error) : null,
      r.body ? el('small', {}, String(r.body).slice(0, 200)) : null,
    ]));
    if (r.ok) toast('MasaLink בדיקה נשלח'); else toast('MasaLink נכשל', true);
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
// ============================================================
//  ניתוח פיזור והצעות
// ============================================================
async function loadDistribution() {
  const box = document.getElementById('distSummary');
  box.innerHTML = 'טוען…';
  let d;
  try { d = await api.get('/api/distribution'); } catch (e) { box.textContent = e.message; return; }
  state.distribution = d;
  renderDistribution(d);
}

function renderDistribution(d) {
  const sum = document.getElementById('distSummary');
  sum.innerHTML = '';
  if (!d.total) { sum.appendChild(el('div', { class: 'empty' }, 'אין עדיין תוצאות לניתוח. ייבא/קלוט משחקים תחילה.')); document.getElementById('distTypes').innerHTML = ''; document.getElementById('distSuggestions').innerHTML = ''; return; }

  const improved = d.suggestions.length && d.effectiveAfter > d.effectiveBefore;
  sum.appendChild(el('div', { class: 'grid cols-2' }, [
    el('div', { class: 'card stat' }, [
      el('div', { class: 'num' }, d.suggestions.length ? `${d.effectiveBefore} → ${d.effectiveAfter}` : `${d.effectiveBefore}`),
      el('div', { class: 'lbl', style: improved ? 'color:var(--earth)' : '' }, 'סוגים אפקטיביים (גבוה = מפוזר יותר) — לפני ← אחרי ההצעות'),
    ]),
    el('div', { class: 'card stat' }, [
      el('div', { class: 'num' }, `${d.top10Before}%`),
      el('div', { class: 'lbl' }, 'מהמשתתפים ב-10 הסוגים הגדולים (נמוך = מפוזר יותר)'),
    ]),
  ]));
  sum.appendChild(el('div', { class: 'muted-box', style: 'margin-top:10px' },
    `נותחו ${d.total} משתתפים · ${d.distinctUsed} סוגים בשימוש מתוך ${d.availableTypes} · ${d.overloadedCount} סוגים עמוסים (סף ${d.threshold}+ משתתפים).`));

  // פיזור לפי יסוד דומיננטי
  const maxDom = Math.max(1, ...ELEMENT_ORDER.map((k) => d.dominantSplit[k] || 0));
  const dom = el('div', { style: 'margin-top:12px' }, [el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'פיזור לפי יסוד דומיננטי')]);
  ELEMENT_ORDER.forEach((k) => {
    const c = d.dominantSplit[k] || 0;
    dom.appendChild(el('div', { class: 'meter' }, [
      el('div', { class: 'meter-head' }, [el('span', {}, `${elEmoji(k)} ${elLabel(k)}`), el('strong', {}, String(c))]),
      el('div', { class: 'bar' }, el('span', { style: `width:${Math.round((c / maxDom) * 100)}%;background:${elColor(k)}` })),
    ]));
  });
  sum.appendChild(dom);

  // טבלת סוגים לפי עומס
  const tBox = document.getElementById('distTypes');
  tBox.innerHTML = '';
  const t = el('table');
  t.innerHTML = '<thead><tr><th>מס׳</th><th>סוג אישיות</th><th>משתתפים</th><th>%</th><th>סטייה ממוצעת</th></tr></thead>';
  const tb = el('tbody');
  d.perType.forEach((r) => {
    tb.appendChild(el('tr', { style: r.overloaded ? 'background:#fff5f0' : '' }, [
      el('td', {}, el('span', { class: 'badge' }, r.number != null ? String(r.number) : '—')),
      el('td', {}, [el('span', {}, r.name), r.overloaded ? el('span', { class: 'badge', style: 'margin-inline-start:6px;background:#fde2d5;color:#c2410c' }, 'עמוס') : null]),
      el('td', {}, String(r.count)),
      el('td', {}, `${r.percent}%`),
      el('td', {}, `${r.avgDeviation}`),
    ]));
  });
  t.appendChild(tb); tBox.appendChild(t);

  // הצעות
  const sBox = document.getElementById('distSuggestions');
  sBox.innerHTML = '';
  if (!d.suggestions.length) { sBox.appendChild(el('div', { class: 'empty' }, 'אין הצעות כרגע — הפיזור סביר, או שאין מספיק נתונים.')); return; }
  d.suggestions.forEach((s, i) => {
    s._selected = true; // ברירת מחדל: נבחר
    const nameI = el('input', { value: s.name, oninput: (e) => { s.name = e.target.value; }, style: 'max-width:220px' });
    const chk = el('input', { type: 'checkbox', checked: 'checked', style: 'width:auto', onchange: (e) => { s._selected = e.target.checked; } });
    const pctText = ELEMENT_ORDER.map((k) => `${elEmoji(k)} ${s.profile[k] || 0}%`).join(' · ');
    sBox.appendChild(el('div', { class: 'row', style: 'border-bottom:1px solid var(--line);padding:10px 0;gap:10px;align-items:center' }, [
      el('label', { style: 'display:flex;align-items:center;gap:6px' }, [chk]),
      miniProfile(s.profile),
      el('div', { style: 'flex:1' }, [
        nameI,
        el('div', {}, el('small', {}, `${pctText} · מפצל את "${s.splitsType}" (${s.memberCount} משתתפים)`)),
      ]),
    ]));
  });
}

document.getElementById('refreshDistBtn').addEventListener('click', loadDistribution);
document.getElementById('applySuggestionsBtn').addEventListener('click', async () => {
  const sel = (state.distribution?.suggestions || []).filter((s) => s._selected);
  if (!sel.length) return toast('לא נבחרו הצעות', true);
  const personalities = sel.map((s) => ({ name: (s.name || '').trim() || 'סוג חדש', description: s.description || '', profile: s.profile }));
  try {
    const r = await api.post('/api/personalities/bulk', { mode: 'append', personalities });
    toast(`נוספו ${r.imported} סוגים`);
    loadDistribution();
  } catch (e) { toast(e.message, true); }
});

const loaders = {
  dashboard: loadDashboard,
  mapping: loadMapping,
  inbox: loadInbox,
  personalities: () => loadPersonalities(),
  distribution: loadDistribution,
  participants: () => { renderFormatHelp(); loadIntegration(); buildSimElements(); loadBatches(); if (!state.questions.length) api.get('/api/questions').then((q) => { state.questions = q; }); },
  settings: loadSettings,
};

async function init() {
  state.settings = await api.get('/api/settings');
  setElements(state.settings.elements);
  state.questions = await api.get('/api/questions');
  loadDashboard();
}
init().catch((e) => toast(e.message, true));
