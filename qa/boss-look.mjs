// Close-ups of the final boss: node qa/boss-look.mjs <outPrefix> [quality]
// Views: angle (rad, 0 = in front of the boss), distance, camera height, look-at height.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [out = '/mnt/ramdisk/spg3d-qa/boss-look/m', quality = 'medium'] = process.argv.slice(2);
const views = (process.env.VIEWS ?? 'front:0,34,9,9;face:0,11,14.5,14.5;side:1.2,30,9,9;back:3.14,30,9,9;low:0.4,20,1.8,11;door:0').split(';').map((v) => {
  const [name, args] = v.split(':');
  return [name, args.split(',').map(Number)];
});
const port = 3990 + Math.floor(Math.random() * 9);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
await page.goto(`http://localhost:${port}/?screen=boss&q=${quality}&maxdt=0.2`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.snapshot()?.hud?.kind === 'boss', null, { timeout: 420000 });
await page.evaluate(() => { window.__spg.knobs.godMode?.(true); window.__spg.knobs.skipIntro?.(); });
for (const [name, v] of views) {
  // 'door' frames the 1703 entrance from the yard; 'cam*' views are six numbers: camera xyz, target xyz
  await page.evaluate(([n, a]) => {
    const k = window.__spg.knobs;
    const d = k.arenaDoor?.();
    if (n === 'game') {
      k.bossView();
      k.bossCam();
    } else if (n === 'door' && d) {
      k.bossView();
      k.bossCam(d.x + d.nx * 16 - d.nz * 6, 3.2, d.z + d.nz * 16 + d.nx * 6, d.x, 3.5, d.z);
    } else if (n.startsWith('cam')) {
      k.bossView();
      k.bossCam(...a);
    } else {
      k.bossCam();
      k.bossView(...a);
    }
  }, [name, v]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-${name}.png`, timeout: 240000 });
  console.log('shot', name);
}
console.log('errors', logs.slice(0, 5));
await browser.close();
server.kill();
process.exit(0);
