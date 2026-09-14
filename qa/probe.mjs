import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 3300 + Math.floor(Math.random() * 50);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://localhost:${port}/?screen=race&track=${process.argv[2] ?? 'ligovsky'}&auto=1&q=low`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
await page.waitForTimeout(12000);
console.log(JSON.stringify(await page.evaluate(() => window.__spg.knobs.probe?.())));
await page.screenshot({ path: '/mnt/ramdisk/spg-shots/probe-a.png', timeout: 120000 });
console.log('hide →', await page.evaluate(() => [window.__spg.knobs.hide?.('terrain'), window.__spg.knobs.hide?.('road')]));
await page.waitForTimeout(500);
await page.screenshot({ path: '/mnt/ramdisk/spg-shots/probe-b.png', timeout: 120000 });
await browser.close();
process.exit(0);
