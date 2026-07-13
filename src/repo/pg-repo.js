// ============================================================================
//  PgRepo — מימוש repository מעל PostgreSQL (פרודקשן)
//  סכימה יחסית + עמודות JSONB לחלקים המקוננים (options / profile / result).
//  מקבל pool תואם-pg בהזרקה, כדי שניתן יהיה לבדוק אותו גם עם pg-mem.
// ============================================================================

import { buildSeedData } from '../seed.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id   INT PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id      TEXT PRIMARY KEY,
  ord     INT,
  text    TEXT,
  options JSONB
);
CREATE TABLE IF NOT EXISTS personalities (
  seq         BIGSERIAL,
  id          TEXT PRIMARY KEY,
  name        TEXT,
  description TEXT,
  profile     JSONB,
  generated   BOOLEAN DEFAULT false
);
CREATE TABLE IF NOT EXISTS batches (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  participants JSONB,
  result       JSONB
);
`;

const J = (obj) => JSON.stringify(obj ?? null);

function rowToQuestion(r) {
  return { id: r.id, order: r.ord, text: r.text, options: r.options || [] };
}
function rowToPersonality(r) {
  return { id: r.id, name: r.name, description: r.description, profile: r.profile || {}, generated: !!r.generated };
}
function rowToBatch(r) {
  const createdAt = r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at;
  return { id: r.id, name: r.name, createdAt, participants: r.participants || [], result: r.result || null };
}

export class PgRepo {
  constructor(pool) {
    this.pool = pool;
    this.kind = 'postgres';
  }

  q(text, params) {
    return this.pool.query(text, params);
  }

  async init() {
    await this.q(SCHEMA);
    const { rows } = await this.q('SELECT COUNT(*)::int AS n FROM settings');
    if (rows[0].n === 0) {
      await this.replaceAll(buildSeedData());
    }
  }

  // ---- הגדרות ----
  async getSettings() {
    const { rows } = await this.q('SELECT data FROM settings WHERE id = 1');
    return rows[0]?.data || null;
  }
  async saveSettings(settings) {
    await this.q(
      `INSERT INTO settings (id, data) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [J(settings)]
    );
    return settings;
  }

  // ---- שאלות ----
  async listQuestions() {
    const { rows } = await this.q('SELECT id, ord, text, options FROM questions ORDER BY ord ASC, id ASC');
    return rows.map(rowToQuestion);
  }
  async getQuestion(id) {
    const { rows } = await this.q('SELECT id, ord, text, options FROM questions WHERE id = $1', [id]);
    return rows[0] ? rowToQuestion(rows[0]) : null;
  }
  async addQuestion(q) {
    await this.q('INSERT INTO questions (id, ord, text, options) VALUES ($1, $2, $3, $4::jsonb)', [
      q.id, q.order, q.text, J(q.options),
    ]);
    return q;
  }
  async updateQuestion(id, q) {
    const { rowCount } = await this.q(
      'UPDATE questions SET ord = $2, text = $3, options = $4::jsonb WHERE id = $1',
      [id, q.order, q.text, J(q.options)]
    );
    return rowCount ? q : null;
  }
  async deleteQuestion(id) {
    const { rowCount } = await this.q('DELETE FROM questions WHERE id = $1', [id]);
    return rowCount > 0;
  }
  async setQuestions(list) {
    const client = await this._begin();
    try {
      await client.query('DELETE FROM questions');
      for (const q of list) {
        await client.query('INSERT INTO questions (id, ord, text, options) VALUES ($1, $2, $3, $4::jsonb)', [
          q.id, q.order, q.text, J(q.options),
        ]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release?.();
    }
    return list;
  }

  // ---- סוגי אישיות ----
  async allPersonalities() {
    const { rows } = await this.q('SELECT id, name, description, profile, generated FROM personalities ORDER BY seq ASC');
    return rows.map(rowToPersonality);
  }
  async countPersonalities() {
    const { rows } = await this.q('SELECT COUNT(*)::int AS n FROM personalities');
    return rows[0].n;
  }
  async listPersonalities({ search = '', offset = 0, limit = 50 } = {}) {
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE name ILIKE $1 OR description ILIKE $1`;
    }
    const totalRes = await this.q(`SELECT COUNT(*)::int AS n FROM personalities ${where}`, params);
    const total = totalRes.rows[0].n;

    let sql = `SELECT id, name, description, profile, generated FROM personalities ${where} ORDER BY seq ASC`;
    const qParams = [...params];
    if (limit !== 'all') {
      qParams.push(limit, offset);
      sql += ` LIMIT $${qParams.length - 1} OFFSET $${qParams.length}`;
    } else if (offset) {
      qParams.push(offset);
      sql += ` OFFSET $${qParams.length}`;
    }
    const { rows } = await this.q(sql, qParams);
    return { total, offset, limit, items: rows.map(rowToPersonality) };
  }
  async getPersonality(id) {
    const { rows } = await this.q('SELECT id, name, description, profile, generated FROM personalities WHERE id = $1', [id]);
    return rows[0] ? rowToPersonality(rows[0]) : null;
  }
  async addPersonality(p) {
    await this.q(
      'INSERT INTO personalities (id, name, description, profile, generated) VALUES ($1, $2, $3, $4::jsonb, $5)',
      [p.id, p.name, p.description, J(p.profile), !!p.generated]
    );
    return p;
  }
  async updatePersonality(id, p) {
    const { rowCount } = await this.q(
      'UPDATE personalities SET name = $2, description = $3, profile = $4::jsonb, generated = $5 WHERE id = $1',
      [id, p.name, p.description, J(p.profile), !!p.generated]
    );
    return rowCount ? p : null;
  }
  async deletePersonality(id) {
    const { rowCount } = await this.q('DELETE FROM personalities WHERE id = $1', [id]);
    return rowCount > 0;
  }
  async appendPersonalities(list) {
    const client = await this._begin();
    try {
      await this._insertPersonalities(client, list);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release?.();
    }
    return this.countPersonalities();
  }
  async setPersonalities(list) {
    const client = await this._begin();
    try {
      await client.query('DELETE FROM personalities');
      await this._insertPersonalities(client, list);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release?.();
    }
    return list.length;
  }
  async clearPersonalities() {
    await this.q('DELETE FROM personalities');
  }

  // ---- מפגשים ----
  async listBatches() {
    const { rows } = await this.q(
      `SELECT id, name, created_at, COALESCE(jsonb_array_length(result->'results'), 0) AS count
       FROM batches ORDER BY created_at ASC`
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      count: Number(r.count) || 0,
    }));
  }
  async allBatches() {
    const { rows } = await this.q('SELECT id, name, created_at, participants, result FROM batches ORDER BY created_at ASC');
    return rows.map(rowToBatch);
  }
  async getBatch(id) {
    const { rows } = await this.q('SELECT id, name, created_at, participants, result FROM batches WHERE id = $1', [id]);
    return rows[0] ? rowToBatch(rows[0]) : null;
  }
  async addBatch(b) {
    await this.q(
      'INSERT INTO batches (id, name, created_at, participants, result) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)',
      [b.id, b.name, b.createdAt, J(b.participants), J(b.result)]
    );
    return b;
  }
  async deleteBatch(id) {
    const { rowCount } = await this.q('DELETE FROM batches WHERE id = $1', [id]);
    return rowCount > 0;
  }
  async clearBatches() {
    await this.q('DELETE FROM batches');
  }

  // ---- מאגר מלא ----
  async exportAll() {
    const [settings, questions, personalities, batches] = await Promise.all([
      this.getSettings(),
      this.listQuestions(),
      this.allPersonalities(),
      this.allBatches(),
    ]);
    return { version: 1, settings, questions, personalities, batches };
  }
  async replaceAll(data) {
    const client = await this._begin();
    try {
      await client.query('DELETE FROM batches');
      await client.query('DELETE FROM personalities');
      await client.query('DELETE FROM questions');
      await client.query('DELETE FROM settings');
      await client.query('INSERT INTO settings (id, data) VALUES (1, $1::jsonb)', [J(data.settings)]);
      for (const q of data.questions || []) {
        await client.query('INSERT INTO questions (id, ord, text, options) VALUES ($1, $2, $3, $4::jsonb)', [
          q.id, q.order, q.text, J(q.options),
        ]);
      }
      await this._insertPersonalities(client, data.personalities || []);
      for (const b of data.batches || []) {
        await client.query(
          'INSERT INTO batches (id, name, created_at, participants, result) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)',
          [b.id, b.name, b.createdAt || new Date().toISOString(), J(b.participants), J(b.result)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release?.();
    }
    return data;
  }

  // ---- עזרי טרנזקציה ----
  async _begin() {
    // pool.connect מחזיר client עם release; pg-mem חושף גם pool עם connect
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return client;
  }
  async _insertPersonalities(client, list) {
    // הכנסה מרובת-שורות בבלוקים, כדי לא לחרוג ממגבלת הפרמטרים
    const CHUNK = 400;
    for (let i = 0; i < list.length; i += CHUNK) {
      const slice = list.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((p, k) => {
        const b = k * 5;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb, $${b + 5})`);
        params.push(p.id, p.name, p.description, J(p.profile), !!p.generated);
      });
      if (values.length) {
        await client.query(
          `INSERT INTO personalities (id, name, description, profile, generated) VALUES ${values.join(', ')}`,
          params
        );
      }
    }
  }
}
