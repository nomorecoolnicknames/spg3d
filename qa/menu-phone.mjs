// Menu / settings on a phone-sized landscape viewport with touch (OnePlus Ace ≈ 804×360 CSS px).
//   node qa/menu-phone.mjs [outDir] [w] [h]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const [out = 'qa/out/phone', w = '804', h = '360'] = process.argv.slice(2);
const port = 3970 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg && window.__spg.ready, null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/menu.png` });
const info = await page.evaluate(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); const st = getComputedStyle(el); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), display: st.display, visibility: st.visibility }; };
  const items = [...document.querySelectorAll('.menu-item')].map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent.slice(0, 20), y: Math.round(b.y), h: Math.round(b.height) }; });
  return { vh: innerHeight, items, music: r('.music-widget') ?? r('[class*=music]'), menu: r('.screen.menu') };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
process.exit(0);
