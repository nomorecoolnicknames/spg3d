#!/usr/bin/env node
// Headless QA: builds dist, serves it, drives the game through window.__spg,
// takes screenshots, asserts HUD/perf/leak invariants, writes a report.
//
//   npm run qa
//   node qa/shots.mjs --only race,boss --no-build --base http://localhost:3100
//   node qa/shots.mjs --skip-mobile --ts 3 --run mylabel
//
// Exit code 1 if any assertion failed. Output: qa/out/<run>/{*.png,report.json,index.html}, qa/out/latest → run.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const ONLY = opt('--only', '').split(',').filter(Boolean);
const BASE = opt('--base', '');
const NO_BUILD = flag('--no-build') || !!BASE;
const SKIP_MOBILE = flag('--skip-mobile');
const TS = Number(opt('--ts', 3));
const MAXDT = Number(opt('--maxdt', 0.5));
const QUALITY = opt('--quality', 'low');
const HEADED = flag('--headed');
const RUN = opt('--run', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const OUT = join(ROOT, 'qa', 'out', RUN);
mkdirSync(OUT, { recursive: true });

const CHROME_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-dev-shm-usage',
  '--no-sandbox',
];

const TRACKS = ['neon', 'canyon', 'aurora'];
const CARS = ['m5cs', 'supra', 'lancia', 'm8', 'gt40', 'bolide'];

// ---------------------------------------------------------------- report model
const report = { run: RUN, startedAt: new Date().toISOString(), base: BASE, scenarios: [], summary: { pass: 0, fail: 0 } };
let current = null;

function scenario(name, viewport) {
  current = { name, viewport, status: 'pass', checks: [], shots: [], errors: [], snapshots: {}, notes: [], ms: 0 };
  report.scenarios.push(current);
  return current;
}
function check(label, ok, detail = '') {
  current.checks.push({ label, ok: !!ok, detail: String(detail ?? '') });
  if (!ok) current.status = 'fail';
  console.log(`   ${ok ? 'ok ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}
function note(text) {
  current.notes.push(text);
  console.log(`   · ${text}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- page helpers
async function snap(page) {
  try {
    return await page.evaluate(() => (window.__spg ? window.__spg.snapshot() : null));
  } catch (e) {
    return null;
  }
}
async function hud(page) {
  const s = await snap(page);
  return s?.hud ?? null;
}
async function screen(page) {
  try {
    return await page.evaluate(() => window.__spg?.screen ?? document.body.dataset.screen ?? null);
  } catch {
    return null;
  }
}
async function errorsOf(page) {
  try {
    return await page.evaluate(() => (window.__spg?.errors ?? window.__spgErrors ?? []).slice());
  } catch {
    return [];
  }
}
async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUT, file), type: 'png', timeout: 120_000 });
  current.shots.push(file);
  console.log(`   📷 ${file}`);
  return file;
}
async function waitReady(page, timeout = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ready = await page.evaluate(() => !!(window.__spg && window.__spg.ready)).catch(() => false);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}
async function waitFor(page, fn, timeout, interval = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    await sleep(interval);
  }
  return null;
}
async function gotoScreen(page, screenId, params = {}) {
  await page.evaluate(([s, p]) => window.__spg.goto(s, p), [screenId, params]);
}
async function openBase(page, url) {
  const t0 = Date.now();
  await page.goto(`${url}?q=${QUALITY}&maxdt=${MAXDT}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const ready = await waitReady(page);
  check('assets loaded (__spg.ready)', ready, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return ready;
}
async function pushPageErrors(page) {
  const errs = await errorsOf(page);
  const fresh = errs.filter((e) => !current.errors.includes(e));
  current.errors.push(...fresh);
  return errs;
}
function assertNoErrors(errs, label = 'no runtime errors') {
  const meaningful = (errs || []).filter((e) => !/THREE\.WebGLRenderer: .*(swiftshader|WEBGL_debug)|GPU stall|AudioContext was not allowed/i.test(e));
  check(label, meaningful.length === 0, meaningful.slice(0, 3).join(' | ').slice(0, 300));
}

// ---------------------------------------------------------------- scenarios
async function scMenuScreens(page, base, vp) {
  scenario(`screens${vp.tag}`, vp.tag);
  if (!(await openBase(page, base))) return;
  await sleep(1500);
  const sc = await screen(page);
  check('menu shown after boot', sc === 'menu', `screen=${sc}`);
  await shot(page, `menu${vp.tag}`);
  for (const car of CARS) {
    await gotoScreen(page, 'garage', { car });
    await sleep(1200);
    await shot(page, `garage-${car}${vp.tag}`);
  }
  if (!vp.mobile) {
    for (const s of ['career', 'quick', 'records', 'settings']) {
      await gotoScreen(page, s);
      await sleep(700);
      check(`screen ${s} reachable`, (await screen(page)) === s);
      await shot(page, `${s}${vp.tag}`);
    }
    // story: click the first "Вызов" button on the career screen
    await gotoScreen(page, 'career');
    await sleep(600);
    const btn = page.getByRole('button', { name: /Вызов/i }).first();
    const has = (await btn.count()) > 0;
    check('career has a «Вызов» button', has);
    if (has) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await sleep(900);
      check('story screen opened', (await screen(page)) === 'story', `screen=${await screen(page)}`);
      await shot(page, `story${vp.tag}`);
      await page.keyboard.press('Space').catch(() => {});
      await sleep(800);
      await shot(page, `story-2${vp.tag}`);
    }
  }
  // audio smoke: unlock via a real click, fire a few one-shots, start music
  await gotoScreen(page, 'menu');
  await sleep(400);
  await page.mouse.click(30, 30);
  const audioState = await page.evaluate(async () => {
    const k = window.__spg.knobs;
    k.audioUnlock?.();
    for (const n of ['ui-click', 'count-beep', 'hit-wall', 'explosion', 'mech-roar', 'rocket-launch']) k.audioPlay?.(n);
    await new Promise((r) => setTimeout(r, 1500));
    return k.audioState?.();
  });
  check('audio unlocked after click', !!audioState?.unlocked, JSON.stringify(audioState));
  check('music plays after unlock', !!audioState?.music && (audioState?.time ?? 0) > 0, JSON.stringify(audioState));
  assertNoErrors(await pushPageErrors(page));
  const s = await snap(page);
  if (s) current.snapshots.menu = s;
}

async function raceStart(page, base, track, extra = {}) {
  if (!(await openBase(page, base))) return false;
  await gotoScreen(page, 'race', { track, laps: 1, opp: 5, auto: true, ...extra });
  await page.evaluate(([ts, md]) => {
    window.__spg.setAutopilot(true);
    window.__spg.setTimeScale(ts);
    window.__spg.setMaxDt?.(md);
  }, [TS, MAXDT]);
  const h = await waitFor(page, async () => (await hud(page))?.kind === 'race', 15_000);
  check('race HUD appeared', !!h);
  return !!h;
}

async function scRace(page, base, track, vp) {
  scenario(`race-${track}${vp.tag}`, vp.tag);
  const t0 = Date.now();
  if (!(await raceStart(page, base, track))) return;
  // simulation time is TS × wall; shot times below are in sim seconds.
  const simAt = async (simSec) => {
    const wall = t0 + (simSec / TS) * 1000;
    const d = wall - Date.now();
    if (d > 0) await sleep(d);
  };
  await simAt(2);
  await shot(page, `race-${track}-countdown${vp.tag}`);
  await simAt(8);
  await shot(page, `race-${track}-08s${vp.tag}`);
  await simAt(12);
  let h = await hud(page);
  check('speed > 60 km/h by 12 s (sim)', (h?.speedKmh ?? 0) > 60, `speed=${h?.speedKmh}`);
  check('race started', !!h?.started, `countdown=${h?.countdown}`);
  const t1 = h?.raceTime ?? 0;
  await simAt(20);
  h = await hud(page);
  const s20 = await snap(page);
  check('raceTime increases', (h?.raceTime ?? 0) > t1, `${t1?.toFixed?.(1)} → ${h?.raceTime?.toFixed?.(1)}`);
  await shot(page, `race-${track}-20s${vp.tag}`);
  if (!vp.mobile) {
    // camera modes
    for (let i = 0; i < 4; i++) {
      await page.evaluate((m) => window.__spg.knobs.scene?.()?.setCameraMode?.(m), i).catch(() => {});
      await sleep(600);
      await shot(page, `race-${track}-cam${i}${vp.tag}`);
    }
    await page.evaluate(() => window.__spg.knobs.scene?.()?.setCameraMode?.(0)).catch(() => {});
    // pause overlay
    await page.keyboard.press('Escape');
    await sleep(500);
    await shot(page, `race-${track}-pause${vp.tag}`);
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  await simAt(45);
  const s45 = await snap(page);
  await shot(page, `race-${track}-45s${vp.tag}`);
  if (s20 && s45) {
    check('fps ≥ 8 (swiftshader)', s45.fps >= 8, `fps=${s45.fps}`);
    if (s45.fps < 15) note(`fps ${s45.fps} < 15 (soft target)`);
    check('drawCalls < 900', s45.drawCalls < 900, `calls=${s45.drawCalls}, tris=${s45.triangles}`);
    check('geometries stable 20s→45s (±30)', Math.abs(s45.geometries - s20.geometries) <= 30, `${s20.geometries} → ${s45.geometries}`);
    current.snapshots.at20 = s20;
    current.snapshots.at45 = s45;
  }
  // wait for finish: up to 150 s sim (≈ 150/TS wall) but never more than 90 s wall
  const wallCap = Math.min(150_000, (150 / TS) * 1000 + 30000);
  const done = await waitFor(
    page,
    async () => {
      const hh = await hud(page);
      const sc = await screen(page);
      if (hh?.finished || sc === 'results' || sc === 'story') return { hh, sc };
      return null;
    },
    wallCap,
    2000,
  );
  check('player finished the lap', !!done, done ? `screen=${done.sc}` : 'timed out');
  if (done) {
    const after = await waitFor(page, async () => ['results', 'story'].includes(await screen(page)), 15_000, 500);
    await sleep(800);
    await shot(page, `race-${track}-results${vp.tag}`);
    check('results/story screen shown', !!after, `screen=${await screen(page)}`);
  }
  assertNoErrors(await pushPageErrors(page));
}

async function scBoss(page, base, vp) {
  scenario(`boss${vp.tag}`, vp.tag);
  const t0 = Date.now();
  if (!(await openBase(page, base))) return;
  await gotoScreen(page, 'boss', { auto: true });
  const bossTS = Math.min(TS, 2);
  await page.evaluate(([ts, md]) => {
    window.__spg.setAutopilot(true);
    window.__spg.setTimeScale(ts);
    window.__spg.setMaxDt?.(md);
  }, [bossTS, MAXDT]);
  const h0 = await waitFor(page, async () => (await hud(page))?.kind === 'boss', 15_000);
  check('boss HUD appeared', !!h0);
  if (!h0) return;
  const simAt = async (simSec) => {
    const wall = t0 + (simSec / bossTS) * 1000;
    const d = wall - Date.now();
    if (d > 0) await sleep(d);
  };
  await simAt(1);
  await shot(page, `boss-intro${vp.tag}`);
  await simAt(6);
  const h6 = await hud(page);
  await shot(page, `boss-06s${vp.tag}`);
  await simAt(20);
  const h20 = await hud(page);
  await shot(page, `boss-20s${vp.tag}`);
  check('autopilot damages boss (6s→20s)', (h20?.bossHP ?? 100) < (h6?.bossHP ?? 100), `${h6?.bossHP} → ${h20?.bossHP}`);
  check('player alive at 20 s', !h20?.dead, `hp=${h20?.playerHP}`);
  const s20 = await snap(page);
  if (s20) {
    current.snapshots.at20 = s20;
    check('fps ≥ 8 (swiftshader)', s20.fps >= 8, `fps=${s20.fps}`);
    check('drawCalls < 900', s20.drawCalls < 900, `calls=${s20.drawCalls}, tris=${s20.triangles}`);
  }
  if (!vp.mobile) {
    const knobs = await page.evaluate(() => Object.keys(window.__spg.knobs || {}));
    check('boss knobs registered (setBossHP)', knobs.includes('setBossHP'), knobs.join(','));
    await page.evaluate(() => window.__spg.knobs.setBossHP?.(60)).catch(() => {});
    await sleep(2500);
    let h = await hud(page);
    check('phase 2 after setBossHP(60)', h?.bossPhase === 2, `phase=${h?.bossPhase}`);
    await shot(page, `boss-phase2${vp.tag}`);
    await page.evaluate(() => window.__spg.knobs.setBossHP?.(25)).catch(() => {});
    await sleep(2500);
    h = await hud(page);
    check('phase 3 after setBossHP(25)', h?.bossPhase === 3, `phase=${h?.bossPhase}`);
    await shot(page, `boss-phase3${vp.tag}`);
    await page.evaluate(() => window.__spg.knobs.setBossHP?.(1)).catch(() => {});
    const won = await waitFor(page, async () => (await hud(page))?.won || ['results', 'story'].includes(await screen(page)), 60_000, 1000);
    check('boss defeated (hud.won) within 60 s', !!won);
    await sleep(1200);
    await shot(page, `boss-won${vp.tag}`);
    const after = await waitFor(page, async () => ['results', 'story'].includes(await screen(page)), 20_000, 500);
    if (after) {
      await sleep(600);
      await shot(page, `boss-results${vp.tag}`);
    } else note('no results/story screen after boss win (onFinish not called?)');
  }
  assertNoErrors(await pushPageErrors(page));
}

async function scLeak(page, base) {
  scenario('leak', 'desktop');
  if (!(await openBase(page, base))) return;
  const samples = [];
  for (let i = 0; i < 2; i++) {
    await gotoScreen(page, 'race', { track: 'neon', laps: 1, opp: 3, auto: true });
    await page.evaluate(() => window.__spg.setAutopilot(true));
    await sleep(6000);
    await gotoScreen(page, 'menu');
    await sleep(1500);
    const s = await snap(page);
    samples.push(s);
    note(`after race #${i + 1}: geometries=${s?.geometries} textures=${s?.textures}`);
  }
  await shot(page, 'leak-menu-after');
  const [a, b] = samples;
  if (a && b) {
    check('geometries not growing (+10 %)', b.geometries <= a.geometries * 1.1 + 5, `${a.geometries} → ${b.geometries}`);
    check('textures not growing (+10 %)', b.textures <= a.textures * 1.1 + 2, `${a.textures} → ${b.textures}`);
  } else check('leak samples collected', false);
  assertNoErrors(await pushPageErrors(page));
}

// ---------------------------------------------------------------- report writers
function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.summary = { pass: report.scenarios.filter((s) => s.status === 'pass').length, fail: report.scenarios.filter((s) => s.status !== 'pass').length };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = report.scenarios
    .map((s) => {
      const perf = s.snapshots.at45 || s.snapshots.at20 || s.snapshots.menu;
      return `<section class="sc ${s.status}">
<h2>${esc(s.name)} <span class="badge">${s.status.toUpperCase()}</span> <small>${(s.ms / 1000).toFixed(1)} s · ${esc(s.viewport)}</small></h2>
<ul class="checks">${s.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.label)}${c.detail ? ` <em>${esc(c.detail)}</em>` : ''}</li>`).join('')}</ul>
${perf ? `<p class="perf">fps ${perf.fps} · draw calls ${perf.drawCalls} · tris ${perf.triangles} · geometries ${perf.geometries} · textures ${perf.textures}</p>` : ''}
${s.notes.length ? `<p class="notes">${s.notes.map(esc).join('<br>')}</p>` : ''}
${s.errors.length ? `<pre class="err">${esc(s.errors.slice(0, 20).join('\n'))}</pre>` : ''}
<div class="shots">${s.shots.map((f) => `<a href="${f}" target="_blank"><img src="${f}" loading="lazy" alt="${esc(f)}"><span>${esc(f)}</span></a>`).join('')}</div>
</section>`;
    })
    .join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>QA ${esc(RUN)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;background:#0d0e12;color:#e8e9ef;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}small{color:#889;font-weight:400}
.sum{color:#aab;margin-bottom:20px}.sc{border:1px solid #23252e;padding:14px 16px;margin-bottom:16px;border-radius:6px;background:#12131a}
.sc.fail{border-color:#a3202f}.badge{font-size:11px;padding:2px 6px;border-radius:3px;background:#1f6f3a;margin-left:6px;vertical-align:middle}
.fail .badge{background:#a3202f}.checks{list-style:none;padding:0;margin:0 0 6px;columns:2;column-gap:24px}
.checks li{break-inside:avoid;padding:1px 0}.ok{color:#8fd19e}.bad{color:#ff7b8a}em{color:#99a;font-style:normal}
.perf,.notes{color:#99a;margin:4px 0}.err{background:#1c1016;color:#ffb3bb;padding:8px;font-size:12px;white-space:pre-wrap;max-height:200px;overflow:auto}
.shots{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.shots a{width:300px;text-decoration:none;color:#aab;font-size:11px}
.shots img{width:300px;aspect-ratio:16/9;object-fit:cover;background:#000;border:1px solid #2a2c36;display:block}
</style>
<h1>SPG3D QA — ${esc(RUN)}</h1>
<p class="sum">${report.summary.pass} pass · ${report.summary.fail} fail · base ${esc(report.base || 'local dist')} · ${esc(report.startedAt)} → ${esc(report.finishedAt)}</p>
${rows}`;
  writeFileSync(join(OUT, 'index.html'), html);
  const latest = join(ROOT, 'qa', 'out', 'latest');
  try {
    rmSync(latest, { force: true, recursive: false });
  } catch {}
  try {
    symlinkSync(RUN, latest, 'dir');
  } catch {}
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(`QA run ${RUN} → ${OUT}`);
  if (!NO_BUILD) {
    console.log('building (npx vite build)…');
    execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
  }
  let server = null;
  let base = BASE;
  if (!base) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/index.html missing — build first or pass --base');
    server = await serve({ dir: join(ROOT, 'dist'), port: 0, quiet: true });
    base = server.url + '/';
    console.log(`serving dist at ${base}`);
  }
  report.base = base;
  const browser = await chromium.launch({ headless: !HEADED, args: CHROME_ARGS });
  const cleanup = async () => {
    await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  };
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  const viewports = [{ tag: '', mobile: false, w: 1280, h: 720 }];
  if (!SKIP_MOBILE) viewports.push({ tag: '-mobile', mobile: true, w: 900, h: 420 });

  const want = (n) => ONLY.length === 0 || ONLY.some((o) => n.startsWith(o));
  const plan = [];
  for (const vp of viewports) {
    if (want('screens')) plan.push({ name: `screens${vp.tag}`, vp, fn: (p, b) => scMenuScreens(p, b, vp), timeout: 240_000 });
    for (const t of TRACKS) {
      if (vp.mobile && t !== 'neon') continue;
      if (want('race')) plan.push({ name: `race-${t}${vp.tag}`, vp, fn: (p, b) => scRace(p, b, t, vp), timeout: 300_000 });
    }
    if (want('boss')) plan.push({ name: `boss${vp.tag}`, vp, fn: (p, b) => scBoss(p, b, vp), timeout: 300_000 });
  }
  if (want('leak')) plan.push({ name: 'leak', vp: viewports[0], fn: (p, b) => scLeak(p, b), timeout: 180_000 });

  for (const step of plan) {
    console.log(`\n▶ ${step.name}`);
    const t0 = Date.now();
    const ctx = await browser.newContext({
      viewport: { width: step.vp.w, height: step.vp.h },
      deviceScaleFactor: 1,
      isMobile: step.vp.mobile,
      hasTouch: step.vp.mobile,
      locale: 'ru-RU',
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
    });
    try {
      await Promise.race([
        step.fn(page, base),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`scenario timeout ${step.timeout / 1000}s`)), step.timeout)),
      ]);
    } catch (e) {
      if (!current || current.name !== step.name) scenario(step.name, step.vp.tag);
      check('scenario completed without exception', false, e.message);
      try {
        await shot(page, `${step.name}-onerror`);
      } catch {}
    }
    if (current && current.name === step.name) {
      const fresh = consoleErrors.filter((e) => !current.errors.includes(e));
      // pageerror is fatal; console.error is already mirrored into __spg.errors by debug.ts
      const fatal = fresh.filter((e) => e.startsWith('pageerror'));
      current.errors.push(...fresh);
      if (fatal.length) check('no uncaught page errors', false, fatal[0].slice(0, 200));
      current.ms = Date.now() - t0;
    }
    await ctx.close().catch(() => {});
  }
  await cleanup();
  writeReport();
  const fails = report.scenarios.filter((s) => s.status !== 'pass');
  console.log(`\n${report.summary.pass} pass, ${report.summary.fail} fail → ${join(OUT, 'index.html')}`);
  for (const f of fails) console.log(`  ✗ ${f.name}: ${f.checks.filter((c) => !c.ok).map((c) => c.label).join('; ')}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  try {
    writeReport();
  } catch {}
  process.exit(1);
});

// keep readdirSync import used for potential future run listing
void readdirSync;
