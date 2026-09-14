import { registerPlugin, Capacitor } from '@capacitor/core';
import { viewport } from './Viewport';
import { getState, startRace, goto, carColor } from '@/state/store';

/**
 * Performance instrumentation: device info, native thermal readings (Android),
 * a 90-second benchmark race and a copyable JSON report. Every sample is also
 * logged as `[SPG-PERF] {...}` so `adb logcat` can collect it from a real phone.
 */
export interface ThermalReading {
  batteryTempC: number | null;
  /** PowerManager.getCurrentThermalStatus(): 0 none … 6 shutdown */
  thermalStatus: number | null;
  /** PowerManager.getThermalHeadroom(10 s): 1.0 = throttling starts */
  headroom: number | null;
}

interface DeviceThermalPlugin {
  read(): Promise<ThermalReading>;
  setRefreshRate(o: { hz: number }): Promise<void>;
}

const DeviceThermal = registerPlugin<DeviceThermalPlugin>('DeviceThermal');

export async function readThermal(): Promise<ThermalReading> {
  if (Capacitor.getPlatform() !== 'android') return { batteryTempC: null, thermalStatus: null, headroom: null };
  try {
    return await DeviceThermal.read();
  } catch {
    return { batteryTempC: null, thermalStatus: null, headroom: null };
  }
}

/** Android: pin the window refresh rate to the frame cap (0 = system default). */
export function applyRefreshRate(fpsCap: number): void {
  if (Capacitor.getPlatform() !== 'android') return;
  DeviceThermal.setRefreshRate({ hz: fpsCap === 0 ? 0 : 60 }).catch(() => {});
}

export interface DeviceInfo {
  model: string;
  platform: string;
  gpu: string;
  dpr: number;
  screen: string;
  cores: number;
  memoryGb: number | null;
  webview: string;
}

let deviceInfo: DeviceInfo | null = null;

export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (deviceInfo) return deviceInfo;
  const gl = viewport.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  let model = '';
  const uaData = (navigator as unknown as { userAgentData?: { getHighEntropyValues(k: string[]): Promise<{ model?: string; platformVersion?: string }> } }).userAgentData;
  if (uaData) {
    try {
      const v = await uaData.getHighEntropyValues(['model', 'platformVersion']);
      model = v.model ?? '';
    } catch {
      /* not available */
    }
  }
  const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '';
  deviceInfo = {
    model: model || navigator.userAgent.slice(0, 80),
    platform: Capacitor.getPlatform(),
    gpu,
    dpr: window.devicePixelRatio || 1,
    screen: `${screen.width}x${screen.height}`,
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    webview: chrome,
  };
  return deviceInfo;
}

export interface PerfSample {
  t: number;
  screen: string;
  fps: number;
  frameP50: number;
  frameP95: number;
  cpuP50: number;
  cpuP95: number;
  hitches: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  resScale: number;
  buffer: string;
  cap: number;
  heapMb: number | null;
  thermal: ThermalReading;
}

export async function sample(): Promise<PerfSample> {
  const s = viewport.stats;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    t: Math.round(performance.now() / 100) / 10,
    screen: getState().screen,
    fps: Math.round(s.fps * 10) / 10,
    frameP50: Math.round(s.frameP50 * 10) / 10,
    frameP95: Math.round(s.frameP95 * 10) / 10,
    cpuP50: Math.round(s.cpuP50 * 10) / 10,
    cpuP95: Math.round(s.cpuP95 * 10) / 10,
    hitches: s.hitches,
    drawCalls: s.drawCalls,
    triangles: s.triangles,
    textures: s.textures,
    geometries: s.geometries,
    resScale: Math.round(s.resScale * 100) / 100,
    buffer: `${s.bufferW}x${s.bufferH}`,
    cap: s.cap,
    heapMb: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
    thermal: await readThermal(),
  };
}

// ───────────────────────────────────────────── benchmark

export interface BenchState {
  running: boolean;
  track: string;
  startedAt: number;
  duration: number;
  samples: PerfSample[];
  report: string | null;
}

export const bench: BenchState = { running: false, track: 'neon', startedAt: 0, duration: 90, samples: [], report: null };
const benchListeners = new Set<() => void>();
export function onBench(cb: () => void): () => void {
  benchListeners.add(cb);
  return () => benchListeners.delete(cb);
}
function emitBench(): void {
  for (const l of benchListeners) l();
}

let benchTimer = 0;

/** Autopilot race on a track for `duration` seconds, sampling every 2 s, then builds a report. */
export function startBench(track = 'neon', duration = 90): void {
  stopBenchTimer();
  const s = getState();
  window.__spg.autopilot = true;
  bench.running = true;
  bench.track = track;
  bench.duration = duration;
  bench.samples = [];
  bench.report = null;
  bench.startedAt = performance.now();
  startRace({ trackId: track, carId: s.save.selectedCar, color: carColor(s.save.selectedCar), laps: 5, opponents: 5, difficulty: 1, career: false });
  emitBench();
  benchTimer = window.setInterval(async () => {
    const sm = await sample();
    bench.samples.push(sm);
    console.log('[SPG-PERF]', JSON.stringify(sm));
    emitBench();
    if (performance.now() - bench.startedAt >= duration * 1000) await finishBench();
  }, 2000);
}

function stopBenchTimer(): void {
  if (benchTimer) window.clearInterval(benchTimer);
  benchTimer = 0;
}

async function finishBench(): Promise<void> {
  stopBenchTimer();
  window.__spg.autopilot = false;
  bench.running = false;
  bench.report = await buildReport(bench.samples);
  console.log('[SPG-PERF-REPORT]', bench.report);
  emitBench();
  goto('settings');
}

export function cancelBench(): void {
  stopBenchTimer();
  window.__spg.autopilot = false;
  bench.running = false;
  emitBench();
}

function pct(values: number[], q: number): number {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0;
}

export async function buildReport(samples: PerfSample[]): Promise<string> {
  const dev = await getDeviceInfo();
  const warm = samples.filter((s) => s.screen === 'race').slice(2); // skip loading + countdown
  const temps = warm.map((s) => s.thermal.batteryTempC).filter((v): v is number => v != null);
  const summary = {
    fpsAvg: Math.round((warm.reduce((a, s) => a + s.fps, 0) / Math.max(1, warm.length)) * 10) / 10,
    fpsP5: pct(warm.map((s) => s.fps), 0.05),
    frameP95Max: Math.max(0, ...warm.map((s) => s.frameP95)),
    cpuP95Avg: Math.round((warm.reduce((a, s) => a + s.cpuP95, 0) / Math.max(1, warm.length)) * 10) / 10,
    drawCallsMax: Math.max(0, ...warm.map((s) => s.drawCalls)),
    trianglesMax: Math.max(0, ...warm.map((s) => s.triangles)),
    hitchesMax: Math.max(0, ...warm.map((s) => s.hitches)),
    resScaleMin: Math.min(1, ...warm.map((s) => s.resScale)),
    batteryTempStart: temps[0] ?? null,
    batteryTempEnd: temps[temps.length - 1] ?? null,
    thermalStatusMax: Math.max(-1, ...warm.map((s) => s.thermal.thermalStatus ?? -1)),
  };
  const q = getState().save.settings;
  return JSON.stringify({ app: 'spg3d', build: __BUILD_ID__, date: new Date().toISOString(), device: dev, quality: { level: q.quality, fpsCap: q.fpsCap, dynamicRes: q.dynamicRes }, track: bench.track, summary, samples }, null, 1);
}

export async function snapshotReport(): Promise<string> {
  return buildReport([await sample()]);
}

/** URL entry: ?bench=neon[&dur=90] starts a benchmark right after boot (used by qa/device-run.sh). */
export function maybeStartBenchFromUrl(): void {
  const q = new URLSearchParams(location.search);
  const t = q.get('bench');
  if (t) startBench(t, Number(q.get('dur') ?? 90));
}
