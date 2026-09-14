// Quick single-scenario screenshot helper for iteration:
//   node qa/shot.mjs "?screen=race&track=shchyolkovo&auto=1" out.png 2000,8000,20000 [w h]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [query = '', outBase = 'qa/out/shot', delaysArg = '3000', w = '1600', h = '900'] = process.argv.slice(2);
const delays = delaysArg.split(',').map(Number);
const port = 3170 + Math.floor(Math.random() * 100);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
const T0 = Date.now();
const log = (...a) => console.log(`[+${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
// wait until the static server answers (the box can be heavily loaded)
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://localhost:${port}/`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
log('goto'); await page.goto(`http://localhost:${port}/${query}`, { timeout: 120000 }); log('loaded');
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 }).catch(() => logs.push('ready timeout')); log('ready');
mkdirSync(path.dirname(outBase), { recursive: true });
let last = 0;
for (const d of delays) {
  await page.waitForTimeout(d - last);
  last = d;
  const snap = await page.evaluate(() => JSON.stringify(window.__spg.snapshot(), (k, v) => (k === 'leaderboard' || k === 'minimap' ? undefined : v)));
  await page.screenshot({ path: `${outBase}-${d}.png`, timeout: 180000 });
  log(`[${d}ms]`, snap.slice(0, 700));
}
const errs = await page.evaluate(() => window.__spg.errors);
console.log('errors:', errs.slice(0, 10), 'console:', logs.slice(0, 10));
await browser.close();
server.kill();
