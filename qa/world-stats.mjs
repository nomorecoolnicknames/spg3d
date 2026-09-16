// World build stats of a track (buildings, heroes placed, triangles, LOD counts) and console errors:
//   DIST=<dir> node qa/world-stats.mjs <track>
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const [track] = process.argv.slice(2);
const port = 3990 + Math.floor(Math.random() * 9);
const server = spawn('node', ['scripts/serve.mjs', '--dir', process.env.DIST ?? 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&auto=1&q=medium&maxdt=0.2&ts=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready && window.__spg.knobs.worldStats, null, { timeout: 420000 });
console.log(track, JSON.stringify(await page.evaluate(() => window.__spg.knobs.worldStats())), logs.slice(0, 5));
await browser.close();
process.exit(0);
