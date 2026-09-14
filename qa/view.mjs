// Fixed-camera shots of a track's world (landmarks, streets):
//   node qa/view.mjs <track> <outPrefix> "x,y,z>tx,ty,tz" ["x,y,z>tx,ty,tz" …] [--q medium] [--settle 2500]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args.splice(args.indexOf(k), 2)[1] : d);
const quality = opt('--q', 'medium');
const settle = Number(opt('--settle', '2500'));
const [track, out, ...views] = args;
const port = 3870 + Math.floor(Math.random() * 100);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&auto=1&q=${quality}&maxdt=0.2&ts=1&hud=0`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready && window.__spg.knobs.viewFrom, null, { timeout: 420000 });
for (const [k, v] of views.entries()) {
  const [a, b] = v.split('>').map((s) => s.split(',').map(Number));
  await page.evaluate(([a, b]) => window.__spg.knobs.viewFrom(...a, ...b), [a, b]);
  await page.waitForTimeout(settle);
  const s = await page.evaluate(() => window.__spg.snapshot());
  const file = `${out}-${k}.png`;
  await page.screenshot({ path: file, timeout: 240000 });
  console.log(file, v, 'calls', s.drawCalls, 'tris', s.triangles);
}
console.log('errors', logs.slice(0, 5));
await browser.close();
process.exit(0);
