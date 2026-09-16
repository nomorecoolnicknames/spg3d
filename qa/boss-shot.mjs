// Screenshots of the final fight (Ligovsky 50 yard): node qa/boss-shot.mjs <outPrefix> [quality] [seconds,...]
// env: PHASE=<1..3>, KILL_AT=<second> (the player dies before that shot), DIST=<dist dir>
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [out = '/mnt/ramdisk/spg3d-qa/boss/b', quality = 'medium', list = '2,10'] = process.argv.slice(2);
const port = 3970 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', process.env.DIST ?? 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
await page.goto(`http://localhost:${port}/?screen=boss&auto=1&q=${quality}&maxdt=0.2`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.snapshot()?.hud?.kind === 'boss', null, { timeout: 420000 });
if (process.env.PHASE) await page.evaluate((ph) => window.__spg.knobs.setPhase?.(Number(ph)), process.env.PHASE);
const t0 = Date.now();
let killed = false;
for (const sec of list.split(',').map(Number)) {
  const wait = t0 + sec * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  // KILL_AT=<s>: the player dies at that second (the death pose)
  if (process.env.KILL_AT && sec >= Number(process.env.KILL_AT) && !killed) {
    killed = true;
    await page.evaluate(() => window.__spg.knobs.damagePlayer?.(1000));
    await page.waitForTimeout(2500);
  }
  const s = await page.evaluate(() => window.__spg.snapshot());
  await page.screenshot({ path: `${out}-${sec}.png`, timeout: 240000 });
  console.log(sec, 'calls', s.drawCalls, 'tris', s.triangles, 'hp', s.hud?.bossHp ?? s.hud?.boss);
}
console.log('errors', logs.slice(0, 5));
await browser.close();
process.exit(0);
