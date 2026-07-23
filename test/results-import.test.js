// בדיקות ייבוא תוצאות קיימות (CSV) ממערכת אחרת
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importPhone, detectResultColumns, buildImportedGames, parseResultsInput } from '../src/results-import.js';

const KEYS = ['fire', 'water', 'air', 'earth'];
const HEADER = ['game_id', 'processed_at', 'participant_id_phone', 'name', 'access_code', 'profile_fire', 'profile_water', 'profile_air', 'profile_earth', 'archetype_id', 'archetype_score'];
const PERSONALITIES = [
  { id: 't46', number: 46, name: 'העוגן', description: 'תיאור 46' },
  { id: 't88', number: 88, name: 'הבונה', description: 'תיאור 88' },
];

test('importPhone: מוסיף 0 מוביל למספר בן 9 ספרות; שם -> null', () => {
  assert.equal(importPhone('504179664'), '0504179664');
  assert.equal(importPhone('0504179664'), '0504179664');
  assert.equal(importPhone('אהרון'), null);
  assert.equal(importPhone(''), null);
  assert.equal(importPhone('12345'), null); // קצר מדי
});

test('detectResultColumns: מזהה את כל העמודות לפי הכותרת', () => {
  const c = detectResultColumns(HEADER, KEYS);
  assert.equal(c.gameId, 0);
  assert.equal(c.phone, 2);
  assert.equal(c.name, 3);
  assert.equal(c.code, 4);
  assert.deepEqual(c.elements, { fire: 5, water: 6, air: 7, earth: 8 });
  assert.equal(c.archetypeId, 9);
  assert.equal(c.score, 10);
});

test('buildImportedGames: שורה עם טלפון -> תוצאה עם match, אחוזים, דומיננטי', () => {
  const rows = [HEADER, ['G1', '2026-07-21T10:30:40Z', '504179664', 'ברוך לוי', 'U3JBM1', '20.45', '31.81', '18.18', '29.54', '46', '4.54']];
  const { games, stats } = buildImportedGames(rows, { keys: KEYS, personalities: PERSONALITIES });
  assert.equal(games.length, 1);
  const g = games[0];
  assert.equal(g.gameId, 'G1');
  const r = g.result.results[0];
  assert.equal(r.game.number, '0504179664');
  assert.equal(r.personalCode, null, 'יש טלפון => אין קוד');
  assert.equal(r.name, 'ברוך לוי');
  assert.equal(r.dominant, 'water'); // 31.81 הכי גבוה
  assert.equal(r.answered, 1);
  assert.equal(r.match.number, 46);
  assert.equal(r.match.name, 'העוגן'); // מהמאגר לפי המספר
  assert.equal(r.match.description, 'תיאור 46');
  assert.equal(r.match.deviation, 4.54);
  assert.ok(Math.abs(r.match.similarity - 95.46) < 0.1);
  assert.equal(stats.withPhone, 1);
});

test('buildImportedGames: שורה ללא טלפון (שם בעמודת הטלפון) -> קוד אישי', () => {
  const rows = [HEADER, ['G1', 'T', 'אהרון', 'אהרון', 'DQQMWO', '10', '10', '70', '10', '87', '2.9']];
  const r = buildImportedGames(rows, { keys: KEYS, personalities: PERSONALITIES }).games[0].result.results[0];
  assert.equal(r.game.number, '');
  assert.equal(r.personalCode, 'DQQMWO');
  assert.equal(r.dominant, 'air');
});

test('buildImportedGames: פרופיל אפס -> answered=0, dominant=null', () => {
  const rows = [HEADER, ['G1', 'T', '504156692', 'x', 'VB856J', '0', '0', '0', '0', '1', '100']];
  const r = buildImportedGames(rows, { keys: KEYS, personalities: PERSONALITIES }).games[0].result.results[0];
  assert.equal(r.answered, 0);
  assert.equal(r.dominant, null);
});

test('buildImportedGames: קיבוץ לפי game_id + ממוצעים', () => {
  const rows = [
    HEADER,
    ['G1', 'T', '504179664', 'a', 'C1', '100', '0', '0', '0', '46', '0'],
    ['G1', 'T', '527109256', 'b', 'C2', '0', '100', '0', '0', '88', '0'],
    ['G2', 'T', '534121189', 'c', 'C3', '0', '0', '100', '0', '46', '0'],
  ];
  const { games } = buildImportedGames(rows, { keys: KEYS, personalities: PERSONALITIES });
  assert.equal(games.length, 2);
  const g1 = games.find((g) => g.gameId === 'G1');
  assert.equal(g1.result.count, 2);
  assert.equal(g1.result.averages.fire, 50);
  assert.equal(g1.result.averages.water, 50);
});

test('buildImportedGames: archetype שלא קיים -> match עם שם גיבוי + אזהרה בספירה', () => {
  const rows = [HEADER, ['G1', 'T', '504179664', 'a', 'C1', '50', '50', '0', '0', '999', '5']];
  const { games, stats } = buildImportedGames(rows, { keys: KEYS, personalities: PERSONALITIES });
  const r = games[0].result.results[0];
  assert.equal(r.match.number, 999);
  assert.equal(r.match.name, 'סוג 999');
  assert.equal(stats.missingArchetype, 1);
});

test('parseResultsInput: CSV עם BOM ומרכאות מוברחות', () => {
  const csv = '﻿' + HEADER.join(',') + '\n' + 'G1,T,527177877,"ראש הכולל שליט""א",17577Z,19,21,40,19,82,19\n';
  const { games } = parseResultsInput({ csv }, { keys: KEYS, personalities: PERSONALITIES });
  const r = games[0].result.results[0];
  assert.equal(r.name, 'ראש הכולל שליט"א');
  assert.equal(r.dominant, 'air');
});
