// ============================================================================
//  ייבוא תוצאות קיימות ממערכת אחרת (CSV) — כדי להציג אותן במערכת הזו
//  עמודות: game_id · processed_at · participant_id_phone · name · access_code
//          profile_fire/water/air/earth · archetype_id · archetype_score
//  archetype_id = מספר סוג האישיות (התאמה מוכנה); archetype_score = אחוז סטיה (0=מושלם).
// ============================================================================

import { parseCsv } from './mapping.js';
import { roundTo100, DEFAULT_ELEMENT_KEYS } from './scoring.js';
import { normalizePhone } from './tzintuk.js';

const round = (n, d = 0) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
const norm = (h) => String(h ?? '').replace(/﻿/g, '').trim().toLowerCase();
const toNum = (v) => { const n = Number(String(v ?? '').replace(/,/g, '.').trim()); return Number.isFinite(n) ? n : 0; };

/** נרמול טלפון מהקובץ: מוסיף 0 מוביל למספר בן 9 ספרות (נייד ישראלי ללא ה-0). */
export function importPhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 9) d = '0' + d; // 504179664 -> 0504179664
  return normalizePhone(d);
}

/** זיהוי עמודות לפי שמות הכותרת (עמיד לסדר; נופל למיקום קבוע אם חסר). */
export function detectResultColumns(header, keys = DEFAULT_ELEMENT_KEYS) {
  const idx = { gameId: null, sentAt: null, phone: null, name: null, code: null, archetypeId: null, score: null, elements: {} };
  (header || []).forEach((h, i) => {
    const t = norm(h);
    if (!t) return;
    if (idx.gameId == null && (t === 'game_id' || (t.includes('game') && t.includes('id')))) { idx.gameId = i; return; }
    if (idx.sentAt == null && (t.includes('processed') || t.includes('sent') || t.includes('date') || t === 'timestamp' || t.endsWith('_at'))) { idx.sentAt = i; return; }
    if (idx.archetypeId == null && t.includes('archetype') && t.includes('id')) { idx.archetypeId = i; return; }
    if (idx.score == null && t.includes('archetype') && (t.includes('score') || t.includes('dev'))) { idx.score = i; return; }
    if (idx.phone == null && t.includes('phone')) { idx.phone = i; return; }
    if (idx.code == null && (t.includes('access') || t.includes('code'))) { idx.code = i; return; }
    for (const k of keys) { if (idx.elements[k] == null && t.includes(k)) { idx.elements[k] = i; return; } }
    if (idx.name == null && t.includes('name')) { idx.name = i; return; }
  });
  return idx;
}

/**
 * ממיר שורות CSV לרשימת "משחקים" מוכנים לאחסון כמפגשים.
 * @returns {{ games: object[], stats: object, warnings: string[] }}
 */
export function buildImportedGames(rows, opts = {}) {
  const keys = opts.keys && opts.keys.length ? opts.keys : DEFAULT_ELEMENT_KEYS;
  const personalities = opts.personalities || [];
  const byNumber = new Map();
  for (const p of personalities) if (p.number != null) byNumber.set(Number(p.number), p);
  const warnings = [];

  if (!Array.isArray(rows) || rows.length === 0) return { games: [], stats: { games: 0, participants: 0 }, warnings: ['הקובץ ריק'] };

  const c = detectResultColumns(rows[0], keys);
  if (c.gameId == null || c.phone == null) {
    // מיקום קבוע כגיבוי: [game_id, processed_at, phone, name, code, fire, water, air, earth, aid, score]
    c.gameId = c.gameId ?? 0; c.sentAt = c.sentAt ?? 1; c.phone = c.phone ?? 2; c.name = c.name ?? 3; c.code = c.code ?? 4;
    keys.forEach((k, i) => { if (c.elements[k] == null) c.elements[k] = 5 + i; });
    c.archetypeId = c.archetypeId ?? 5 + keys.length; c.score = c.score ?? 6 + keys.length;
  }

  const gamesMap = new Map();
  let missingArchetype = 0, withPhone = 0, codeOnly = 0, noProfile = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((x) => String(x ?? '').trim() !== '')) continue; // שורה ריקה
    const gameId = String(row[c.gameId] ?? '').trim();
    if (!gameId) { warnings.push(`שורה ${i + 1}: אין מזהה משחק — דולגה`); continue; }

    const phone = importPhone(row[c.phone]);
    const code = String(row[c.code] ?? '').trim();
    const name = String(row[c.name] ?? '').trim();
    if (phone) withPhone++; else if (code) codeOnly++;

    const profileRaw = {};
    let sum = 0;
    for (const k of keys) { const v = Math.max(0, toNum(row[c.elements[k]])); profileRaw[k] = v; sum += v; }
    const answered = sum > 0 ? 1 : 0;
    if (!answered) noProfile++;
    const percentages = roundTo100(profileRaw, keys);
    let dominant = null;
    if (sum > 0) { let best = -1; for (const k of keys) if (profileRaw[k] > best) { best = profileRaw[k]; dominant = k; } }

    const aidRaw = String(row[c.archetypeId] ?? '').trim();
    const number = /^\d+$/.test(aidRaw) ? parseInt(aidRaw, 10) : null;
    const score = toNum(row[c.score]);
    const pers = number != null ? byNumber.get(number) : null;
    if (number != null && !pers) missingArchetype++;
    const match = number == null && !pers ? null : {
      id: pers?.id ?? null,
      name: pers?.name ?? (number != null ? `סוג ${number}` : null),
      number: number ?? null,
      description: pers?.description ?? '',
      similarity: round(Math.max(0, Math.min(100, 100 - score)), 1),
      deviation: round(score, 2), // אחוז הסטיה כפי שהתקבל מהמערכת האחרת
    };

    const result = {
      id: phone || code || name || `p${i}`,
      name: name || null,
      personalCode: phone ? null : (code || null), // קוד אישי רק למי שאין לו טלפון
      answered,
      counts: percentages, // לצורך זיהוי הדומיננטי בהקראת ימות
      percentages,
      percentagesRaw: profileRaw,
      dominant,
      match,
      topMatches: match ? [match] : [],
      game: { number: phone || '', score: null, numAnswers: null, numCorrect: null, groupId: null, imported: true },
    };

    let g = gamesMap.get(gameId);
    if (!g) { g = { gameId, sentAt: String(row[c.sentAt] ?? '').trim() || null, results: [] }; gamesMap.set(gameId, g); }
    g.results.push(result);
  }

  // אגרגציה לכל משחק: ממוצעים + פיזור סוגי אישיות + משתתפים מינימליים
  const games = [];
  for (const g of gamesMap.values()) {
    const answered = g.results.filter((r) => r.answered > 0);
    const agg = Object.fromEntries(keys.map((k) => [k, 0]));
    const tally = {};
    for (const r of answered) {
      for (const k of keys) agg[k] += r.percentagesRaw[k] || 0;
      if (r.match) { const id = r.match.id ?? `n${r.match.number}`; (tally[id] ||= { name: r.match.name, count: 0 }).count++; }
    }
    const averages = Object.fromEntries(keys.map((k) => [k, answered.length ? round(agg[k] / answered.length, 1) : 0]));
    games.push({
      gameId: g.gameId,
      sentAt: g.sentAt,
      gameName: `📥 משחק מיובא ${g.gameId.slice(0, 8)}`,
      participants: g.results.map((r) => ({ id: r.id, name: r.name, answers: {}, game: r.game })),
      result: { count: g.results.length, results: g.results, averages, personalityTally: tally },
    });
  }

  return {
    games,
    stats: { games: games.length, participants: rows.length - 1, withPhone, codeOnly, noProfile, missingArchetype },
    warnings,
  };
}

/** פענוח קלט גולמי (base64 של csv, או csv/rows) לרשימת משחקים. */
export function parseResultsInput(body, opts = {}) {
  let rows;
  if (Array.isArray(body.rows)) rows = body.rows;
  else if (typeof body.csv === 'string') rows = parseCsv(body.csv.replace(/^﻿/, ''));
  else if (typeof body.dataBase64 === 'string') rows = parseCsv(Buffer.from(body.dataBase64, 'base64').toString('utf8').replace(/^﻿/, ''));
  else throw new Error('נדרש קובץ (dataBase64) או שדה rows/csv');
  return buildImportedGames(rows, opts);
}
