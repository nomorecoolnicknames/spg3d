// phone-landscape touch layout shots: menu, race, boss (hasTouch, isMobile)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 3500 + Math.floor(Math.random() * 50);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const O = '/mnt/ramdisk/spg-shots';
await page.goto(`http://localhost:${port}/?screen=menu`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${O}/touch-menu.png`, timeout: 150000 });
await page.evaluate(() => window.__spg.goto('race', { track: 'neon', laps: 1, opp: 3 }));
await page.evaluate(() => { window.__spg.setMaxDt(0.5); window.__spg.setTimeScale(3); });
await page.waitForTimeout(12000);
// hold brake to check reverse works through the touch path
await page.evaluate(() => { window.__spg.setAutopilot(false); });
await page.evaluate(() => { window.__spg.knobs.setTouch('throttle', true); });
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__spg.knobs.setTouch('throttle', false); window.__spg.knobs.setTouch('brake', true); });
await page.waitForTimeout(6000);
const snap = await page.evaluate(() => JSON.stringify({ hud: window.__spg.snapshot().hud?.speedKmh, gear: window.__spg.snapshot().hud?.gear, speed: window.__spg.snapshot().playerSpeed, q: window.__spg.snapshot().drawCalls, tris: window.__spg.snapshot().triangles }));
console.log('after brake hold:', snap);
await page.screenshot({ path: `${O}/touch-race.png`, timeout: 150000 });
await page.evaluate(() => window.__spg.goto('boss', {}));
await page.waitForTimeout(8000);
await page.screenshot({ path: `${O}/touch-boss.png`, timeout: 150000 });
console.log('errors:', await page.evaluate(() => window.__spg.errors));
await browser.close();
process.exit(0);
