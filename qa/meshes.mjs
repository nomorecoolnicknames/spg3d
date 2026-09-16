// World meshes by name prefix (visibility, vertices, bounding sphere), largest first:
//   DIST=<dir> node qa/meshes.mjs <track> <prefix>
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const [track, prefix] = process.argv.slice(2);
const port = 3980 + Math.floor(Math.random() * 9);
const server = spawn('node', ['scripts/serve.mjs', '--dir', process.env.DIST ?? 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&auto=1&q=medium&maxdt=0.2&ts=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready && window.__spg.knobs.meshes, null, { timeout: 420000 });
const list = await page.evaluate((p) => window.__spg.knobs.meshes(p), prefix);
console.log(JSON.stringify(list.sort((a, b) => b.verts - a.verts).slice(0, 40)));
await browser.close();
process.exit(0);
