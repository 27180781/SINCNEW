// ============================================================================
//  JsonRepo — מימוש repository מעל אחסון קובץ JSON (פיתוח מקומי / ברירת מחדל)
//  מיישם בדיוק את אותו ממשק כמו PgRepo, כדי שהאפליקציה תעבוד זהה בשני המצבים.
// ============================================================================

import { Store } from '../store.js';
import { buildSeedData } from '../seed.js';

export class JsonRepo {
  constructor(file) {
    this.store = new Store(file);
    this.kind = 'json';
  }

  async init() {
    this.store.init(buildSeedData());
  }

  _s() {
    return this.store.get();
  }
  _save() {
    this.store.save();
  }

  // ---- הגדרות ----
  async getSettings() {
    return this._s().settings;
  }
  async saveSettings(settings) {
    this._s().settings = settings;
    this._save();
    return settings;
  }

  // ---- שאלות ----
  async listQuestions() {
    return this._s().questions.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  async getQuestion(id) {
    return this._s().questions.find((q) => q.id === id) || null;
  }
  async addQuestion(q) {
    this._s().questions.push(q);
    this._save();
    return q;
  }
  async updateQuestion(id, q) {
    const s = this._s();
    const i = s.questions.findIndex((x) => x.id === id);
    if (i < 0) return null;
    s.questions[i] = q;
    this._save();
    return q;
  }
  async deleteQuestion(id) {
    const s = this._s();
    const before = s.questions.length;
    s.questions = s.questions.filter((x) => x.id !== id);
    if (s.questions.length === before) return false;
    this._save();
    return true;
  }
  async setQuestions(list) {
    this._s().questions = list;
    this._save();
    return list;
  }

  // ---- סוגי אישיות ----
  async allPersonalities() {
    return this._s().personalities;
  }
  async countPersonalities() {
    return this._s().personalities.length;
  }
  async listPersonalities({ search = '', offset = 0, limit = 50 } = {}) {
    let list = this._s().personalities;
    if (search) list = list.filter((p) => (p.name || '').includes(search) || (p.description || '').includes(search));
    const total = list.length;
    const items = limit === 'all' ? list.slice(offset) : list.slice(offset, offset + limit);
    return { total, offset, limit, items };
  }
  async getPersonality(id) {
    return this._s().personalities.find((p) => p.id === id) || null;
  }
  async addPersonality(p) {
    this._s().personalities.push(p);
    this._save();
    return p;
  }
  async updatePersonality(id, p) {
    const s = this._s();
    const i = s.personalities.findIndex((x) => x.id === id);
    if (i < 0) return null;
    s.personalities[i] = p;
    this._save();
    return p;
  }
  async deletePersonality(id) {
    const s = this._s();
    const before = s.personalities.length;
    s.personalities = s.personalities.filter((x) => x.id !== id);
    if (s.personalities.length === before) return false;
    this._save();
    return true;
  }
  async appendPersonalities(list) {
    this._s().personalities.push(...list);
    this._save();
    return this._s().personalities.length;
  }
  async setPersonalities(list) {
    this._s().personalities = list;
    this._save();
    return list.length;
  }
  async clearPersonalities() {
    this._s().personalities = [];
    this._save();
  }

  // ---- מפגשים ----
  async listBatches() {
    return this._s().batches.map((b) => ({
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      source: b.source || null,
      count: b.result?.count || 0,
    }));
  }
  async allBatches() {
    return this._s().batches;
  }
  async getBatch(id) {
    return this._s().batches.find((b) => b.id === id) || null;
  }
  async findGameBatch(gameId, sentAt) {
    return this._s().batches.find((b) => b.gameId === gameId && b.sentAt === sentAt) || null;
  }
  async addBatch(b) {
    this._s().batches.push(b);
    this._save();
    return b;
  }
  async deleteBatch(id) {
    const s = this._s();
    const before = s.batches.length;
    s.batches = s.batches.filter((b) => b.id !== id);
    if (s.batches.length === before) return false;
    this._save();
    return true;
  }
  async clearBatches() {
    this._s().batches = [];
    this._save();
  }

  // ---- מאגר מלא ----
  async exportAll() {
    return this._s();
  }
  async replaceAll(data) {
    this.store.replace(data);
    return data;
  }
}
