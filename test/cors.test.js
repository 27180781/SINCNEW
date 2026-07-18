// בדיקת רגרסיה ל-CORS של ה-webhook — מריצה שרת אמיתי ובודקת את הכותרות
// בכל התרחישים הקריטיים (preflight, הצלחה, שגיאה, לוכסן-סיום).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3197;
const BASE = `http://127.0.0.1:${PORT}`;
const WH = `${BASE}/api/games/webhook`;

async function waitForHealth(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('השרת לא עלה בזמן');
}

test('CORS: כל תשובות ה-webhook נושאות כותרות Access-Control', async (t) => {
  const dataFile = join(tmpdir(), `cors-test-${process.pid}-${Date.now()}.json`);
  const proc = spawn('node', [join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_FILE: dataFile, ADMIN_TOKEN: '', GAME_TOKEN: '' },
    stdio: 'ignore',
  });
  t.after(() => proc.kill());
  await waitForHealth();

  // 1) OPTIONS preflight
  const opt = await fetch(WH, {
    method: 'OPTIONS',
    headers: { Origin: 'https://game.example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(opt.status, 204, 'preflight => 204');
  assert.equal(opt.headers.get('access-control-allow-origin'), '*');
  assert.match(opt.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(opt.headers.get('access-control-allow-headers') || '', /content-type/i);

  // 2) POST תקין
  const okRes = await fetch(WH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'c1', participants: [] }),
  });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.headers.get('access-control-allow-origin'), '*');

  // 3) POST עם מבנה שגוי => 400, אבל עדיין עם CORS (קריטי!)
  const badRes = await fetch(WH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ foo: 1 }),
  });
  assert.equal(badRes.status, 400);
  assert.equal(badRes.headers.get('access-control-allow-origin'), '*', 'תשובת שגיאה חייבת CORS');

  // 4) לוכסן-סיום נסבל
  const slash = await fetch(`${WH}/`, {
    method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(slash.status, 204);
  assert.equal(slash.headers.get('access-control-allow-origin'), '*');
});
