// Garage close-up without the UI panels: node qa/garage-look.mjs <car> [quality] [out]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const [car = 'bolide', quality = 'high', out = `/mnt/ramdisk/spg3d-qa/garage-${car}.png`] = process.argv.slice(2);
const port = 4770 + Math.floor(Math.random() * 20);
const server = spawn('node', ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${port}/?screen=garage&car=${car}&q=${quality}`, { timeout: 120000 });
await page.waitForFunction(() => window.__spg?.ready && window.__spg.snapshot()?.screen === 'garage', null, { timeout: 420000 });
await page.addStyleTag({ content: '.screen, .menu-tools, .wa { visibility: hidden !important; }' });
await page.waitForTimeout(12000);
await page.screenshot({ path: out, timeout: 240000 });
console.log(out);
await browser.close();
process.exit(0);
