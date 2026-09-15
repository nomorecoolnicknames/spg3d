// Lap counting: a 2-lap race must finish right after the 2nd line crossing, also when the F flight was used.
//   node qa/lap-check.mjs [track] [laps]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const [track = 'shchyolkovo', laps = '2'] = process.argv.slice(2);
const port = 4270 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const events = [];
await page.exposeFunction('__lapEvent', (e) => events.push(e));
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&auto=1&laps=${laps}&opp=0&q=low&maxdt=0.5&ts=4`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.snapshot()?.hud?.kind === 'race', null, { timeout: 420000 });
await page.evaluate(() => window.__spg.knobs.skipCountdown?.());
let flew = false, landed = false, last = '';
const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => ({ hud: window.__spg.snapshot()?.hud, screen: window.__spg.snapshot()?.screen }));
  const h = s.hud ?? {};
  const line = `lap ${h.lap}/${h.totalLaps} raceTime ${h.raceTime?.toFixed?.(1)} last ${h.lastLap?.toFixed?.(1) ?? '-'} screen ${s.screen}`;
  if (line.replace(/raceTime [\d.]+/, '') !== last) console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4), line);
  last = line.replace(/raceTime [\d.]+/, '');
  if (!flew && h.raceTime > 20) { await page.keyboard.press('KeyF'); flew = true; console.log('     F on at', h.raceTime.toFixed(1)); }
  else if (flew && !landed && h.raceTime > 24) { await page.keyboard.press('KeyF'); landed = true; console.log('     F off at', h.raceTime.toFixed(1)); }
  if (s.screen !== 'race') break;
}
await browser.close();
process.exit(0);
