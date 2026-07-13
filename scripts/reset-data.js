// איפוס מאגר הנתונים לערכי ברירת המחדל (זריעה מחדש)
// פועל מול שכבת האחסון הפעילה (Postgres אם הוגדר DATABASE_URL, אחרת קובץ JSON)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepo } from '../src/repo/index.js';
import { buildSeedData } from '../src/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || join(__dirname, '..', 'data', 'db.json');

const { repo, kind } = await createRepo({ dataFile: DATA_FILE });
await repo.replaceAll(buildSeedData());
console.log(`✅ המאגר אופס (${kind === 'postgres' ? 'PostgreSQL' : DATA_FILE})`);
process.exit(0);
