/**
 * Shared AudioContext, buses and small synthesis helpers.
 * Everything is lazily created; before `unlock()` the context may be suspended,
 * and every helper tolerates a missing context.
 */
export interface Buses {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  engine: GainNode;
  /** compressor on master to keep peaks sane */
  comp: DynamicsCompressorNode;
}

let buses: Buses | null = null;
let unlockedFlag = false;
const unlockListeners: (() => void)[] = [];

function createBuses(): Buses | null {
  const Ctor: typeof AudioContext | undefined =
    typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(ctx.destination);
    const music = ctx.createGain();
    const sfx = ctx.createGain();
    const engine = ctx.createGain();
    music.gain.value = 0.45;
    sfx.gain.value = 0.8;
    engine.gain.value = 0.7;
    music.connect(master);
    sfx.connect(master);
    engine.connect(master);
    return { ctx, master, music, sfx, engine, comp };
  } catch {
    return null;
  }
}

/** Returns the buses, creating the context on first call (may still be suspended). */
export function getBuses(): Buses | null {
  if (!buses) buses = createBuses();
  return buses;
}

/** Buses only if the context is running (for one-shots we skip when not). */
export function liveBuses(): Buses | null {
  const b = getBuses();
  if (!b || b.ctx.state !== 'running') return null;
  return b;
}

export function isUnlocked(): boolean {
  return unlockedFlag && !!buses && buses.ctx.state === 'running';
}

export function unlock(): void {
  const b = getBuses();
  if (!b) return;
  if (b.ctx.state === 'suspended') {
    void b.ctx.resume().then(() => {
      if (b.ctx.state === 'running') fireUnlocked();
    });
  } else if (b.ctx.state === 'running') fireUnlocked();
}

function fireUnlocked(): void {
  if (unlockedFlag) return;
  unlockedFlag = true;
  for (const l of unlockListeners.splice(0)) l();
}

export function onUnlocked(cb: () => void): void {
  if (isUnlocked()) cb();
  else unlockListeners.push(cb);
}

if (typeof window !== 'undefined') {
  const once = (): void => {
    unlock();
    if (isUnlocked() || (buses && buses.ctx.state === 'running')) {
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
      window.removeEventListener('touchstart', once);
    }
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
  window.addEventListener('touchstart', once);
}

// ---------- helpers ----------

const noiseCache = new Map<string, AudioBuffer>();

/** 2-second looping white noise buffer (cached per context). */
export function noiseBuffer(ctx: AudioContext, kind: 'white' | 'pink' = 'white'): AudioBuffer {
  const key = kind;
  const cached = noiseCache.get(key);
  if (cached && cached.sampleRate === ctx.sampleRate) return cached;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else {
    // Paul Kellet pink noise
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  noiseCache.set(key, buf);
  return buf;
}

const shaperCache = new Map<number, Float32Array<ArrayBuffer>>();

/** Soft-clip curve for WaveShaper, amount 0..1. */
export function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = Math.round(amount * 100);
  const c = shaperCache.get(k);
  if (c) return c;
  const n = 1024;
  const curve = new Float32Array(n);
  const a = 1 + k * 0.6;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * a) / Math.tanh(a);
  }
  shaperCache.set(k, curve);
  return curve;
}

export function semitones(st: number): number {
  return Math.pow(2, st / 12);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Percussive envelope: attack then exponential decay; returns the gain node. */
export function env(ctx: AudioContext, out: AudioNode, peak: number, attack: number, decay: number, start = ctx.currentTime): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  g.connect(out);
  return g;
}

export function osc(ctx: AudioContext, type: OscillatorType, freq: number, start: number, stop: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  o.start(start);
  o.stop(stop);
  return o;
}

export function noise(ctx: AudioContext, start: number, stop: number, kind: 'white' | 'pink' = 'white'): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, kind);
  s.loop = true;
  s.start(start, Math.random() * 1.5);
  s.stop(stop);
  return s;
}

export function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Panner (stereo) + gain wrapper used by one-shots. */
export function panGain(ctx: AudioContext, out: AudioNode, pan: number, gain: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = gain;
  if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(out);
  } else g.connect(out);
  return g;
}
