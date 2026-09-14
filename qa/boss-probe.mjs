// Boss fight timeline for QA triage: node qa/boss-probe.mjs <extraQuery> [seconds]
// Samples the HUD every 2 s with the autopilot; after 20 s drops the boss to 60 % HP (like qa/shots.mjs).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const [extra = '', secs = '70'] = process.argv.slice(2);
const port = 4070 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto(`http://localhost:${port}/?screen=boss&auto=1&q=low&maxdt=0.5&ts=2${extra}`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.snapshot()?.hud?.kind === 'boss', null, { timeout: 420000 });
await page.evaluate(() => window.__spg.knobs.skipIntro?.());
const t0 = Date.now();
let dropped = false;
while (Date.now() - t0 < Number(secs) * 1000) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => ({ hud: window.__spg.snapshot()?.hud, fps: window.__spg.snapshot()?.fps, screen: window.__spg.snapshot()?.screen }));
  const h = s.hud ?? {};
  console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(3), 'fps', s.fps, 'player', h.playerHP, 'boss', h.bossHP, 'phase', h.bossPhase, 'minions', h.minions, h.won ? 'WON' : '', h.lost || h.dead ? 'DEAD' : '', (h.message ?? '').slice(0, 40), s.screen);
  if (!dropped && Date.now() - t0 > 20000) {
    dropped = true;
    await page.evaluate(() => window.__spg.knobs.setBossHP?.(60));
  }
}
await browser.close();
process.exit(0);
