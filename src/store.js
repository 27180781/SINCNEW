// ============================================================================
//  שכבת אחסון — Store
//  אחסון פשוט מבוסס קובץ JSON יחיד, עם כתיבה אטומית (temp + rename).
//  מתוכנן מאחורי ממשק אחיד כך שניתן להחליף בעתיד ל-DB אמיתי.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { renameSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  /** טוען מהדיסק אם קיים; מחזיר null אם אין קובץ עדיין. */
  load() {
    if (this.data) return this.data;
    if (existsSync(this.file)) {
      this.data = JSON.parse(readFileSync(this.file, 'utf8'));
    }
    return this.data;
  }

  /** אתחול: אם אין נתונים על הדיסק — כותב את נתוני הזרעה. */
  init(seedData) {
    this.load();
    if (!this.data) {
      this.data = seedData;
      this.save();
    }
    return this.data;
  }

  get() {
    if (!this.data) this.load();
    return this.data;
  }

  /** כתיבה אטומית לדיסק. */
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.file);
    return this.data;
  }

  /** החלפת מאגר שלם (למשל אחרי איפוס / ייבוא). */
  replace(newData) {
    this.data = newData;
    return this.save();
  }
}
