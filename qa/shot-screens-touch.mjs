import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const [w = '900', h = '420', tag = 'ph'] = process.argv.slice(2);
const port = 3600 + Math.floor(Math.random() * 50);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const O = '/mnt/ramdisk/spg-shots';
await page.goto(`http://localhost:${port}/?screen=menu`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
for (const s of ['quick', 'garage', 'career', 'records', 'settings']) {
  await page.evaluate((s) => window.__spg.goto(s), s);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${O}/${tag}-${s}.png`, timeout: 150000 });
}
await page.evaluate(() => window.__spg.goto('career'));
await page.waitForTimeout(500);
await page.getByRole('button', { name: /Вызов/i }).first().tap().catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${O}/${tag}-story.png`, timeout: 150000 });
console.log('errors:', await page.evaluate(() => window.__spg.errors));
await browser.close();
process.exit(0);
