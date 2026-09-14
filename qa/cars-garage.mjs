// Garage turntable shots of every car (new baked format): paint mask, AO, glass, wheels, draw calls.
//   node qa/cars-garage.mjs [low|medium|high] [outDir] [pose]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [quality = 'medium', outDir = 'qa/out/cars', pose = '0.9'] = process.argv.slice(2);
const CARS = (process.env.CARS ?? 'm5cs,supra,lancia,m8,gt40,bolide').split(',');
const COLORS = ['#c8102e', '#f2f3f7', '#1f4fd1', '#1d1d22', '#2e9e5a', '#f5a623'];
const port = 3270 + Math.floor(Math.random() * 100);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${port}/?q=${quality}&pose=${pose}`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
const rows = [];
for (let i = 0; i < CARS.length; i++) {
  const car = CARS[i];
  await page.evaluate(([c, col]) => window.__spg.goto('garage', { car: c, color: col }), [car, COLORS[i]]);
  // hd atlas swaps in asynchronously on medium/high; give swiftshader time for a few frames
  await page.waitForTimeout(quality === 'low' ? 5000 : 9000);
  const info = await page.evaluate(() => ({ probe: window.__spg.knobs.showcaseProbe?.(), stats: window.__spg.snapshot().extra2 }));
  await page.addStyleTag({ content: '#root > *:not(:first-child){display:none !important}' });
  await page.screenshot({ path: `${outDir}/${quality}-${car}.png` });
  rows.push({ car, ...info.probe, draws: info.stats?.drawCalls, tris: info.stats?.triangles });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
console.log('console:', logs.slice(0, 10));
await browser.close();
process.exit(0);
