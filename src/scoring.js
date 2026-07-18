// ============================================================================
//  מנוע השקלול וההתאמה — Scoring & Matching Engine
//  מודול טהור (ללא תלות ב-IO) כדי שיהיה קל לבדוק אותו ביחידות.
// ============================================================================

export const DEFAULT_ELEMENT_KEYS = ['fire', 'water', 'air', 'earth'];

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function round(n, digits = 0) {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** אובייקט ספירה מאופס עבור כל היסודות. */
export function emptyCounts(keys = DEFAULT_ELEMENT_KEYS) {
  const counts = {};
  for (const k of keys) counts[k] = 0;
  return counts;
}

// ---------------------------------------------------------------------------
//  פענוח תשובה בודדת -> אפשרות (option) בשאלה
//  התמיכה מכוונת להיות "סלחנית": מזהה מזהה-אפשרות, אות (A/B/C/D),
//  אינדקס מספרי (1-מבוסס או 0-מבוסס), או מפתח יסוד ישיר (fire/water/...).
// ---------------------------------------------------------------------------
function buildOptionResolver(question) {
  const options = question.options || [];
  const byId = new Map();
  const byLetter = new Map();
  const byIndex1 = new Map();
  const byIndex0 = new Map();
  const byElement = new Map();
  const byAnswerId = new Map();
  options.forEach((opt, i) => {
    if (opt.id != null) byId.set(String(opt.id), opt);
    if (opt.answerId != null) byAnswerId.set(String(opt.answerId), opt);
    byLetter.set(LETTERS[i] || `#${i}`, opt);
    byIndex1.set(String(i + 1), opt);
    byIndex0.set(String(i), opt);
    if (opt.element) byElement.set(String(opt.element), opt);
  });
  return { options, byId, byLetter, byIndex1, byIndex0, byElement, byAnswerId };
}

export function resolveAnswerToOption(question, answerValue) {
  if (answerValue == null) return null;
  const r = buildOptionResolver(question);
  const raw = String(answerValue).trim();
  if (raw === '') return null;

  // 1) מזהה אפשרות מדויק
  if (r.byId.has(raw)) return r.byId.get(raw);
  // 2) אות אפשרות (A/B/C/D) — לא רגיש לאותיות
  const upper = raw.toUpperCase();
  if (r.byLetter.has(upper)) return r.byLetter.get(upper);
  // 3) מפתח יסוד ישיר (fire/water/air/earth)
  if (r.byElement.has(raw)) return r.byElement.get(raw);
  if (r.byElement.has(raw.toLowerCase())) return r.byElement.get(raw.toLowerCase());
  // 4) מזהה תשובה מפורש של המשחק (option.answerId), ואז אינדקס מספרי
  //    (1-מבוסס ואז 0-מבוסס). נרמול אפסים מובילים ('01' -> '1').
  if (/^-?\d+$/.test(raw)) {
    const n = String(parseInt(raw, 10));
    if (r.byAnswerId.has(n)) return r.byAnswerId.get(n);
    if (r.byIndex1.has(n)) return r.byIndex1.get(n);
    if (r.byIndex0.has(n)) return r.byIndex0.get(n);
  }
  return null;
}

// ---------------------------------------------------------------------------
//  נרמול מבנה התשובות של משתתף למפה: questionId -> ערך-תשובה גולמי
//  נתמכים: מערך לפי סדר השאלות, או אובייקט { qid: val } / { "q1": val } / { "1": val }
// ---------------------------------------------------------------------------
export function normalizeAnswers(answers, questions) {
  const map = new Map();
  if (!answers) return map;

  if (Array.isArray(answers)) {
    answers.forEach((val, i) => {
      const q = questions[i];
      if (q) map.set(q.id, val);
    });
    return map;
  }

  if (typeof answers === 'object') {
    for (const [key, val] of Object.entries(answers)) {
      // התאמה ישירה למזהה שאלה
      let q = questions.find((qq) => String(qq.id) === String(key));
      if (!q) {
        // ניסיון לפרש "q3" / "3" כאינדקס לפי סדר
        const m = /^q?\s*(\d+)$/i.exec(String(key));
        if (m) {
          // מפתחות מספריים הם 1-מבוססים (q1..qN); '0' אינו תקין ומדולג
          const idx = parseInt(m[1], 10);
          q = idx >= 1 ? (questions[idx - 1] || null) : null;
        }
      }
      if (q) map.set(q.id, val);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
//  עיגול אחוזים כך שסכומם יהיה בדיוק 100 (שיטת השארית הגדולה ביותר)
// ---------------------------------------------------------------------------
export function roundTo100(rawPercents, keys = DEFAULT_ELEMENT_KEYS) {
  const total = keys.reduce((s, k) => s + (rawPercents[k] || 0), 0);
  const result = {};
  if (total <= 0) {
    for (const k of keys) result[k] = 0;
    return result;
  }
  let floorSum = 0;
  const remainders = [];
  for (const k of keys) {
    const v = rawPercents[k] || 0;
    const f = Math.floor(v);
    result[k] = f;
    floorSum += f;
    remainders.push({ k, r: v - f });
  }
  let toDistribute = Math.round(100 - floorSum);
  remainders.sort((a, b) => b.r - a.r);
  for (let i = 0; i < remainders.length && toDistribute > 0; i++, toDistribute--) {
    result[remainders[i].k] += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
//  שקלול משתתף בודד -> ספירות ואחוזים
// ---------------------------------------------------------------------------
export function scoreParticipant(participant, questions, options = {}) {
  const keys = options.elementKeys || DEFAULT_ELEMENT_KEYS;
  const counts = emptyCounts(keys);
  const answerMap = normalizeAnswers(participant.answers, questions);
  const perQuestion = [];
  let answered = 0;

  for (const q of questions) {
    const rawVal = answerMap.get(q.id);
    const opt = rawVal == null ? null : resolveAnswerToOption(q, rawVal);
    if (opt && opt.element && counts[opt.element] != null) {
      let w = opt.weight == null ? 1 : Number(opt.weight);
      if (!Number.isFinite(w)) w = 1;
      if (w < 0) w = 0; // משקל שלילי היה שובר את חישוב האחוזים (ערכים >100 או <0)
      counts[opt.element] += w;
      answered += 1;
      perQuestion.push({ questionId: q.id, answer: rawVal, element: opt.element, weight: w });
    } else {
      perQuestion.push({ questionId: q.id, answer: rawVal ?? null, element: null, weight: 0 });
    }
  }

  const total = keys.reduce((s, k) => s + counts[k], 0);
  const percentagesRaw = {};
  for (const k of keys) percentagesRaw[k] = total > 0 ? (counts[k] / total) * 100 : 0;
  const percentages = roundTo100(percentagesRaw, keys);

  // היסוד הדומיננטי
  let dominant = null;
  let best = -Infinity;
  for (const k of keys) {
    if (percentagesRaw[k] > best) {
      best = percentagesRaw[k];
      dominant = k;
    }
  }
  if (total === 0) dominant = null;

  return {
    id: participant.id != null ? String(participant.id) : null,
    name: participant.name != null ? String(participant.name) : null,
    counts,
    total,
    answered,
    questionCount: questions.length,
    percentages, // מספרים שלמים שסכומם 100 (לתצוגה)
    percentagesRaw, // ערכים גולמיים (להתאמה מדויקת)
    dominant,
    perQuestion,
  };
}

// ---------------------------------------------------------------------------
//  מרחק בין שני פרופילים + התאמה לסוג אישיות הקרוב ביותר
// ---------------------------------------------------------------------------
export function distance(a, b, keys = DEFAULT_ELEMENT_KEYS, metric = 'euclidean') {
  if (metric === 'manhattan') {
    let s = 0;
    for (const k of keys) s += Math.abs((a[k] || 0) - (b[k] || 0));
    return s;
  }
  // euclidean (ברירת מחדל)
  let s = 0;
  for (const k of keys) {
    const d = (a[k] || 0) - (b[k] || 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/** המרחק המרבי האפשרי בין שני פרופילים (בין שני "יסודות טהורים" מנוגדים). */
export function maxDistance(keys = DEFAULT_ELEMENT_KEYS, metric = 'euclidean') {
  if (metric === 'manhattan') return 200;
  return Math.sqrt(2) * 100; // ≈ 141.42
}

export function matchPersonality(profile, personalities, options = {}) {
  const keys = options.elementKeys || DEFAULT_ELEMENT_KEYS;
  const metric = options.metric || 'euclidean';
  const topN = options.topN || 3;
  if (!Array.isArray(personalities) || personalities.length === 0) {
    return { best: null, matches: [] };
  }
  const maxD = maxDistance(keys, metric) || 1;

  const scored = personalities.map((p) => {
    const d = distance(profile, p.profile || {}, keys, metric);
    const similarity = Math.max(0, Math.min(100, 100 - (d / maxD) * 100));
    return {
      id: p.id,
      name: p.name,
      number: p.number ?? null,
      description: p.description,
      profile: p.profile,
      distance: round(d, 2),
      similarity: round(similarity, 1),
    };
  });
  scored.sort((a, b) => a.distance - b.distance);
  return { best: scored[0], matches: scored.slice(0, topN) };
}

// ---------------------------------------------------------------------------
//  שקלול קבוצה שלמה של משתתפים + התאמת סוג אישיות לכל אחד
// ---------------------------------------------------------------------------
export function scoreBatch(participants, questions, personalities, options = {}) {
  const keys = options.elementKeys || DEFAULT_ELEMENT_KEYS;
  const list = Array.isArray(participants) ? participants : [];

  const results = list.map((p, i) => {
    const scored = scoreParticipant(p, questions, { elementKeys: keys });
    if (scored.id == null) scored.id = `p${i + 1}`;
    const match = matchPersonality(scored.percentagesRaw, personalities, options);
    return { ...scored, match: match.best, topMatches: match.matches };
  });

  // אגרגציה קבוצתית: ממוצע אחוזי היסודות + פיזור סוגי אישיות
  const aggregate = emptyCounts(keys);
  const personalityTally = {}; // לפי מזהה סוג האישיות (שמות עשויים לחזור בין סוגים)
  for (const r of results) {
    for (const k of keys) aggregate[k] += r.percentagesRaw[k] || 0;
    if (r.match) {
      const id = r.match.id;
      if (!personalityTally[id]) personalityTally[id] = { name: r.match.name, count: 0 };
      personalityTally[id].count += 1;
    }
  }
  const averages = {};
  for (const k of keys) averages[k] = results.length ? round(aggregate[k] / results.length, 1) : 0;

  return {
    count: results.length,
    results,
    averages,
    personalityTally,
  };
}
