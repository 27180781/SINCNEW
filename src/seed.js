// ============================================================================
//  נתוני זרעה (Seed) — יסודות, הגדרות, שאלות לדוגמה, ומאגר סוגי האישיות
// ============================================================================

import { randomUUID } from 'node:crypto';

export const ELEMENT_KEYS = ['fire', 'water', 'air', 'earth'];

export const ELEMENTS = [
  { key: 'fire', label: 'אש', color: '#E4572E', emoji: '🔥', trait: 'תשוקה, אנרגיה, יוזמה ומנהיגות' },
  { key: 'water', label: 'מים', color: '#2A7DE1', emoji: '💧', trait: 'רגש, אינטואיציה, חמלה וזרימה' },
  { key: 'air', label: 'רוח', color: '#7C6BD6', emoji: '🌬️', trait: 'מחשבה, תקשורת, רעיונות וחופש' },
  { key: 'earth', label: 'עפר', color: '#6A8E3F', emoji: '🌱', trait: 'יציבות, מעשיות, סבלנות ושורשיות' },
];

export function defaultSettings() {
  return {
    title: 'אפיון אישיות לפי ארבעת יסודות הבריאה',
    subtitle: 'אש · מים · רוח · עפר',
    elements: ELEMENTS.map((e) => ({ ...e })),
    matching: { metric: 'euclidean', topN: 3 },
  };
}

// ---------------------------------------------------------------------------
//  שאלות לדוגמה — כל שאלה 4 אפשרויות, כל אפשרות ממופה ליסוד.
//  שימו לב: סדר היסודות משתנה בין השאלות (מה שממחיש את "השיוך לכל שאלה").
// ---------------------------------------------------------------------------
const SAMPLE_QUESTIONS = [
  {
    text: 'כשמזדמן אליך אתגר חדש לגמרי — מה הדבר הראשון שאתה עושה?',
    options: [
      ['צולל פנימה ופועל מיד, נלהב מהריגוש', 'fire'],
      ['מקשיב לתחושת הבטן ובודק מה מרגיש נכון', 'water'],
      ['מנתח את כל האפשרויות ומדמיין תרחישים', 'air'],
      ['בונה תוכנית מסודרת, צעד אחר צעד', 'earth'],
    ],
  },
  {
    text: 'איזה נוף הכי "מדבר אליך"?',
    options: [
      ['אוקיינוס אינסופי בשקיעה', 'water'],
      ['פסגת הר גבוהה עם רוח פרצים', 'air'],
      ['מדבר לוהט תחת שמש קופחת', 'fire'],
      ['יער עתיק ושורשי', 'earth'],
    ],
  },
  {
    text: 'בעבודת צוות, התפקיד הטבעי שלך הוא:',
    options: [
      ['המבצע שדואג שהכול יקרה בפועל', 'earth'],
      ['המצית שמדליק את כולם ודוחף קדימה', 'fire'],
      ['האוזן הקשבת שמרגישה את מצב הרוח', 'water'],
      ['המוח שמייצר רעיונות ומחבר נקודות', 'air'],
    ],
  },
  {
    text: 'מה מטעין אותך באנרגיה אחרי יום קשה?',
    options: [
      ['שיחה עמוקה עם אדם קרוב', 'water'],
      ['ספר, פודקאסט או רעיון חדש ללמוד', 'air'],
      ['ספורט, ריקוד או כל דבר שמזיז את הגוף', 'fire'],
      ['סדר ושגרה — לארגן, לנקות, להכין', 'earth'],
    ],
  },
  {
    text: 'איך אתה מקבל החלטות חשובות?',
    options: [
      ['לפי היגיון וניתוח קר של יתרונות וחסרונות', 'air'],
      ['לפי מה שיציב ובטוח לטווח הארוך', 'earth'],
      ['לפי אינטואיציה ותחושה פנימית', 'water'],
      ['מהר, לפי דחף ותשוקה', 'fire'],
    ],
  },
  {
    text: 'חבר בצרה מתקשר אליך. מה תגובתך הראשונה?',
    options: [
      ['"בוא נפעל — מה עושים עכשיו?"', 'fire'],
      ['"אני כאן, ספר לי מה אתה מרגיש"', 'water'],
      ['"בוא ננתח את המצב ונבין את האפשרויות"', 'air'],
      ['"בוא נבנה תוכנית מעשית לצאת מזה"', 'earth'],
    ],
  },
  {
    text: 'מה הכי מתסכל אותך?',
    options: [
      ['חוסר סדר ואי-ודאות', 'earth'],
      ['איטיות והיסוס כשצריך לפעול', 'fire'],
      ['שטחיות וחוסר עומק רגשי', 'water'],
      ['שגרה משעממת בלי אתגר אינטלקטואלי', 'air'],
    ],
  },
  {
    text: 'איזו מתנה הכי תשמח לקבל?',
    options: [
      ['חוויה מרגשת וספונטנית', 'fire'],
      ['משהו אישי עם משמעות רגשית', 'water'],
      ['ספר או קורס שירחיב את האופקים', 'air'],
      ['משהו שימושי ואיכותי שיחזיק שנים', 'earth'],
    ],
  },
  {
    text: 'איך נראה יום חופש מושלם?',
    options: [
      ['לצוף בבית ליד המים, בלי לוח זמנים', 'water'],
      ['טיול הרפתקני עם הרבה תזוזה ואקשן', 'fire'],
      ['מוזיאון, הרצאה או סיור בעיר חדשה', 'air'],
      ['גינון, בישול או פרויקט בבית', 'earth'],
    ],
  },
  {
    text: 'מה החברים היו אומרים שהכי מאפיין אותך?',
    options: [
      ['אמין ויציב — תמיד אפשר לסמוך עליי', 'earth'],
      ['נלהב ומדבק — מזיז דברים', 'fire'],
      ['רגיש ומבין — מרגיש את האחר', 'water'],
      ['סקרן וחכם — תמיד עם רעיון', 'air'],
    ],
  },
  {
    text: 'כשאתה חולם על העתיד, אתה מדמיין:',
    options: [
      ['הישגים גדולים והשפעה על העולם', 'fire'],
      ['קשרים עמוקים ומשמעות רגשית', 'water'],
      ['חופש, ידע וחוויות מגוונות', 'air'],
      ['בית יציב, ביטחון ושלווה', 'earth'],
    ],
  },
  {
    text: 'איזה משפט הכי מייצג אותך?',
    options: [
      ['"אם לא עכשיו, אימתי?"', 'fire'],
      ['"הלב יודע את האמת"', 'water'],
      ['"ידע הוא כוח"', 'air'],
      ['"לאט לאט מגיעים רחוק"', 'earth'],
    ],
  },
];

export function buildSampleQuestions() {
  return SAMPLE_QUESTIONS.map((q, qi) => ({
    id: `q${qi + 1}`,
    order: qi + 1,
    text: q.text,
    options: q.options.map((o, oi) => ({
      id: `q${qi + 1}o${oi + 1}`,
      text: o[0],
      element: o[1],
      weight: 1,
    })),
  }));
}

// ---------------------------------------------------------------------------
//  מחולל מאגר סוגי האישיות
//  מונה את כל הרכבי-האחוזים האפשריים (בצעדים קבועים) שסכומם 100.
//  צעד 10 -> 286 סוגים ("מאות"), כל אחד עם צירוף אחוזים שונה.
// ---------------------------------------------------------------------------

const ARCHETYPE_NOUNS = {
  fire: ['הלוחם', 'היוזם', 'המצית', 'הניצוץ', 'המנהיג'],
  water: ['החולם', 'המרפא', 'הזורם', 'המעיין', 'הרגיש'],
  air: ['ההוגה', 'החוקר', 'הנווד', 'המשב', 'החופשי'],
  earth: ['הבונה', 'העוגן', 'השורש', 'הסלע', 'המעשי'],
};

const SECONDARY_ADJ = {
  fire: 'הנלהב',
  water: 'הרגיש',
  air: 'החושב',
  earth: 'היציב',
};

const BALANCED_NAMES = ['הנפש המאוזנת', 'הרביעייה השלמה', 'המרכז', 'האחדות', 'ארבעת הכיוונים'];

const ELEMENT_LABEL = { fire: 'אש', water: 'מים', air: 'רוח', earth: 'עפר' };
const ELEMENT_TRAIT = {
  fire: 'מונע מתשוקה, יוזמה ואנרגיה',
  water: 'מונע מרגש, אינטואיציה וחמלה',
  air: 'מונע ממחשבה, סקרנות ורעיונות',
  earth: 'מונע מיציבות, סבלנות ומעשיות',
};

function makePersonality(profile) {
  const { fire, water, air, earth } = profile;
  const sorted = [...ELEMENT_KEYS].sort((a, b) => profile[b] - profile[a]);
  const top = sorted[0];
  const second = sorted[1];
  const spread = profile[sorted[0]] - profile[sorted[3]];

  let name;
  if (spread <= 10) {
    // מאוזן בין כל היסודות
    const idx = (fire + water + air + earth + profile[top]) % BALANCED_NAMES.length;
    name = BALANCED_NAMES[idx];
  } else {
    const nounList = ARCHETYPE_NOUNS[top];
    const noun = nounList[(profile[top] / 10) % nounList.length];
    if (profile[top] - profile[second] >= 40 || profile[second] === 0) {
      name = `${noun} הטהור`;
    } else {
      name = `${noun} ${SECONDARY_ADJ[second]}`;
    }
  }

  const description =
    `שילוב של ${fire}% אש · ${water}% מים · ${air}% רוח · ${earth}% עפר. ` +
    `${ELEMENT_TRAIT[top]}, עם נגיעה של ${ELEMENT_LABEL[second]}.`;

  return {
    id: `type-${fire}-${water}-${air}-${earth}`,
    name,
    description,
    profile: { fire, water, air, earth },
    generated: true,
  };
}

export function generatePersonalities(step = 10) {
  const list = [];
  for (let f = 0; f <= 100; f += step) {
    for (let w = 0; w <= 100 - f; w += step) {
      for (let a = 0; a <= 100 - f - w; a += step) {
        const e = 100 - f - w - a;
        if (e < 0) continue;
        list.push(makePersonality({ fire: f, water: w, air: a, earth: e }));
      }
    }
  }
  return list;
}

// ---------------------------------------------------------------------------
//  מבנה בסיס הנתונים ההתחלתי
// ---------------------------------------------------------------------------
export function buildSeedData() {
  return {
    version: 1,
    settings: defaultSettings(),
    questions: buildSampleQuestions(),
    personalities: generatePersonalities(10),
    batches: [],
  };
}

export function newId(prefix = 'id') {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
