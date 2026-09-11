import type { SfxName } from './api';
import { distortionCurve, env, filter, noise, osc, semitones } from './context';

type Gen = (ctx: AudioContext, out: AudioNode, t: number, pr: number) => void;

/** tone helper: type, freq, peak, attack, decay, optional freq glide target */
function tone(ctx: AudioContext, out: AudioNode, t: number, type: OscillatorType, f: number, peak: number, a: number, d: number, glideTo?: number, glideT?: number): void {
  const g = env(ctx, out, peak, a, d, t);
  const o = osc(ctx, type, f, t, t + a + d + 0.05);
  if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + (glideT ?? a + d));
  o.connect(g);
}

function burst(ctx: AudioContext, out: AudioNode, t: number, peak: number, a: number, d: number, ftype: BiquadFilterType, f: number, q = 1, fTo?: number, kind: 'white' | 'pink' = 'white'): void {
  const g = env(ctx, out, peak, a, d, t);
  const fl = filter(ctx, ftype, f, q);
  if (fTo !== undefined) fl.frequency.exponentialRampToValueAtTime(Math.max(10, fTo), t + a + d);
  const n = noise(ctx, t, t + a + d + 0.05, kind);
  n.connect(fl);
  fl.connect(g);
}

function distorted(ctx: AudioContext, out: AudioNode, amount: number): WaveShaperNode {
  const s = ctx.createWaveShaper();
  s.curve = distortionCurve(amount);
  s.oversample = '2x';
  s.connect(out);
  return s;
}

function chord(ctx: AudioContext, out: AudioNode, t: number, notes: number[], type: OscillatorType, peak: number, a: number, d: number, stagger = 0): void {
  notes.forEach((f, i) => tone(ctx, out, t + i * stagger, type, f, peak, a, d));
}

const N = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export const SFX: Record<SfxName, Gen> = {
  'ui-hover': (c, o, t, p) => tone(c, o, t, 'sine', 1400 * p, 0.05, 0.003, 0.05),
  'ui-click': (c, o, t, p) => {
    tone(c, o, t, 'triangle', 900 * p, 0.12, 0.002, 0.06, 500 * p, 0.05);
    burst(c, o, t, 0.06, 0.001, 0.03, 'highpass', 4000);
  },
  'ui-confirm': (c, o, t, p) => {
    tone(c, o, t, 'triangle', N(76) * p, 0.14, 0.004, 0.12);
    tone(c, o, t + 0.07, 'triangle', N(83) * p, 0.14, 0.004, 0.22);
  },
  'ui-back': (c, o, t, p) => {
    tone(c, o, t, 'triangle', N(74) * p, 0.12, 0.004, 0.1);
    tone(c, o, t + 0.06, 'triangle', N(67) * p, 0.1, 0.004, 0.18);
  },
  'ui-buy': (c, o, t, p) => {
    // cash register: click + coin ring + shimmer
    burst(c, o, t, 0.25, 0.001, 0.05, 'bandpass', 3000, 2);
    tone(c, o, t + 0.05, 'sine', 2637 * p, 0.16, 0.003, 0.35);
    tone(c, o, t + 0.05, 'sine', 3951 * p, 0.1, 0.003, 0.4);
    tone(c, o, t + 0.16, 'sine', 3136 * p, 0.12, 0.003, 0.5);
  },
  'ui-error': (c, o, t, p) => {
    tone(c, o, t, 'square', 220 * p, 0.08, 0.004, 0.12);
    tone(c, o, t + 0.13, 'square', 180 * p, 0.08, 0.004, 0.18);
  },
  'count-beep': (c, o, t, p) => tone(c, o, t, 'square', 440 * p, 0.16, 0.004, 0.16),
  'count-go': (c, o, t, p) => {
    tone(c, o, t, 'square', 880 * p, 0.18, 0.004, 0.6);
    tone(c, o, t, 'sine', 1760 * p, 0.06, 0.004, 0.5);
  },
  lap: (c, o, t, p) => {
    tone(c, o, t, 'triangle', N(81) * p, 0.16, 0.004, 0.18);
    tone(c, o, t + 0.1, 'triangle', N(88) * p, 0.16, 0.004, 0.35);
  },
  'best-lap': (c, o, t, p) => chord(c, o, t, [N(76), N(80), N(83), N(88), N(92)].map((f) => f * p), 'triangle', 0.13, 0.004, 0.45, 0.07),
  finish: (c, o, t, p) => {
    chord(c, o, t, [N(64), N(68), N(71), N(76)].map((f) => f * p), 'sawtooth', 0.09, 0.01, 0.9);
    chord(c, o, t + 0.02, [N(88), N(92), N(95)].map((f) => f * p), 'sine', 0.07, 0.01, 1.2, 0.05);
    burst(c, o, t, 0.12, 0.01, 0.8, 'highpass', 5000, 0.7, 9000, 'pink');
  },
  overtake: (c, o, t) => burst(c, o, t, 0.22, 0.12, 0.25, 'bandpass', 400, 2, 3000),
  'drift-score': (c, o, t, p) => {
    for (let i = 0; i < 5; i++) tone(c, o, t + i * 0.045, 'sine', (2093 + i * 260) * p, 0.1, 0.002, 0.14);
  },
  'nitro-start': (c, o, t, p) => {
    burst(c, o, t, 0.3, 0.03, 0.5, 'highpass', 800, 0.8, 5000);
    tone(c, o, t, 'sawtooth', 120 * p, 0.12, 0.02, 0.4, 480 * p, 0.35);
  },
  'nitro-end': (c, o, t) => burst(c, o, t, 0.18, 0.01, 0.3, 'lowpass', 4000, 0.8, 300),
  'hit-wall': (c, o, t, p) => {
    burst(c, o, t, 0.5, 0.002, 0.16, 'lowpass', 2500, 0.8, 200);
    tone(c, o, t, 'sine', 130 * p, 0.45, 0.002, 0.16, 40 * p, 0.14);
    burst(c, o, t, 0.2, 0.001, 0.08, 'bandpass', 3500, 3);
  },
  'hit-car': (c, o, t, p) => {
    burst(c, o, t, 0.4, 0.002, 0.14, 'lowpass', 1800, 0.8, 300);
    tone(c, o, t, 'triangle', 180 * p, 0.35, 0.002, 0.12, 60 * p, 0.1);
  },
  'gear-shift': (c, o, t) => {
    burst(c, o, t, 0.12, 0.001, 0.04, 'bandpass', 1800, 2);
    tone(c, o, t, 'square', 90, 0.08, 0.002, 0.05);
  },
  backfire: (c, o, t) => {
    burst(c, o, t, 0.5, 0.002, 0.07, 'bandpass', 700, 1.2);
    burst(c, o, t + 0.09, 0.3, 0.002, 0.05, 'bandpass', 900, 1.2);
  },
  'rocket-launch': (c, o, t, p) => {
    burst(c, o, t, 0.4, 0.02, 0.5, 'bandpass', 600, 1, 2400, 'pink');
    tone(c, o, t, 'sine', 90 * p, 0.35, 0.005, 0.25, 35 * p, 0.25);
  },
  'rocket-hit': (c, o, t, p) => {
    burst(c, o, t, 0.6, 0.003, 0.4, 'lowpass', 4000, 0.8, 150);
    tone(c, o, t, 'sine', 110 * p, 0.5, 0.003, 0.4, 28 * p, 0.35);
    burst(c, o, t + 0.02, 0.2, 0.002, 0.25, 'highpass', 3000, 0.8);
  },
  explosion: (c, o, t, p) => {
    const d = distorted(c, o, 0.5);
    burst(c, d, t, 0.7, 0.004, 0.7, 'lowpass', 5000, 0.7, 120);
    tone(c, o, t, 'sine', 120 * p, 0.6, 0.004, 0.55, 25 * p, 0.5);
    for (let i = 0; i < 4; i++) burst(c, o, t + 0.05 + i * 0.09, 0.14, 0.002, 0.06, 'bandpass', 1500 + Math.random() * 3000, 2);
  },
  'explosion-big': (c, o, t, p) => {
    const d = distorted(c, o, 0.6);
    burst(c, d, t, 0.85, 0.006, 1.6, 'lowpass', 6000, 0.7, 80);
    tone(c, o, t, 'sine', 100 * p, 0.7, 0.004, 1.2, 20 * p, 1.0);
    burst(c, o, t + 0.3, 0.3, 0.2, 1.8, 'lowpass', 300, 0.5, 60, 'pink');
    for (let i = 0; i < 8; i++) burst(c, o, t + 0.1 + i * 0.13, 0.12, 0.002, 0.08, 'bandpass', 1200 + Math.random() * 4000, 2);
  },
  'mech-step': (c, o, t, p) => {
    tone(c, o, t, 'sine', 55 * p, 0.7, 0.003, 0.35, 22 * p, 0.3);
    burst(c, o, t, 0.25, 0.002, 0.12, 'lowpass', 900, 0.8, 200);
    burst(c, o, t + 0.01, 0.12, 0.001, 0.2, 'bandpass', 2600, 12);
    tone(c, o, t + 0.01, 'triangle', 1320 * p, 0.06, 0.001, 0.25);
  },
  'mech-roar': (c, o, t, p) => {
    const d = distorted(c, o, 0.75);
    const f1 = filter(c, 'bandpass', 520, 4);
    const f2 = filter(c, 'bandpass', 1100, 4);
    const f3 = filter(c, 'bandpass', 2400, 5);
    const g = env(c, d, 0.5, 0.06, 1.15, t);
    f1.connect(g);
    f2.connect(g);
    f3.connect(g);
    for (const det of [0, 7, -9]) {
      const src = osc(c, 'sawtooth', 68 * p, t, t + 1.3);
      src.detune.value = det;
      src.frequency.setValueAtTime(68 * p, t);
      src.frequency.exponentialRampToValueAtTime(115 * p, t + 0.35);
      src.frequency.exponentialRampToValueAtTime(52 * p, t + 1.2);
      src.connect(f1);
      src.connect(f2);
      src.connect(f3);
    }
    f1.frequency.setValueAtTime(400, t);
    f1.frequency.exponentialRampToValueAtTime(800, t + 0.5);
    f2.frequency.setValueAtTime(900, t);
    f2.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    burst(c, o, t, 0.2, 0.05, 1.0, 'lowpass', 400, 0.7, 120, 'pink');
  },
  'laser-charge': (c, o, t, p) => {
    tone(c, o, t, 'sine', 200 * p, 0.2, 0.05, 0.9, 1800 * p, 0.9);
    tone(c, o, t, 'triangle', 401 * p, 0.08, 0.05, 0.9, 3600 * p, 0.9);
    burst(c, o, t, 0.12, 0.3, 0.6, 'bandpass', 800, 2, 5000);
  },
  'laser-fire': (c, o, t, p) => {
    const d = distorted(c, o, 0.8);
    const g = env(c, d, 0.35, 0.01, 0.75, t);
    const trem = c.createGain();
    trem.gain.value = 0.5;
    const lfo = osc(c, 'square', 28, t, t + 0.9);
    const lg = c.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg);
    lg.connect(trem.gain);
    trem.connect(g);
    const s1 = osc(c, 'sawtooth', 220 * p, t, t + 0.9);
    const s2 = osc(c, 'square', 331 * p, t, t + 0.9);
    s1.connect(trem);
    s2.connect(trem);
    burst(c, o, t, 0.15, 0.005, 0.5, 'highpass', 3000, 0.8);
  },
  slam: (c, o, t, p) => {
    tone(c, o, t, 'sine', 70 * p, 0.9, 0.004, 0.9, 18 * p, 0.7);
    const d = distorted(c, o, 0.5);
    burst(c, d, t, 0.5, 0.004, 0.5, 'lowpass', 1500, 0.8, 90);
    for (let i = 0; i < 6; i++) burst(c, o, t + 0.08 + i * 0.07, 0.1, 0.002, 0.06, 'bandpass', 800 + Math.random() * 2500, 3);
  },
  'player-hit': (c, o, t, p) => {
    burst(c, o, t, 0.4, 0.002, 0.12, 'lowpass', 1200, 0.8, 200);
    tone(c, o, t, 'sine', 160 * p, 0.35, 0.002, 0.1, 60 * p, 0.09);
    tone(c, o, t + 0.02, 'sine', 2200 * p, 0.07, 0.002, 0.6);
  },
  'player-dead': (c, o, t, p) => {
    [N(67), N(63), N(60), N(55)].forEach((f, i) => tone(c, o, t + i * 0.22, 'sawtooth', f * p, 0.14, 0.01, 0.3, f * p * 0.94, 0.3));
    burst(c, o, t, 0.2, 0.05, 1.2, 'lowpass', 600, 0.7, 80, 'pink');
  },
  'zombie-groan': (c, o, t, p) => {
    const base = (75 + Math.random() * 40) * p;
    const f1 = filter(c, 'bandpass', 500 + Math.random() * 200, 5);
    const f2 = filter(c, 'bandpass', 1200 + Math.random() * 400, 5);
    const g = env(c, o, 0.22, 0.12, 0.7, t);
    f1.connect(g);
    f2.connect(g);
    const s = osc(c, 'sawtooth', base, t, t + 0.9);
    s.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.5), t + 0.8);
    s.connect(f1);
    s.connect(f2);
    f1.frequency.linearRampToValueAtTime(350, t + 0.8);
  },
  'zombie-dead': (c, o, t) => {
    burst(c, o, t, 0.35, 0.003, 0.18, 'lowpass', 1600, 0.8, 250);
    burst(c, o, t + 0.05, 0.2, 0.02, 0.25, 'bandpass', 500, 1.5, 150, 'pink');
    tone(c, o, t, 'sawtooth', 140, 0.12, 0.003, 0.2, 60, 0.2);
  },
  pickup: (c, o, t, p) => chord(c, o, t, [N(84), N(88), N(91), N(96)].map((f) => f * p), 'sine', 0.13, 0.003, 0.3, 0.05),
  'core-open': (c, o, t, p) => {
    burst(c, o, t, 0.25, 0.02, 0.6, 'bandpass', 3000, 3, 6000);
    tone(c, o, t + 0.1, 'triangle', 300 * p, 0.14, 0.05, 0.6, 1200 * p, 0.6);
    burst(c, o, t, 0.15, 0.001, 0.1, 'bandpass', 2400, 10);
  },
  'boss-phase': (c, o, t, p) => {
    for (let i = 0; i < 3; i++) {
      tone(c, o, t + i * 0.2, 'square', 440 * p, 0.14, 0.005, 0.12);
      tone(c, o, t + i * 0.2, 'square', 466 * p, 0.14, 0.005, 0.12);
    }
    tone(c, o, t + 0.65, 'sawtooth', 110 * p, 0.2, 0.01, 0.8, 55 * p, 0.8);
  },
  'boss-dead': (c, o, t, p) => {
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.28 + Math.random() * 0.08;
      const d = distorted(c, o, 0.5);
      burst(c, d, tt, 0.55, 0.004, 0.5, 'lowpass', 4000, 0.7, 120);
      tone(c, o, tt, 'sine', (130 - i * 12) * p, 0.5, 0.004, 0.5, 25 * p, 0.45);
    }
    const d = distorted(c, o, 0.6);
    burst(c, d, t + 1.5, 0.9, 0.006, 2.0, 'lowpass', 6000, 0.7, 60);
    tone(c, o, t + 1.5, 'sine', 90 * p, 0.8, 0.004, 1.6, 18 * p, 1.4);
  },
};

export function pitchRatio(st: number | undefined): number {
  return st ? semitones(st) : 1;
}
