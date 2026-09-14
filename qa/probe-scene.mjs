import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 3470 + Math.floor(Math.random() * 100);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore', cwd: '/home/n8n/gamers/spg3d' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto(`http://localhost:${port}/?screen=${process.argv[2] ?? 'boss'}&track=shchyolkovo&q=low&maxdt=0.5&ts=3&auto=1&depth=${process.argv[3] ?? 3}`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
await page.waitForTimeout(12000);
const out = await page.evaluate(() => {
  const sc = window.__spg.knobs.scene?.();
  const scene = sc.scene;
  const rows = {};
  const visit = (o, path) => {
    if (!o.visible) return;
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      const tris = o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count ?? 0) / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      const mats = Array.isArray(o.material) ? o.material.length : 1;
      const r = (rows[path] ??= { objs: 0, calls: 0, tris: 0 });
      r.objs++; r.calls += mats; r.tris += Math.round(tris * n);
    }
    for (const c of o.children) visit(c, depth(path) < DEPTH ? `${path}/${c.name || c.type}${c.children.length ? `(${c.children.length})` : ''}` : path);
  };
  const DEPTH = Number(new URLSearchParams(location.search).get('depth') ?? 3);
  const depth = (p) => p.split('/').length;
  for (const c of scene.children) visit(c, (c.name || c.type) + (c.children.length ? `(${c.children.length})` : ''));
  return { rows, snap: window.__spg.snapshot() };
});
const rows = Object.entries(out.rows).sort((a, b) => b[1].calls - a[1].calls);
for (const [k, v] of rows.slice(0, 40)) console.log(String(v.calls).padStart(4), String(v.tris).padStart(8), k);
console.log('snapshot calls', out.snap.drawCalls, 'tris', out.snap.triangles);
await browser.close();
process.exit(0);
