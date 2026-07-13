// ============================================================================
//  factory לבחירת שכבת האחסון:
//  - אם הוגדר DATABASE_URL  -> PostgreSQL (פרודקשן)
//  - אחרת                    -> קובץ JSON (פיתוח מקומי / ברירת מחדל)
// ============================================================================

import { JsonRepo } from './json-repo.js';

export async function createRepo({ dataFile } = {}) {
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ PgRepo }, pgModule] = await Promise.all([import('./pg-repo.js'), import('pg')]);
    const Pg = pgModule.default || pgModule;
    const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;
    const pool = new Pg.Pool({
      connectionString: url,
      max: Number(process.env.PGPOOL_MAX) || 10,
      ssl,
    });
    pool.on('error', (e) => console.error('שגיאת Postgres pool:', e.message));
    const repo = new PgRepo(pool);
    await repo.init();
    return { repo, kind: 'postgres' };
  }

  const repo = new JsonRepo(dataFile);
  await repo.init();
  return { repo, kind: 'json' };
}
