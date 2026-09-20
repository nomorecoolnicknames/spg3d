// Smoke-test the actual Pages URL after deployment; no local server or mocked assets.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const base = process.env.QA_BASE ?? 'https://nomorecoolnicknames.github.io/spg3d/';
const out = process.env.QA_OUT ?? 'qa/out/pages';
mkdirSync(out, { recursive: true });
const errors = [], samples = [];
const browser = await chromium.launch({ args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}?q=medium&maxdt=0.2`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spg?.ready, null, { timeout: 300000 });
  const entry = await page.locator('script[type="module"][src]').getAttribute('src');
  if (process.env.QA_EXPECT_ENTRY && path.basename(entry) !== process.env.QA_EXPECT_ENTRY) throw new Error(`Stale entry: ${entry}`);
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (await page.evaluate(() => window.__spg.screen) !== 'menu') throw new Error('Menu did not load');
  await page.screenshot({ path: path.join(out, 'menu.png'), timeout: 180000 });
  for (const track of ['shchyolkovo', 'ligovsky', 'warsaw']) {
    await page.evaluate(track => window.__spg.goto('race', { track, opp: 0, traffic: 0 }), track);
    await page.waitForFunction(() => window.__spg?.screen === 'race' && window.__spg.knobs.surfaceStats, null, { timeout: 180000 });
    await frames();
    await page.screenshot({ path: path.join(out, `${track}.png`), timeout: 180000 });
    const sample = await page.evaluate(() => ({ ...window.__spg.snapshot(), surfaces: window.__spg.knobs.surfaceStats(), visuals: window.__spg.knobs.visualStats() }));
    if (!(sample.drawCalls > 0) || sample.surfaces.invalid || sample.visuals.invalidPanes || !sample.visuals.interiorVertices) errors.push(`${track}: invalid city render`);
    samples.push({ track, sample });
    console.log(track, sample.drawCalls, sample.triangles, 'errors', errors.length);
    await page.evaluate(() => window.__spg.goto('menu'));
    await page.waitForFunction(() => window.__spg.screen === 'menu' && !window.__spg.knobs.surfaceStats);
  }
  const report = { base, entry, pass: errors.length === 0, samples, errors };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
