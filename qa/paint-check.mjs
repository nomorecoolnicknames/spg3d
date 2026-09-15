// Garage paint: pick another swatch and check the showcase car changes colour on screen.
//   node qa/paint-check.mjs [car]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const [car = 'lancia'] = process.argv.slice(2);
const port = 4670 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}/?screen=garage&car=${car}&q=medium`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.snapshot()?.screen === 'garage', null, { timeout: 420000 });
await page.waitForTimeout(6000);
const swatches = await page.$$('.swatch');
const colourAt = async (label) => {
  await page.waitForTimeout(3000);
  const shot = `/mnt/ramdisk/spg3d-qa/paint-${car}-${label}.png`;
  await page.screenshot({ path: shot, timeout: 240000 });
  return shot;
};
const a = await colourAt('before');
await swatches[2].click();
const b = await colourAt('after');
console.log(a, b);
await browser.close();
process.exit(0);
