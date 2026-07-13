// ============================================================================
//  מפענח XLSX מינימלי (ללא תלות כבדה) — מחזיר מטריצת שורות/תאים כמחרוזות.
//  xlsx הוא ZIP של קבצי XML: מפרקים עם fflate וקוראים sharedStrings + הגיליון.
// ============================================================================

import { unzipSync, strFromU8 } from 'fflate';

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

// "B3" -> אינדקס עמודה 0-מבוסס (A=0)
function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));

  // 1) shared strings
  const shared = [];
  const sst = files['xl/sharedStrings.xml'];
  if (sst) {
    const xml = strFromU8(sst);
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml))) {
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      let s = '';
      while ((t = tRe.exec(m[1]))) s += decodeXml(t[1]);
      shared.push(s);
    }
  }

  // 2) הגיליון הראשון
  const sheetPath = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort()[0];
  if (!sheetPath) return [];

  const xml = strFromU8(files[sheetPath]);
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let autoCol = 0;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const body = cm[2] || '';
      const rMatch = /r="([A-Z]+\d+)"/.exec(attrs);
      const tMatch = /t="([^"]+)"/.exec(attrs);
      const colIdx = rMatch ? colToIndex(rMatch[1]) : autoCol;
      autoCol = colIdx + 1;
      const type = tMatch ? tMatch[1] : 'n';
      let val = '';
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        val = v ? shared[parseInt(v[1], 10)] ?? '' : '';
      } else if (type === 'inlineStr') {
        const v = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body);
        val = v ? decodeXml(v[1]) : '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        val = v ? decodeXml(v[1]) : '';
      }
      cells[colIdx] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}
