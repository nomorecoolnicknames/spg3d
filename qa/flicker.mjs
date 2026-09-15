// Temporal aliasing of the city: the camera moves by sub-pixel steps around a fixed view; a correct image
// barely changes, aliasing windows / specks change a lot. Writes frames and prints the flicker score.
//   node qa/flicker.mjs <track> "x,y,z>tx,ty,tz" <outDir> [extraQuery] [frames]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [track = 'ligovsky', view = '-200,6,-600>-60,20,-560', out = '/mnt/ramdisk/spg3d-qa/flicker/a', extra = '', framesS = '12'] = process.argv.slice(2);
const port = 4570 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://localhost:${port}/?screen=race&track=${track}&opp=0&q=medium&maxdt=0.2&weather=0${extra}`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.knobs.viewFrom, null, { timeout: 420000 });
const [a, b] = view.split('>').map((s) => s.split(',').map(Number));
const dir = [b[0] - a[0], b[2] - a[2]];
const dl = Math.hypot(...dir);
const side = [-dir[1] / dl, dir[0] / dl];
const n = Number(framesS);
await page.evaluate((v) => window.__spg.knobs.viewFrom(...v), [...a, ...b]);
await page.waitForTimeout(3000);
for (let k = 0; k < n; k++) {
  // 2 cm sideways per frame, the look target moves with it: pure sub-pixel translation for a far facade
  const o = k * 0.02;
  await page.evaluate((v) => window.__spg.knobs.viewFrom(...v), [a[0] + side[0] * o, a[1], a[2] + side[1] * o, b[0] + side[0] * o, b[1], b[2] + side[1] * o]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/f${String(k).padStart(2, '0')}.png`, timeout: 240000 });
}
await browser.close();
console.log(execFileSync('python3', ['-c', `
import glob, numpy as np
from PIL import Image
fs = sorted(glob.glob('${out}/f*.png'))
ims = [np.asarray(Image.open(f).convert('L'), dtype=np.float32) for f in fs]
h = ims[0].shape[0]
roi = slice(int(h*0.08), int(h*0.55))  # facades above the road, below the HUD top bar
d = [np.abs(ims[i+1][roi, 60:-260] - ims[i][roi, 60:-260]) for i in range(len(ims)-1)]
m = np.mean([x.mean() for x in d]); p = np.mean([(x > 24).mean() for x in d])
print(f'flicker: mean |dL| {m:.2f}, pixels changing > 24/255: {p*100:.2f} %')
`]).toString());
process.exit(0);
