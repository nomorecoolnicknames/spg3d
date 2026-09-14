// Auto quality tier on first boot: swiftshader must classify as low, a manual ?q= must stay manual.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 3670 + Math.floor(Math.random() * 100);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fail = 0;
for (const [query, want] of [['', { quality: 'low', qualityAuto: true }], ['?q=high', { quality: 'high', qualityAuto: false }]]) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${port}/${query}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('spg3d-save-v2') ?? '{}').settings ?? {});
  const ok = s.quality === want.quality && s.qualityAuto === want.qualityAuto;
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(query), JSON.stringify({ quality: s.quality, qualityAuto: s.qualityAuto, tierVersion: s.tierVersion }));
}
await browser.close();
process.exit(fail ? 1 : 0);
