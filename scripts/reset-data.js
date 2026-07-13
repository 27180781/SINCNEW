// איפוס מאגר הנתונים לערכי ברירת המחדל (זריעה מחדש)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { buildSeedData } from '../src/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || join(__dirname, '..', 'data', 'db.json');

const store = new Store(DATA_FILE);
store.replace(buildSeedData());
console.log(`✅ המאגר אופס וכתוב אל: ${DATA_FILE}`);
