// ============================================================================
//  ייבוא סוגי אישיות מקובץ Excel/CSV
//  מבנה: מספר אישיות · שם (אופציונלי) · אחוז אש · אחוז מים · אחוז רוח · אחוז עפר · תיאור
//  התיאור המלא מוצג בעמוד האישי של כל משתתף שהאישיות הזו הותאמה לו.
// ============================================================================

import { parseCsv } from './mapping.js';

const NUM_RE = /מספר|number|\bid\b|#/i;
const NAME_RE = /שם|name/i;
const DESC_RE = /תיאור|פירוט|description|desc|טקסט/i;

const toPct = (v) => {
  const n = Number(String(v ?? '').replace('%', '').replace(/,/g, '.').trim());
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

// זיהוי עמודות לפי שורת הכותרת. נופל למיקום קבוע אם אין כותרת מזוהה.
function detectColumns(header, keys, keyToLabel) {
  const cols = { number: -1, name: -1, description: -1, elements: {} };
  (header || []).forEach((h, i) => {
    const t = String(h ?? '').trim();
    const low = t.toLowerCase();
    if (!t) return;
    if (cols.number < 0 && NUM_RE.test(t)) { cols.number = i; return; }
    if (cols.name < 0 && NAME_RE.test(t)) { cols.name = i; return; }
    if (cols.description < 0 && DESC_RE.test(t)) { cols.description = i; return; }
    for (const k of keys) {
      const label = keyToLabel[k];
      if (cols.elements[k] == null && ((label && t.includes(label)) || low.includes(k))) {
        cols.elements[k] = i; return;
      }
    }
  });
  return cols;
}

/**
 * ממיר מטריצת שורות לרשימת סוגי אישיות.
 * @param {string[][]} rows
 * @param {{ keys?: string[], keyToLabel?: Object }} opts
 * @returns {{ personalities: object[], warnings: string[] }}
 */
export function rowsToPersonalities(rows, opts = {}) {
  const keys = opts.keys && opts.keys.length ? opts.keys : ['fire', 'water', 'air', 'earth'];
  const keyToLabel = opts.keyToLabel || { fire: 'אש', water: 'מים', air: 'רוח', earth: 'עפר' };
  const nameFallback = opts.nameFallback !== false;   // false => שם ריק נשאר ריק (לייבוא גרסה)
  const requireProfile = opts.requireProfile !== false; // false => שורה ללא אחוזים לא מדולגת (ייבוא גרסה)
  const warnings = [];
  if (!Array.isArray(rows) || rows.length === 0) return { personalities: [], warnings: ['הקובץ ריק'] };

  // שורת כותרת קיימת אם התא הראשון אינו מספר
  const firstCell = String((rows[0] || [])[0] ?? '').trim();
  const hasHeader = !/^\d+$/.test(firstCell);
  const cols = hasHeader
    ? detectColumns(rows[0], keys, keyToLabel)
    : { number: -1, name: -1, description: -1, elements: {} };

  // השלמת עמודות חסרות במיקום קבוע: [מספר, שם, <keys...>, תיאור]
  if (cols.number < 0) cols.number = 0;
  if (cols.name < 0) cols.name = 1;
  keys.forEach((k, i) => { if (cols.elements[k] == null) cols.elements[k] = 2 + i; });
  if (cols.description < 0) cols.description = 2 + keys.length;

  const start = hasHeader ? 1 : 0;
  const list = [];
  const seen = new Set();
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] || [];
    // דילוג על שורה ריקה לגמרי
    if (!row.some((c) => String(c ?? '').trim() !== '')) continue;

    const numRaw = String(row[cols.number] ?? '').trim();
    const number = /^\d+$/.test(numRaw) ? parseInt(numRaw, 10) : null;

    const profile = {};
    let sum = 0;
    for (const k of keys) { const v = toPct(row[cols.elements[k]]); profile[k] = v; sum += v; }
    if (sum <= 0 && requireProfile) { warnings.push(`שורה ${i + 1}: כל האחוזים 0 — דולגה`); continue; }

    // דומיננטי (לשם ברירת מחדל)
    let dom = keys[0];
    for (const k of keys) if (profile[k] > profile[dom]) dom = k;

    let name = String(row[cols.name] ?? '').trim();
    if (!name && nameFallback) name = number != null ? `${keyToLabel[dom]} ${number}` : keyToLabel[dom];

    const description = String(row[cols.description] ?? '').trim();

    if (number != null) { if (seen.has(number)) warnings.push(`מספר אישיות ${number} מופיע יותר מפעם אחת`); seen.add(number); }
    list.push({ number, name, profile, description, generated: false });
  }
  return { personalities: list, warnings };
}

/** פענוח קלט גולמי (base64 של xlsx/csv, או csv/rows) לרשימת סוגי אישיות. */
export function parsePersonalitiesInput(body, parseXlsx, opts = {}) {
  let rows;
  if (Array.isArray(body.rows)) rows = body.rows;
  else if (typeof body.csv === 'string') rows = parseCsv(body.csv);
  else if (typeof body.dataBase64 === 'string') {
    const buf = Buffer.from(body.dataBase64, 'base64');
    if (buf[0] === 0x50 && buf[1] === 0x4b) rows = parseXlsx(buf); // חתימת ZIP => xlsx
    else rows = parseCsv(buf.toString('utf8'));
  } else throw new Error('נדרש קובץ (dataBase64) או שדה rows/csv');
  return rowsToPersonalities(rows, opts);
}
