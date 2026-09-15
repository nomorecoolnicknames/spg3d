// Close-up of the player's car on the grid from the front and the back (lights, paint, model):
//   node qa/car-look.mjs <car> <track> <outPrefix> [colour]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [car = 'm5cs', track = 'shchyolkovo', out = '/mnt/ramdisk/spg3d-qa/car/c', color = ''] = process.argv.slice(2);
const port = 4470 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&car=${car}&opp=0&q=high&maxdt=0.2${color ? `&color=${encodeURIComponent(color)}` : ''}`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.knobs.viewFrom && window.__spg.knobs.probe, null, { timeout: 420000 });
const pr = await page.evaluate(() => window.__spg.knobs.probe());
const [x, y, z] = pr.nearest.car;
const [lx, lz] = pr.nearest.left;
const fx = -lz, fz = lx;
const shots = {
  front: [x + fx * 6.5 + lx * 2.2, y + 1.3, z + fz * 6.5 + lz * 2.2, x, y + 0.6, z],
  rear: [x - fx * 6.5 - lx * 2.2, y + 1.3, z - fz * 6.5 - lz * 2.2, x, y + 0.6, z],
  side: [x + lx * 6, y + 1.2, z + lz * 6, x, y + 0.6, z],
};
for (const [name, v] of Object.entries(shots)) {
  await page.evaluate((a) => window.__spg.knobs.viewFrom(...a), v);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-${car}-${name}.png`, timeout: 240000 });
  console.log(`${out}-${car}-${name}.png`);
}
await browser.close();
process.exit(0);
