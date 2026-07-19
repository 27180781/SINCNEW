// ============================================================================
//  אינטגרציית "משחק פונקציה" — קבלת תוצאות ומיפוי למנוע השקלול
//  מקבל את מטען ה-JSON שמערכת המשחק שולחת (ראו מסמך האינטגרציה) וממיר אותו
//  לרשימת משתתפים בפורמט שלנו: answers ממופה מ-{queId -> answerId}.
// ============================================================================

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * אימות ונרמול בסיסי של מטען המשחק.
 * @returns {{ok: true, payload: object} | {ok: false, error: string}}
 */
export function validateGamePayload(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'מטען חייב להיות אובייקט JSON יחיד' };
  }
  if (!Array.isArray(raw.participants)) {
    return { ok: false, error: 'שדה participants חסר או אינו מערך' };
  }
  // מטא-דאטה של מפעיל המשחק — נשמר לטיפול בהמשך (מייל + תיקיית Cloudinary)
  const operator = raw.operator && typeof raw.operator === 'object' ? raw.operator : {};
  const email = String(raw.email ?? raw.operatorEmail ?? raw.userEmail ?? raw.mail ?? operator.email ?? '').trim();
  const cloudinaryFolder = String(raw.cloudinaryFolder ?? raw.cloudinary_folder ?? operator.cloudinaryFolder ?? '').trim();

  const payload = {
    gameId: raw.gameId != null ? String(raw.gameId) : '',
    gameName: raw.gameName != null ? String(raw.gameName) : '',
    sentAt: raw.sentAt != null ? String(raw.sentAt) : new Date().toISOString(),
    email,
    cloudinaryFolder,
    participantCount: Number.isFinite(Number(raw.participantCount)) ? Number(raw.participantCount) : raw.participants.length,
    participants: raw.participants.map((p) => ({
      number: p.number != null ? String(p.number) : '',
      name: p.name != null ? String(p.name) : '',
      score: num(p.score),
      numAnswers: num(p.numAnswers),
      numCorrect: num(p.numCorrect),
      groupId: p.groupId != null ? String(p.groupId) : null,
      answers: Array.isArray(p.answers)
        ? p.answers.map((a) => ({ queId: a.queId, answerId: a.answerId, correct: !!a.correct }))
        : [],
    })),
    questions: Array.isArray(raw.questions)
      ? raw.questions.map((q) => ({
          queId: q.queId,
          type: q.type != null ? String(q.type) : 'trivia',
          que: q.que != null ? String(q.que) : '',
          correctAnswerIds: Array.isArray(q.correctAnswerIds) ? q.correctAnswerIds : [],
        }))
      : [],
    groups: Array.isArray(raw.groups)
      ? raw.groups.map((g) => ({
          id: g.id != null ? String(g.id) : '',
          name: g.name != null ? String(g.name) : '',
          category: g.category != null ? String(g.category) : '',
          memberNumbers: Array.isArray(g.memberNumbers) ? g.memberNumbers.map(String) : [],
          totalScore: num(g.totalScore),
          avgScore: num(g.avgScore),
        }))
      : [],
  };
  return { ok: true, payload };
}

/**
 * ממיר משתתפי המשחק לפורמט השקלול שלנו.
 * מיפוי שאלה: לפי question.queId, ואם לא הוגדר — לפי מיקום (queId ה-N ← השאלה ה-N).
 * מיפוי תשובה: answerId מפוענח מול האפשרויות (option.answerId מפורש, או מיקום 1-מבוסס).
 * שם: אם name ריק — משתמשים ב-number כשם התצוגה (לפי המסמך).
 */
export function gamePayloadToParticipants(payload, questions) {
  const byQueId = new Map();
  for (const q of questions) if (q.queId != null) byQueId.set(String(q.queId), q);
  const ordered = questions.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const resolveQuestion = (queId) => byQueId.get(String(queId)) || ordered[Number(queId) - 1] || null;

  return (payload.participants || []).map((gp) => {
    const answers = {};
    for (const a of gp.answers || []) {
      const q = resolveQuestion(a.queId);
      if (q) answers[q.id] = a.answerId; // הערך (answerId) מפוענח בהמשך ע"י מנוע השקלול
    }
    const displayName = gp.name && String(gp.name).trim() ? String(gp.name) : String(gp.number);
    return {
      id: String(gp.number),
      name: displayName,
      answers,
      game: {
        number: String(gp.number),
        score: gp.score,
        numAnswers: gp.numAnswers,
        numCorrect: gp.numCorrect,
        groupId: gp.groupId ?? null,
      },
    };
  });
}
