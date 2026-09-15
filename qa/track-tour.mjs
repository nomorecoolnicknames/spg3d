// Screenshot tour of a track at given lap fractions (uses the race warp knob).
//   node qa/track-tour.mjs <track> <quality> <outPrefix> 0.1,0.36,0.49 [settleMs]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [track = 'shchyolkovo', quality = 'medium', out = 'qa/out/tour/t', list = '0.1,0.5', settle = '2500', extra = ''] = process.argv.slice(2);
const port = 3770 + Math.floor(Math.random() * 100);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&auto=1&q=${quality}&maxdt=0.2&ts=1${extra}`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
await page.waitForFunction(() => window.__spg.snapshot()?.hud?.started, null, { timeout: 180000 }).catch(() => {});
for (const u of list.split(',').map(Number)) {
  await page.evaluate((x) => window.__spg.knobs.warp?.(x), u);
  await page.waitForTimeout(Number(settle));
  const s = await page.evaluate(() => window.__spg.snapshot());
  await page.screenshot({ path: `${out}-${u.toFixed(3)}.png`, timeout: 240000 });
  console.log(u, 'calls', s.drawCalls, 'tris', s.triangles, 'speed', s.hud?.speedKmh);
}
console.log('errors', logs.slice(0, 5));
await browser.close();
process.exit(0);
