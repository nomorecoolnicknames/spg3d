import type { ScreenId, SpgSnapshot } from './types';
import { getState, goto, startRace, startBoss, setState, carColor, setSettings, getHUD } from '@/state/store';
import { viewport } from './Viewport';
import { TRACKS, TRACK_BY_ID } from '@/data/tracks';
import { audio } from './audio';
import { prepareEngineBank } from './audio/engineBank';
import type { EngineProfileName } from './audio/engine';
import { input } from './input/Input';
import { maybeStartBenchFromUrl, snapshotReport } from './perf';

/**
 * window.__spg — QA hooks used by qa/shots.mjs. Also honours URL params on boot:
 *   ?screen=race&track=shchyolkovo&car=supra&auto=1&laps=1&opp=5&ts=2
 *   ?screen=boss&auto=1
 */
export interface SpgDebug {
  ready: boolean;
  screen: ScreenId;
  autopilot: boolean;
  goto(screen: ScreenId, params?: Record<string, unknown>): void;
  setAutopilot(on: boolean): void;
  setTimeScale(k: number): void;
  /** max simulated seconds per frame (QA on slow renderers) */
  setMaxDt(k: number): void;
  snapshot(): SpgSnapshot;
  errors: string[];
  /** engine-specific knobs (set by scenes): e.g. { setBossHP(n), skipCountdown() } */
  knobs: Record<string, (...a: unknown[]) => unknown>;
}

declare global {
  interface Window {
    __spg: SpgDebug;
    __spgErrors: string[];
  }
}

export function installDebug(): void {
  const dbg: SpgDebug = {
    ready: false,
    get screen() {
      return getState().screen;
    },
    autopilot: new URLSearchParams(location.search).get('auto') === '1',
    goto(screen, params = {}) {
      const s = getState();
      const carId = (params.car as string) ?? s.save.selectedCar;
      const color = (params.color as string) ?? carColor(carId);
      if (screen === 'race') {
        const trackId = (params.track as string) ?? 'shchyolkovo';
        const track = TRACK_BY_ID[trackId] ?? TRACKS[0];
        startRace({
          trackId: track.id,
          carId,
          color,
          laps: Number(params.laps ?? track.laps),
          opponents: Number(params.opp ?? 5),
          difficulty: Number(params.difficulty ?? 1),
          career: params.career === true || params.career === '1',
          timeAttack: params.timeAttack === true || params.timeAttack === '1',
        });
      } else if (screen === 'boss') {
        startBoss({ carId, color });
      } else {
        if (params.car) setState({ garageCar: String(params.car) });
        goto(screen);
      }
    },
    setAutopilot(on) {
      dbg.autopilot = on;
    },
    setTimeScale(k) {
      viewport.timeScale = Math.max(0.1, Math.min(8, k));
    },
    setMaxDt(k) {
      viewport.maxDt = Math.max(0.02, Math.min(1, k));
    },
    snapshot() {
      const snap = viewport.snapshot();
      snap.screen = getState().screen;
      snap.hud = getHUD();
      return snap;
    },
    errors: window.__spgErrors ?? [],
    knobs: {
      audioUnlock: () => {
        audio.unlock();
        return audio.unlocked;
      },
      audioState: () => ({ unlocked: audio.unlocked, music: audio.music.state.playing, track: audio.music.state.track.title, time: audio.music.state.time }),
      audioPlay: (name: unknown) => audio.play(name as 'ui-click'),
      /** render an engine bank and report loudness per layer + the loop seam jump vs the typical sample step */
      engineBank: async (profile: unknown) => {
        const t0 = performance.now();
        const b = await prepareEngineBank((profile as EngineProfileName) ?? 'v8');
        const stat = (buf: AudioBuffer) => {
          const d = buf.getChannelData(0);
          let sq = 0, step = 0;
          for (let i = 1; i < d.length; i++) {
            sq += d[i] * d[i];
            step += Math.abs(d[i] - d[i - 1]);
          }
          return { rms: +Math.sqrt(sq / d.length).toFixed(3), seam: +(Math.abs(d[0] - d[d.length - 1]) / (step / d.length)).toFixed(2) };
        };
        return { ms: Math.round(performance.now() - t0), on: b.on.map(stat), off: b.off.map(stat) };
      },
      setTouch: (k: unknown, v: unknown) => input.setTouch(k as 'brake', v as never),
    },
  };
  window.__spg = dbg;
  const origError = console.error.bind(console);
  console.error = (...a: unknown[]) => {
    dbg.errors.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
    origError(...a);
  };
  const q = new URLSearchParams(location.search);
  const ts = Number(q.get('ts') ?? 1);
  if (ts > 0 && ts !== 1) viewport.timeScale = ts;
  const maxdt = Number(q.get('maxdt') ?? 0);
  if (maxdt > 0) viewport.maxDt = Math.min(1, maxdt);
  const quality = q.get('q');
  if (quality === 'low' || quality === 'medium' || quality === 'high') {
    setSettings({ quality, qualityAuto: false, shadows: quality === 'high', bloom: quality !== 'low', reflections: quality === 'high' });
  }
  const bloom = q.get('bloom');
  if (bloom === '0' || bloom === '1') setSettings({ bloom: bloom === '1' });
}

/** Called by App once assets are loaded and the menu is visible. Applies URL routing. */
export function debugBootRouting(): void {
  const dbg = window.__spg;
  dbg.ready = true;
  dbg.knobs.perfReport = () => snapshotReport();
  maybeStartBenchFromUrl();
  const q = new URLSearchParams(location.search);
  const screen = q.get('screen') as ScreenId | null;
  if (!screen || screen === 'menu' || screen === 'boot') return;
  const params: Record<string, unknown> = {};
  q.forEach((v, k) => {
    params[k] = v;
  });
  dbg.goto(screen, params);
}
