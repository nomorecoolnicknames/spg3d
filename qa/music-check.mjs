// The playlist must not jump back to the saved track when a race ends: node qa/music-check.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port = 4370 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://localhost:${port}/`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready, null, { timeout: 420000 });
await page.evaluate(() => window.__spg.knobs.audioUnlock?.());
await page.mouse.click(10, 10);
await page.waitForTimeout(1500);
const st = () => page.evaluate(() => window.__spg.knobs.audioState());
console.log('menu      ', JSON.stringify(await st()));
await page.evaluate(() => window.__spg.goto('race', { track: 'shchyolkovo', laps: 1, opp: 0, auto: true }));
await page.waitForFunction(() => window.__spg.snapshot()?.hud?.kind === 'race', null, { timeout: 420000 });
await page.evaluate(() => window.__spg.knobs.musicNext());
await page.waitForTimeout(1500);
const during = await st();
console.log('race+next ', JSON.stringify(during));
await page.evaluate(() => window.__spg.knobs.finishNow?.());
await page.waitForFunction(() => window.__spg.snapshot()?.screen !== 'race', null, { timeout: 120000 });
await page.waitForTimeout(2500);
const after = await st();
console.log('results   ', JSON.stringify(after), await page.evaluate(() => window.__spg.snapshot()?.screen));
console.log(after.track === during.track ? 'MUSIC_OK' : 'MUSIC_JUMPED');
await browser.close();
process.exit(0);
