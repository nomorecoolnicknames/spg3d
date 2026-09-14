// F toggles free flight in a race: hold W + Space, the car must leave the track upwards.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 4070 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://localhost:${port}/?screen=race&track=shchyolkovo&q=low&maxdt=0.2`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__spg.knobs.skipCountdown?.());
await page.waitForTimeout(2500);
const before = await page.evaluate(() => window.__spg.snapshot().playerPos);
await page.keyboard.press('KeyF');
await page.keyboard.down('KeyW');
await page.keyboard.down('Space');
await page.waitForTimeout(6000);
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
const after = await page.evaluate(() => window.__spg.snapshot().playerPos);
await page.screenshot({ path: process.argv[2] ?? 'qa/out/fly.png' });
console.log('before', before.map((v) => v.toFixed(1)).join(','), 'after', after.map((v) => v.toFixed(1)).join(','));
console.log(after[1] - before[1] > 10 ? 'FLY_OK' : 'FLY_FAIL');
await browser.close();
process.exit(0);
