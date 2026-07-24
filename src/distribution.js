// ============================================================================
//  ניתוח פיזור והצעות — מזהה סוגי אישיות "עמוסים" ומציע סוגים חדשים
//  שמפצלים אותם, כדי לפזר את המשתתפים רחב יותר על פני מרחב היסודות.
// ============================================================================

import { distance, roundTo100, matchPersonality, DEFAULT_ELEMENT_KEYS } from './scoring.js';
import { makePersonality } from './seed.js';

const round = (n, d = 0) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, Number(o?.[k]) || 0]));

function meanPoint(points, keys) {
  const m = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const p of points) for (const k of keys) m[k] += Number(p[k]) || 0;
  const n = points.length || 1;
  for (const k of keys) m[k] /= n;
  return m;
}

// האם הפרופיל קרוב מדי לאחד מהפרופילים הקיימים (מיותר)?
function isRedundant(profile, existingProfiles, keys, minGap) {
  for (const ex of existingProfiles) if (ex && distance(profile, ex, keys) < minGap) return true;
  return false;
}

/**
 * k-means דטרמיניסטי (אתחול farthest-first) — מפצל קבוצת פרופילים ל-k מרכזים.
 * @returns {{ centroids: object[], sizes: number[] }}
 */
export function kmeans(points, k, keys = DEFAULT_ELEMENT_KEYS, iters = 12) {
  if (!points.length) return { centroids: [], sizes: [] };
  if (points.length <= k) return { centroids: points.map((p) => pick(p, keys)), sizes: points.map(() => 1) };
  // אתחול farthest-first (דטרמיניסטי): מתחילים מהנקודה הראשונה, ואז הרחוקה ביותר בכל צעד
  const seeds = [pick(points[0], keys)];
  while (seeds.length < k) {
    let best = null, bestD = -1;
    for (const p of points) {
      let d = Infinity;
      for (const s of seeds) d = Math.min(d, distance(p, s, keys));
      if (d > bestD) { bestD = d; best = p; }
    }
    seeds.push(pick(best, keys));
  }
  let cents = seeds;
  let groups = cents.map(() => []);
  for (let it = 0; it < iters; it++) {
    groups = cents.map(() => []);
    for (const p of points) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < cents.length; i++) { const d = distance(p, cents[i], keys); if (d < bd) { bd = d; bi = i; } }
      groups[bi].push(p);
    }
    cents = groups.map((g, i) => (g.length ? meanPoint(g, keys) : cents[i]));
  }
  return { centroids: cents, sizes: groups.map((g) => g.length) };
}

/** משייך כל משתתף (עם מענה) לסוג האישיות הקרוב ביותר, וסופר. */
export function analyzeDistribution(participants, personalities, keys = DEFAULT_ELEMENT_KEYS) {
  const answered = (participants || []).filter((p) => (p.answered || 0) > 0);
  const byType = new Map();
  const dominantSplit = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const p of answered) {
    const prof = p.percentagesRaw || p.percentages || {};
    // דומיננטי לפי הפרופיל בפועל
    let dom = null, best = -1;
    for (const k of keys) if ((prof[k] || 0) > best) { best = prof[k] || 0; dom = k; }
    if (dom) dominantSplit[dom] += 1;

    const m = matchPersonality(prof, personalities, { elementKeys: keys });
    if (!m.best) continue;
    const id = m.best.id;
    if (!byType.has(id)) byType.set(id, { id, number: m.best.number, name: m.best.name, count: 0, sumDist: 0, members: [] });
    const t = byType.get(id);
    t.count += 1; t.sumDist += m.best.distance;
    // שומרים גם את מרחק ההתאמה הנוכחי — כדי לבדוק אילו הצעות באמת "יגנבו" את המשתתף
    t.members.push({ profile: prof, bestDist: m.best.distance });
  }
  const total = answered.length;
  const perType = [...byType.values()]
    .map((t) => ({ id: t.id, number: t.number, name: t.name, count: t.count, percent: total ? round((t.count / total) * 100, 1) : 0, avgDeviation: t.count ? round(t.sumDist / t.count, 1) : 0 }))
    .sort((a, b) => b.count - a.count);
  const top10 = perType.slice(0, 10).reduce((s, t) => s + t.count, 0);
  const healthTop10 = total ? round((top10 / total) * 100, 1) : 0;
  // מדד ריכוז Herfindahl -> "מספר סוגים אפקטיבי" (גבוה = מפוזר יותר; עמיד למספר הסוגים)
  let hhi = 0;
  for (const t of perType) { const s = total ? t.count / total : 0; hhi += s * s; }
  const effectiveTypes = total && hhi ? round(1 / hhi, 1) : 0;
  return { total, distinctUsed: perType.length, availableTypes: personalities.length, healthTop10, effectiveTypes, dominantSplit, perType, byType };
}

/**
 * דוח מלא: ניתוח + הצעות לסוגים חדשים + מדד בריאות לפני/אחרי.
 * ההצעות מפצלות את הסוגים העמוסים (k-means על המשתתפים ששויכו אליהם).
 */
export function distributionReport(participants, personalities, keys = DEFAULT_ELEMENT_KEYS, opts = {}) {
  const minGap = opts.minGap ?? 8;      // מרחק מינימלי מסוג קיים כדי לא להיות מיותר
  const minCluster = opts.minCluster ?? 12; // גודל אשכול מינימלי כדי להצדיק סוג חדש
  const maxTypes = opts.maxTypes ?? 12; // כמה סוגים עמוסים לפצל
  const maxSuggestions = opts.maxSuggestions ?? 24;

  const a = analyzeDistribution(participants, personalities, keys);
  // סוג "עמוס" = קולט לפחות אחוז מסוים מכלל המשתתפים (ברירת מחדל 3%), עם רצפה מוחלטת.
  const threshold = Math.max(opts.minOverload ?? 25, a.total * (opts.overloadPercent ?? 0.03));

  const overloaded = a.perType.filter((t) => t.count >= threshold).slice(0, maxTypes);
  const suggestions = [];
  for (const t of overloaded) {
    if (suggestions.length >= maxSuggestions) break;
    const members = a.byType.get(t.id).members; // [{ profile, bestDist }]
    const k = members.length >= 60 ? 3 : 2;
    const { centroids } = kmeans(members.map((m) => m.profile), k, keys);
    for (const c of centroids) {
      const profile = roundTo100(c, keys);
      // לא לשכפל הצעה אחרת
      if (isRedundant(profile, suggestions.map((s) => s.profile), keys, minGap)) continue;
      // מבחן "גניבה": כמה מהמשתתפים של הסוג העמוס יעדיפו את הפרופיל החדש על ההתאמה הנוכחית שלהם.
      // (אם קיים כבר סוג קרוב יותר — bestDist קטן והמשתתף לא ייגנב, כך שהצעה מיותרת מסוננת מעצמה.)
      let captured = 0;
      for (const mm of members) if (distance(mm.profile, profile, keys) < mm.bestDist - 0.001) captured += 1;
      if (captured < minCluster) continue;
      const named = makePersonality(profile); // שם + תיאור אוטומטיים לפי הפרופיל
      suggestions.push({ profile, name: named.name, description: named.description, memberCount: captured, splitsType: t.name, splitsNumber: t.number ?? null });
    }
  }

  // מדד בריאות משוער אחרי הוספת כל ההצעות
  const augmented = personalities.concat(suggestions.map((s, i) => ({ id: `__sug${i}`, number: null, name: s.name, profile: s.profile })));
  const after = suggestions.length ? analyzeDistribution(participants, augmented, keys) : a;

  const flag = new Set(overloaded.map((t) => t.id));
  return {
    total: a.total,
    distinctUsed: a.distinctUsed,
    availableTypes: a.availableTypes,
    dominantSplit: a.dominantSplit,
    threshold: round(threshold, 0),
    top10Before: a.healthTop10,       // % מהמשתתפים ב-10 הסוגים הגדולים (נמוך = מפוזר יותר)
    top10After: after.healthTop10,
    effectiveBefore: a.effectiveTypes, // מספר סוגים אפקטיבי (גבוה = מפוזר יותר)
    effectiveAfter: after.effectiveTypes,
    overloadedCount: overloaded.length,
    perType: a.perType.slice(0, 25).map((t) => ({ number: t.number, name: t.name, count: t.count, percent: t.percent, avgDeviation: t.avgDeviation, overloaded: flag.has(t.id) })),
    suggestions,
  };
}
