// ============================================================================
//  שרת HTTP — Node טהור (ללא תלויות)
//  מגיש את פאנל הניהול והמבחן הציבורי + מנתב את ה-API.
// ============================================================================

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createRepo } from './src/repo/index.js';
import { createRouter } from './src/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || join(__dirname, 'data', 'db.json');

// שער הרשאה אופציונלי: אם מוגדר ADMIN_TOKEN, כל נתיב שאינו ציבורי דורש כותרת תואמת.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PUBLIC_API = new Set([
  'GET /api/health',
  'GET /api/config',
  'POST /api/score',
  'GET /api/games/webhook', // webhook המשחק — מוגן בטוקן משלו (GAME_TOKEN), לא ב-ADMIN_TOKEN
  'POST /api/games/webhook',
  'GET /api/get-intro-text', // ימות המשיח קוראת לזה עם ApiPhone — נתיב ציבורי
  'POST /api/get-intro-text',
  'GET /api/get-archetype/by-phone', // ימות (שלוחה 1) — מחזיר מספר סוג האישיות
  'POST /api/get-archetype/by-phone',
]);
const WEBHOOK_PATH = '/api/games/webhook';

// --- אתחול שכבת האחסון (Postgres אם הוגדר DATABASE_URL, אחרת קובץ JSON) ---
const { repo, kind: storageKind } = await createRepo({ dataFile: DATA_FILE });
const routes = createRouter(repo);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('גוף הבקשה גדול מדי'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      // ימות המשיח שולחת POST בפורמט form-urlencoded (ApiPhone=...&...)
      if (ct.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        // גיבוי: אם זה נראה כמו form-urlencoded (יש '=' ואין '{') — ננתח ככה
        if (raw.includes('=') && !raw.trimStart().startsWith('{') && !raw.trimStart().startsWith('[')) {
          return resolve(Object.fromEntries(new URLSearchParams(raw)));
        }
        reject(new Error('גוף בקשה לא תקין (נדרש JSON או form-urlencoded)'));
      }
    });
    req.on('error', reject);
  });
}

// התאמת נתיב בסגנון "/api/questions/:id" -> { params }
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const rParts = r.pattern.split('/').filter(Boolean);
    const pParts = pathname.split('/').filter(Boolean);
    if (rParts.length !== pParts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < rParts.length; i++) {
      if (rParts[i].startsWith(':')) {
        // decodeURIComponent זורק על קידוד אחוזים פגום (למשל '%') — לא לתת לזה לקרוס
        try { params[rParts[i].slice(1)] = decodeURIComponent(pParts[i]); }
        catch { params[rParts[i].slice(1)] = pParts[i]; }
      } else if (rParts[i] !== pParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: r.handler, params };
  }
  return null;
}

async function serveStatic(res, pathname) {
  // מיפוי נתיבים ידידותיים
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

  // מניעת path traversal
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) throw new Error('is dir');
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 — הדף לא נמצא</h1>');
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendJson(res, 400, { error: 'בקשה לא תקינה' });
  }
  let pathname = url.pathname;
  // נרמול לוכסן-סיום בודד בנתיבי API (למשל '/api/games/webhook/' -> '/api/games/webhook')
  if (pathname.length > 5 && pathname.endsWith('/') && pathname.startsWith('/api/')) {
    pathname = pathname.slice(0, -1);
  }

  // API
  if (pathname.startsWith('/api/')) {
    // CORS ל-webhook המשחק — הבקשה מגיעה מדפדפן המנחה (cross-origin).
    // חובה לענות ל-OPTIONS (preflight) אחרת ה-POST האמיתי לא יישלח.
    if (pathname === WEBHOOK_PATH) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }
    // שער הרשאה אופציונלי לנתיבי ניהול
    if (ADMIN_TOKEN && !PUBLIC_API.has(`${req.method} ${pathname}`)) {
      const token = req.headers['x-admin-token'] || url.searchParams.get('token') || '';
      if (token !== ADMIN_TOKEN) return sendJson(res, 401, { error: 'נדרשת הרשאת ניהול' });
    }
    const route = matchRoute(req.method, pathname);
    if (!route) return sendJson(res, 404, { error: `נתיב לא נמצא: ${req.method} ${pathname}` });

    const query = Object.fromEntries(url.searchParams.entries());
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      try {
        body = await parseBody(req);
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    try {
      const result = await route.handler({ req, res, params: route.params, query, body });
      // תמיכה בתשובת טקסט גולמי (למשל טקסט הקראה לימות המשיח)
      if (result && result.contentType) {
        res.writeHead(result.status || 200, { 'Content-Type': result.contentType });
        return res.end(result.body != null ? String(result.body) : '');
      }
      return sendJson(res, result.status || 200, result.body);
    } catch (e) {
      console.error('שגיאת שרת:', e);
      return sendJson(res, 500, { error: 'שגיאה פנימית בשרת', detail: String(e?.message || e) });
    }
  }

  // קבצים סטטיים
  if (req.method === 'GET') return serveStatic(res, pathname);

  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`\n  🌿 מערכת ארבעת היסודות פועלת`);
  console.log(`     מבחן:      http://localhost:${PORT}/`);
  console.log(`     ניהול:     http://localhost:${PORT}/admin`);
  console.log(`     אחסון:     ${storageKind === 'postgres' ? 'PostgreSQL' : `קובץ JSON (${DATA_FILE})`}`);
  if (ADMIN_TOKEN) console.log('     🔒 ה-API מוגן ב-ADMIN_TOKEN\n');
  else console.log('     ⚠  ADMIN_TOKEN לא הוגדר — ה-API פתוח (מתאים לפיתוח מקומי בלבד)\n');
});
