import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 3960 + Math.floor(Math.random() * 9);
const server = spawn('node', ['scripts/serve.mjs', '--dir', process.env.DIST ?? 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`http://localhost:${port}/?q=low&maxdt=0.5`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 300000 });
await sleep(3000);
const mem = async (label) => { const s = await page.evaluate(() => window.__spg.snapshot()); console.log(label, 'screen', await page.evaluate(() => window.__spg.screen), 'geo', s?.geometries, 'tex', s?.textures, 'started', s?.hud?.started); };
await mem('menu0');
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__spg.goto('race', { track: 'shchyolkovo', laps: 1, opp: 3, auto: true }));
  const t0 = Date.now();
  await sleep(6000);
  await mem(`race${i + 1}@6s`);
  await page.waitForFunction(() => window.__spg.snapshot()?.hud?.started, null, { timeout: 300000 }).catch(() => {});
  console.log('race', i + 1, 'started after', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await mem(`race${i + 1}@started`);
  await page.evaluate(() => window.__spg.goto('menu'));
  await sleep(1500);
  await mem(`menu${i + 1}@1.5s`);
  await sleep(6000);
  await mem(`menu${i + 1}@7.5s`);
}
await browser.close();
process.exit(0);
