// Judder check: node qa/motion-check.mjs [track] [distDir] [frameDt]
// Runs an autopilot race on medium (traffic on) with a fixed frame step and reads the frame-to-frame acceleration
// of the rendered player car, camera, AI cars and traffic (window.__spg.knobs.motionStats): median, 95th/99th
// percentile and maximum, the hard contacts by kind and the biggest spikes (with whether a contact caused them).
// Smooth motion stays in the tens of m/s²; snapping, uneven simulation steps or teleports show up as hundreds+.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

// frameDt: every frame advances the game by exactly this much (0.0167 ≈ 60 Hz, 0.0111 = 90 Hz, 0.0083 = 120 Hz)
const [track = 'shchyolkovo', dir = 'dist', frameDt = '0.0167'] = process.argv.slice(2);
const port = 4410 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', dir, '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&auto=1&q=medium&maxdt=${frameDt}&weather=0`, { timeout: 180000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.snapshot()?.hud?.started, null, { timeout: 900000 });
const simTime = () => page.evaluate(() => window.__spg.snapshot()?.hud?.raceTime ?? 0);
const until = async (sec) => { while ((await simTime()) < sec) await page.waitForTimeout(1500); };
// the measured window in race seconds (MOTION_WINDOW=from,to; a busy machine can use a shorter one)
const [from, to] = (process.env.MOTION_WINDOW ?? '6,26').split(',').map(Number);
await until(from);
await page.evaluate(() => window.__spg.knobs.motionStats?.(true));
await until(to);
const stats = await page.evaluate(() => window.__spg.knobs.motionStats?.());
console.log(`motion (|second difference| of rendered positions, m/s², over ${to - from} s of race)`, JSON.stringify(stats));
await browser.close();
process.exit(0);
