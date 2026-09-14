import type { EngineState, EngineVoice } from './api';
import { clamp01, filter, noiseBuffer } from './context';
import { ENGINE_PROFILES, SynthEngineVoice, type EngineProfileName } from './engine';

/**
 * Engine sound without a live synthesizer. The synth voice from ./engine.ts is rendered once per
 * profile through OfflineAudioContext at four rpm points, on and off throttle, into seamless loops.
 * At runtime a voice only crossfades the two bracketing loops and bends their playbackRate —
 * 2–4 buffer sources instead of ~20 oscillators, filters and a 2× oversampled waveshaper per car.
 */
const RATE = 32000;
const LOOP_S = 1.2;
const XFADE_S = 0.15;
const WARM_S = 0.5;
const LAYER_RPM = [0.05, 0.34, 0.64, 0.95];
/** AI voices that may sound at the same time (nearest first) */
const AI_AUDIBLE = 2;

export interface EngineBank {
  profile: EngineProfileName;
  on: AudioBuffer[];
  off: AudioBuffer[];
}

interface FxBank {
  screech: AudioBuffer;
  scrape: AudioBuffer;
  wind: AudioBuffer;
  nitro: AudioBuffer;
}

function f0(profile: EngineProfileName, rpm: number): number {
  const p = ENGINE_PROFILES[profile];
  return p.idleHz + (p.redlineHz - p.idleHz) * Math.pow(rpm, 1.15);
}

/** rendered r = [warm][loop][xfade] → seamless loop: the tail after the loop is faded into the head */
function loopify(r: Float32Array, start: number, len: number, xf: number): AudioBuffer {
  const out = new AudioBuffer({ length: len, sampleRate: RATE, numberOfChannels: 1 });
  const d = out.getChannelData(0);
  d.set(r.subarray(start, start + len));
  for (let t = 0; t < xf; t++) {
    const w = t / xf;
    d[t] = r[start + t] * Math.sqrt(w) + r[start + len + t] * Math.sqrt(1 - w);
  }
  return out;
}

async function renderLayer(profile: EngineProfileName, rpm: number, throttle: number): Promise<AudioBuffer> {
  const warm = Math.round(WARM_S * RATE), len = Math.round(LOOP_S * RATE), xf = Math.round(XFADE_S * RATE);
  const oc = new OfflineAudioContext(1, warm + len + xf, RATE);
  const v = new SynthEngineVoice(oc, oc.destination, profile, false);
  v.update({ rpm, throttle, gear: 3, speed: 0, nitro: false, slip: 0, scraping: false, distance: 0, turbo: 0 });
  const buf = await oc.startRendering();
  return loopify(buf.getChannelData(0), warm, len, xf);
}

async function renderFx(): Promise<FxBank> {
  const len = Math.round(LOOP_S * RATE), xf = Math.round(XFADE_S * RATE);
  const oc = new OfflineAudioContext(4, len + xf, RATE);
  const merge = oc.createChannelMerger(4);
  merge.connect(oc.destination);
  const src = (kind: 'white' | 'pink') => {
    const s = oc.createBufferSource();
    s.buffer = noiseBuffer(oc, kind);
    s.loop = true;
    s.start(0);
    return s;
  };
  // screech: two resonant bandpasses (centre 1600 Hz; pitch follows slip through playbackRate)
  const s0 = src('white');
  const b1 = filter(oc, 'bandpass', 1600, 9), b2 = filter(oc, 'bandpass', 2400, 5), g0 = oc.createGain();
  g0.gain.value = 6;
  s0.connect(b1).connect(b2).connect(g0).connect(merge, 0, 0);
  // scrape: metallic double resonance
  const s1 = src('white');
  const c1 = filter(oc, 'bandpass', 900, 14), c2 = filter(oc, 'bandpass', 3100, 18), g1 = oc.createGain();
  g1.gain.value = 5;
  s1.connect(c1).connect(g1);
  s1.connect(c2).connect(g1);
  g1.connect(merge, 0, 1);
  // wind
  src('pink').connect(filter(oc, 'lowpass', 700, 0.5)).connect(merge, 0, 2);
  // nitro hiss
  src('white').connect(filter(oc, 'highpass', 2500, 0.8)).connect(merge, 0, 3);
  const buf = await oc.startRendering();
  const ch = (i: number) => loopify(buf.getChannelData(i), 0, len, xf);
  return { screech: ch(0), scrape: ch(1), wind: ch(2), nitro: ch(3) };
}

const banks = new Map<EngineProfileName, Promise<EngineBank>>();
const ready = new Map<EngineProfileName, EngineBank>();
let fxPromise: Promise<FxBank> | null = null;
let fxReady: FxBank | null = null;

export function prepareEngineBank(profile: EngineProfileName): Promise<EngineBank> {
  let p = banks.get(profile);
  if (!p) {
    const t0 = performance.now();
    if (!fxPromise) fxPromise = renderFx().then((fx) => (fxReady = fx));
    p = Promise.all([
      Promise.all(LAYER_RPM.map((r) => renderLayer(profile, r, 1))),
      Promise.all(LAYER_RPM.map((r) => renderLayer(profile, r, 0.08))),
      fxPromise,
    ]).then(([on, off]) => {
      const bank = { profile, on, off };
      ready.set(profile, bank);
      console.info(`[audio] engine bank ${profile} rendered in ${Math.round(performance.now() - t0)} ms`);
      return bank;
    });
    banks.set(profile, p);
  }
  return p;
}

export function engineBankReady(profile: EngineProfileName): EngineBank | undefined {
  return ready.get(profile);
}

// ───────────────────────────────────────────── runtime voice

interface Layer {
  buf: AudioBuffer;
  rpm: number;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  quietSince: number;
  lastGain: number;
  lastRate: number;
}

interface Loop {
  buf: AudioBuffer;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  quietSince: number;
  lastGain: number;
  lastRate: number;
}

/** set an AudioParam only when it actually moved — avoids thousands of automation events a second */
function glide(param: AudioParam, value: number, last: number, t: number, tc: number): number {
  if (Math.abs(value - last) <= Math.max(0.002, Math.abs(last) * 0.01)) return last;
  param.setTargetAtTime(value, t, tc);
  return value;
}

const voices = new Set<BankEngineVoice>();
let rankStamp = 0;

function rankVoices(): void {
  const now = performance.now();
  if (now - rankStamp < 60) return;
  rankStamp = now;
  const ai = [...voices].filter((v) => !v.player).sort((a, b) => a.distance - b.distance);
  ai.forEach((v, i) => (v.audible = i < AI_AUDIBLE && v.distance < 0.95));
}

export class BankEngineVoice implements EngineVoice {
  distance = 0;
  audible = true;
  private out: GainNode;
  private muffle: BiquadFilterNode | null = null;
  private on: Layer[];
  private off: Layer[];
  private fx: Record<keyof FxBank, Loop> | null = null;
  private turbo: { osc: OscillatorNode; gain: GainNode } | null = null;
  private lastOut = -1;
  private lastMuffle = -1;
  private lastTurbo = -1;
  private lastGear = 1;
  private lastThrottle = 0;
  private lastRpm = 0;
  private shiftDrop = 0;
  private thrS = 0;
  private nextBackfire = 0;
  private stopped = false;

  constructor(
    private ctx: AudioContext,
    bus: AudioNode,
    private bank: EngineBank,
    readonly player: boolean,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    if (player) this.out.connect(bus);
    else {
      this.muffle = filter(ctx, 'lowpass', 20000, 0.7);
      this.out.connect(this.muffle).connect(bus);
    }
    const mk = (buf: AudioBuffer, rpm: number): Layer => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.out);
      return { buf, rpm, gain, src: null, quietSince: 0, lastGain: 0, lastRate: 1 };
    };
    this.on = bank.on.map((b, i) => mk(b, LAYER_RPM[i]));
    // AI cars are heard from outside — the on-throttle layers are enough
    this.off = player ? bank.off.map((b, i) => mk(b, LAYER_RPM[i])) : [];
    if (player && fxReady) {
      const loop = (buf: AudioBuffer): Loop => {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.out);
        return { buf, gain, src: null, quietSince: 0, lastGain: 0, lastRate: 1 };
      };
      this.fx = { screech: loop(fxReady.screech), scrape: loop(fxReady.scrape), wind: loop(fxReady.wind), nitro: loop(fxReady.nitro) };
    }
    if (player && ENGINE_PROFILES[bank.profile].turbo) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.out);
      osc.start();
      this.turbo = { osc, gain };
    }
    voices.add(this);
  }

  /** start a looping source when its gain becomes audible, stop it after 0.4 s of silence */
  private drive(l: Layer | Loop, gain: number, rate: number, t: number): void {
    if (gain > 0.004) {
      if (!l.src) {
        const s = this.ctx.createBufferSource();
        s.buffer = l.buf;
        s.loop = true;
        s.playbackRate.value = rate;
        l.lastRate = rate;
        s.connect(l.gain);
        s.start(t, Math.random() * LOOP_S);
        l.src = s;
      }
      l.quietSince = t;
    } else if (l.src && t - l.quietSince > 0.4) {
      l.src.stop();
      l.src.disconnect();
      l.src = null;
    }
    l.lastGain = glide(l.gain.gain, gain, l.lastGain, t, 0.03);
    if (l.src) l.lastRate = glide(l.src.playbackRate, rate, l.lastRate, t, 0.03);
  }

  update(s: EngineState): void {
    if (this.stopped) return;
    const t = this.ctx.currentTime;
    const p = ENGINE_PROFILES[this.bank.profile];
    const rpm = clamp01(s.rpm);
    const thr = clamp01(s.throttle);
    this.distance = clamp01(s.distance ?? 0);
    rankVoices();

    if (s.gear !== this.lastGear && s.speed > 2) {
      this.shiftDrop = 0.18;
      this.lastGear = s.gear;
    }
    if (this.player && this.lastThrottle > 0.7 && thr < 0.15 && this.lastRpm > 0.7 && t > this.nextBackfire) {
      this.nextBackfire = t + 0.25 + Math.random() * 0.6;
      this.backfire(t + Math.random() * 0.12);
    }
    this.lastThrottle = thr;
    this.lastRpm = rpm;
    const drop = this.shiftDrop > 0 ? 1 - this.shiftDrop * 1.4 : 1;
    this.shiftDrop = Math.max(0, this.shiftDrop - 0.03);
    this.thrS += (thr - this.thrS) * 0.25;

    // loudness is baked into the layers; here only volume, distance and the AI budget
    const outGain = this.player ? 1 : this.audible ? (1 - this.distance * 0.92) * 0.6 : 0;
    this.lastOut = glide(this.out.gain, outGain, this.lastOut, t, 0.08);
    if (this.muffle) this.lastMuffle = glide(this.muffle.frequency, 20000 - this.distance * 18000, this.lastMuffle, t, 0.1);

    // bracketing layers + equal-power crossfade; pitch bends each layer to the exact rpm
    const hz = f0(this.bank.profile, rpm) * drop;
    let k = 0;
    while (k < LAYER_RPM.length - 2 && rpm > LAYER_RPM[k + 1]) k++;
    const u = clamp01((rpm - LAYER_RPM[k]) / (LAYER_RPM[k + 1] - LAYER_RPM[k]));
    const silent = outGain === 0;
    const onW = this.off.length ? Math.sqrt(this.thrS) : 1;
    const offW = this.off.length ? Math.sqrt(1 - this.thrS) : 0;
    for (const set of [this.on, this.off]) {
      const setW = set === this.on ? onW : offW;
      for (let i = 0; i < set.length; i++) {
        const l = set[i];
        const w = silent ? 0 : i === k ? Math.cos(u * Math.PI * 0.5) : i === k + 1 ? Math.sin(u * Math.PI * 0.5) : 0;
        this.drive(l, w * setW, hz / f0(this.bank.profile, l.rpm), t);
      }
    }

    if (this.turbo) {
      const amt = clamp01(s.turbo ?? rpm * thr);
      this.turbo.osc.frequency.setTargetAtTime(2000 + 4000 * amt, t, 0.12);
      this.lastTurbo = glide(this.turbo.gain.gain, p.turbo ? 0.05 * amt * amt : 0, this.lastTurbo, t, 0.1);
    }
    if (this.fx) {
      const slip = clamp01(s.slip);
      this.drive(this.fx.screech, s.speed > 4 ? Math.pow(slip, 1.3) * 0.32 : 0, (1200 + 1800 * slip + Math.min(400, s.speed * 6)) / 1600, t);
      this.drive(this.fx.scrape, s.scraping && s.speed > 1 ? 0.22 : 0, 1, t);
      this.drive(this.fx.wind, clamp01((s.speed * s.speed) / (75 * 75)) * 0.12, 1, t);
      this.drive(this.fx.nitro, s.nitro ? 0.16 : 0, 1, t);
    }
  }

  private backfire(at: number): void {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const bp = filter(ctx, 'bandpass', 500 + Math.random() * 500, 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.5, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07 + Math.random() * 0.05);
    n.connect(bp).connect(g).connect(this.out);
    n.start(at, Math.random());
    n.stop(at + 0.15);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    voices.delete(this);
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.08);
    const all: (Layer | Loop)[] = [...this.on, ...this.off, ...(this.fx ? Object.values(this.fx) : [])];
    for (const l of all) l.src?.stop(t + 0.5);
    this.turbo?.osc.stop(t + 0.5);
    setTimeout(() => {
      try {
        this.out.disconnect();
        this.muffle?.disconnect();
      } catch {
        /* already disconnected */
      }
    }, 700);
  }
}
