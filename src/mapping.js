// ============================================================================
//  מיפוי יסודות — המרת טבלת "מספר שאלה × תשובה→יסוד" לאובייקטי שאלות
//  קלט: מטריצת שורות (מ-xlsx או csv). פלט: שאלות עם queId ו-answerId→element.
// ============================================================================

// כינויים באנגלית ליסודות (בנוסף למפתחות ולתוויות העבריות מההגדרות)
const EN_ALIASES = {
  fire: 'fire', flame: 'fire',
  water: 'water',
  air: 'air', wind: 'air',
  earth: 'earth', ground: 'earth', soil: 'earth',
};

export function normalizeElement(raw, validKeys = [], labelToKey = {}) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (validKeys.includes(lower)) return lower; // מפתח ישיר (fire/water/air/earth)
  if (labelToKey[v]) return labelToKey[v]; // תווית עברית (אש/מים/רוח/עפר)
  if (EN_ALIASES[lower]) return EN_ALIASES[lower];
  return null;
}

// פענוח CSV פשוט (תומך במרכאות ובפסיקים בתוך תא)
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * ממיר מטריצת שורות לרשימת שאלות.
 * שורה: [queId, יסוד-תשובה-1, יסוד-תשובה-2, ...].
 * שורת כותרת (אם התא הראשון אינו מספר) מדולגת.
 */
export function rowsToQuestions(rows, opts = {}) {
  const validKeys = opts.validKeys || ['fire', 'water', 'air', 'earth'];
  const labelToKey = opts.labelToKey || {};
  const existingByQueId = opts.existingByQueId || {};
  const warnings = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return { questions: [], warnings: ['הקובץ ריק'] };
  }

  // זיהוי שורת כותרת: אם התא הראשון אינו מספר
  let start = 0;
  const firstCell = String((rows[0] || [])[0] ?? '').trim();
  if (!/^\d+$/.test(firstCell)) start = 1;

  const byQueId = new Map();
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] || [];
    const qidRaw = String(row[0] ?? '').trim();
    if (qidRaw === '') continue; // שורה ריקה
    if (!/^\d+$/.test(qidRaw)) {
      warnings.push(`שורה ${i + 1}: מספר שאלה לא תקין ("${qidRaw}") — דולגה`);
      continue;
    }
    const queId = parseInt(qidRaw, 10);
    if (byQueId.has(queId)) warnings.push(`שאלה ${queId} מופיעה יותר מפעם אחת — נלקחה ההופעה האחרונה`);

    const options = [];
    for (let c = 1; c < row.length; c++) {
      const raw = String(row[c] ?? '').trim();
      if (raw === '') continue;
      const element = normalizeElement(raw, validKeys, labelToKey);
      if (!element) warnings.push(`שאלה ${queId}, תשובה ${c}: יסוד לא מוכר ("${raw}")`);
      options.push({ answerId: c, text: '', element: element || '', weight: 1 });
    }
    const existing = existingByQueId[queId];
    byQueId.set(queId, {
      id: existing?.id, // שמירת מזהה קיים אם השאלה כבר קיימת (שומר על טקסט/סדר)
      queId,
      text: existing?.text || `שאלה ${queId}`,
      options,
    });
  }

  const questions = [...byQueId.values()];
  questions.forEach((q, i) => { q.order = i + 1; });
  return { questions, warnings };
}
