// Music must start at the saved volume, not at 100 %: node qa/volume-check.mjs
// Saves music = 0.2 before the first load, then reads how loud the playing track is before and after the
// audio unlock (the <audio> element plays straight to the speakers until Web Audio is unlocked).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port = 4390 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://localhost:${port}/`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready, null, { timeout: 420000 });
// write the setting the way the settings screen does, then reload so it is the saved value at boot
await page.evaluate(() => window.__spg.knobs.setSettings?.({ master: 1, music: 0.2, musicPlaying: true }));
await page.reload({ timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready, null, { timeout: 420000 });
await page.waitForTimeout(2500);
const before = await page.evaluate(() => window.__spg.knobs.audioState());
await page.mouse.click(10, 10);
await page.evaluate(() => window.__spg.knobs.audioUnlock?.());
await page.waitForTimeout(2500);
const after = await page.evaluate(() => window.__spg.knobs.audioState());
console.log('before unlock', JSON.stringify(before));
console.log('after unlock ', JSON.stringify(after));
// master 1 × music 0.2: whatever plays must not be louder than that (it used to be 1.0 until the audio unlock)
const ok = (s) => s.volume <= 0.2 + 0.02;
console.log(ok(before) && ok(after) ? 'VOLUME_OK' : 'VOLUME_WRONG');
await browser.close();
process.exit(ok(before) && ok(after) ? 0 : 1);
