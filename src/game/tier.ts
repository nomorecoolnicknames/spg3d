import { viewport } from './Viewport';
import { getState, setSettings, toast } from '@/state/store';
import type { Settings } from '@/state/save';
import { S } from '@/data/strings';
import { classifyGpu } from './gpuTier';

/**
 * Automatic quality tier (PLAN_V3 stage 4). Once per tier-logic version the GPU string decides a
 * starting tier; while playing, a watchdog drops one tier if the frame rate stays low even at the
 * minimum dynamic resolution. Choosing a tier by hand in Settings switches the automation off.
 */
export type Tier = Settings['quality'];
export { classifyGpu };

/** bump when the classification changes so saved automatic choices are re-evaluated */
export const TIER_VERSION = 1;

export function tierSettings(t: Tier): Partial<Settings> {
  return { quality: t, shadows: t === 'high', bloom: t !== 'low', reflections: t === 'high' };
}

export function gpuName(): string {
  const gl = viewport.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/** called once after the viewport exists */
export function autoTierAtBoot(): void {
  const s = getState().save.settings;
  if (!s.qualityAuto || s.tierVersion === TIER_VERSION) return;
  const touch = getState().isTouch;
  const tier = classifyGpu(gpuName(), touch);
  setSettings({ ...tierSettings(tier), tierVersion: TIER_VERSION });
  console.info(`[tier] ${gpuName()} → ${tier}`);
}

let strikes = 0;
let timer = 0;

/** in races/boss: 20 s at minimum resolution below 75 % of the cap → one tier down (automatic mode only) */
export function startTierWatchdog(): void {
  if (timer) return;
  timer = window.setInterval(() => {
    const st = getState();
    const s = st.save.settings;
    if (!s.qualityAuto || (st.screen !== 'race' && st.screen !== 'boss') || st.paused || window.__spg?.autopilot) {
      strikes = 0;
      return;
    }
    const f = viewport.stats;
    const cap = f.cap > 0 ? f.cap : 60;
    const atFloor = f.resScale <= (s.quality === 'high' ? 0.71 : 0.56);
    strikes = atFloor && f.fps > 0 && f.fps < cap * 0.75 ? strikes + 1 : Math.max(0, strikes - 1);
    if (strikes >= 10 && s.quality !== 'low') {
      strikes = 0;
      const next: Tier = s.quality === 'high' ? 'medium' : 'low';
      setSettings(tierSettings(next));
      toast(`${S.settings.tierDropped} ${S.settings.qualityNames[next]}`, 'info');
    }
  }, 2000);
}
