import type { EngineState, EngineVoice } from './api';
import { clamp01, distortionCurve, filter, noiseBuffer, semitones } from './context';

export type EngineProfileName = 'v8' | 'i6-turbo' | 'v6' | 'w16' | 'v12';

interface Profile {
  /** fundamental at idle / redline (Hz) */
  idleHz: number;
  redlineHz: number;
  /** [type, ratio, gain, detuneCents] */
  oscs: [OscillatorType, number, number, number][];
  /** exhaust pulse-noise level */
  exhaust: number;
  /** lowpass range */
  lpMin: number;
  lpMax: number;
  distortion: number;
  turbo: boolean;
  /** how "lumpy" the idle is (amplitude wobble) */
  lump: number;
  sub: number;
}

const PROFILES: Record<EngineProfileName, Profile> = {
  v8: {
    idleHz: 38,
    redlineHz: 170,
    oscs: [
      ['sawtooth', 1, 0.5, 0],
      ['square', 0.5, 0.35, 4],
      ['sawtooth', 2, 0.25, -6],
      ['sawtooth', 4, 0.12, 9],
    ],
    exhaust: 0.55,
    lpMin: 260,
    lpMax: 3200,
    distortion: 0.55,
    turbo: false,
    lump: 0.35,
    sub: 0.45,
  },
  'i6-turbo': {
    idleHz: 45,
    redlineHz: 230,
    oscs: [
      ['sawtooth', 1, 0.45, 0],
      ['sawtooth', 1.5, 0.28, -5],
      ['square', 3, 0.16, 7],
      ['sawtooth', 2, 0.2, 3],
    ],
    exhaust: 0.35,
    lpMin: 320,
    lpMax: 4200,
    distortion: 0.3,
    turbo: true,
    lump: 0.15,
    sub: 0.25,
  },
  v6: {
    idleHz: 42,
    redlineHz: 200,
    oscs: [
      ['sawtooth', 1, 0.5, 0],
      ['square', 1.5, 0.3, -4],
      ['sawtooth', 3, 0.18, 6],
    ],
    exhaust: 0.45,
    lpMin: 300,
    lpMax: 3600,
    distortion: 0.4,
    turbo: false,
    lump: 0.25,
    sub: 0.3,
  },
  w16: {
    idleHz: 50,
    redlineHz: 300,
    oscs: [
      ['sawtooth', 1, 0.4, 0],
      ['sawtooth', 1.01, 0.4, 11],
      ['sawtooth', 2, 0.3, -9],
      ['sawtooth', 4, 0.22, 5],
    ],
    exhaust: 0.4,
    lpMin: 380,
    lpMax: 5200,
    distortion: 0.35,
    turbo: true,
    lump: 0.08,
    sub: 0.4,
  },
  v12: {
    idleHz: 48,
    redlineHz: 280,
    oscs: [
      ['sawtooth', 1, 0.42, 0],
      ['sawtooth', 2, 0.32, -3],
      ['sawtooth', 3, 0.22, 4],
      ['square', 6, 0.1, 0],
    ],
    exhaust: 0.3,
    lpMin: 360,
    lpMax: 5000,
    distortion: 0.25,
    turbo: false,
    lump: 0.06,
    sub: 0.3,
  },
};

const SM = 0.05; // param smoothing time constant

export class SynthEngineVoice implements EngineVoice {
  private ctx: AudioContext;
  private out: GainNode;
  private master: GainNode;
  private lp: BiquadFilterNode;
  private shaper: WaveShaperNode;
  private oscs: { o: OscillatorNode; g: GainNode; ratio: number }[] = [];
  private sub: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private exhaustGain: GainNode;
  private exhaustBp: BiquadFilterNode;
  private lumpLfo: OscillatorNode | null = null;
  private lumpGain: GainNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private nitroGain: GainNode;
  private screechGain: GainNode;
  private screechBp: BiquadFilterNode;
  private scrapeGain: GainNode;
  private windGain: GainNode;
  private distFilter: BiquadFilterNode;
  private profile: Profile;
  private lastGear = 1;
  private lastThrottle = 0;
  private lastRpm = 0;
  private shiftDrop = 0;
  private blowoff = 0;
  private stopped = false;
  private simple: boolean;
  private noiseSources: AudioBufferSourceNode[] = [];
  private nextBackfire = 0;

  constructor(ctx: AudioContext, bus: AudioNode, profile: EngineProfileName, simple: boolean) {
    this.ctx = ctx;
    this.simple = simple;
    this.profile = PROFILES[profile];
    const p = this.profile;
    const t = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.distFilter = filter(ctx, 'lowpass', 20000, 0.7);
    this.master.connect(this.distFilter);
    this.distFilter.connect(bus);

    this.out = ctx.createGain();
    this.out.gain.value = 1;

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = distortionCurve(p.distortion);
    this.shaper.oversample = simple ? 'none' : '2x';
    this.lp = filter(ctx, 'lowpass', p.lpMin, 1.4);
    this.out.connect(this.lp);
    this.lp.connect(this.shaper);
    this.shaper.connect(this.master);

    const oscDefs = simple ? p.oscs.slice(0, 2) : p.oscs;
    for (const [type, ratio, gain, det] of oscDefs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = p.idleHz * ratio;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = gain * 0.5;
      o.connect(g);
      g.connect(this.out);
      o.start(t);
      this.oscs.push({ o, g, ratio });
    }

    if (!simple) {
      this.sub = ctx.createOscillator();
      this.sub.type = 'sine';
      this.sub.frequency.value = p.idleHz * 0.5;
      this.subGain = ctx.createGain();
      this.subGain.gain.value = p.sub * 0.6;
      this.sub.connect(this.subGain);
      this.subGain.connect(this.master);
      this.sub.start(t);

      // idle lumpiness: slow LFO on the master gain
      this.lumpLfo = ctx.createOscillator();
      this.lumpLfo.type = 'sine';
      this.lumpLfo.frequency.value = p.idleHz * 0.25;
      this.lumpGain = ctx.createGain();
      this.lumpGain.gain.value = p.lump * 0.25;
      this.lumpLfo.connect(this.lumpGain);
      this.lumpGain.connect(this.out.gain);
      this.lumpLfo.start(t);
    }

    // exhaust pulse-noise: white noise through a narrow bandpass tracking rpm
    const ex = this.mkNoise();
    this.exhaustBp = filter(ctx, 'bandpass', p.idleHz * 2, 6);
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    ex.connect(this.exhaustBp);
    this.exhaustBp.connect(this.exhaustGain);
    this.exhaustGain.connect(this.out);

    // turbo whistle
    if (p.turbo && !simple) {
      this.turboOsc = ctx.createOscillator();
      this.turboOsc.type = 'sine';
      this.turboOsc.frequency.value = 2000;
      this.turboGain = ctx.createGain();
      this.turboGain.gain.value = 0;
      this.turboOsc.connect(this.turboGain);
      this.turboGain.connect(this.master);
      this.turboOsc.start(t);
    }

    // nitro hiss (highpassed noise)
    const nz = this.mkNoise();
    const nhp = filter(ctx, 'highpass', 2500, 0.8);
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    nz.connect(nhp);
    nhp.connect(this.nitroGain);
    this.nitroGain.connect(this.master);

    // tire screech
    const sz = this.mkNoise();
    this.screechBp = filter(ctx, 'bandpass', 1600, 9);
    const sbp2 = filter(ctx, 'bandpass', 2400, 5);
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    sz.connect(this.screechBp);
    this.screechBp.connect(sbp2);
    sbp2.connect(this.screechGain);
    this.screechGain.connect(this.master);

    // wall scrape: noise → comb-ish (two bandpasses) with high Q, metallic
    const gz = this.mkNoise();
    const g1 = filter(ctx, 'bandpass', 900, 14);
    const g2 = filter(ctx, 'bandpass', 3100, 18);
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    gz.connect(g1);
    gz.connect(g2);
    g1.connect(this.scrapeGain);
    g2.connect(this.scrapeGain);
    this.scrapeGain.connect(this.master);

    // wind
    const wz = this.mkNoise('pink');
    const wlp = filter(ctx, 'lowpass', 700, 0.5);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wz.connect(wlp);
    wlp.connect(this.windGain);
    this.windGain.connect(this.master);
  }

  private mkNoise(kind: 'white' | 'pink' = 'white'): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = noiseBuffer(this.ctx, kind);
    s.loop = true;
    s.start(this.ctx.currentTime, Math.random() * 1.5);
    this.noiseSources.push(s);
    return s;
  }

  update(s: EngineState): void {
    if (this.stopped) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const p = this.profile;
    const rpm = clamp01(s.rpm);
    const thr = clamp01(s.throttle);
    const dist = clamp01(s.distance ?? 0);

    // gear shift: short rpm drop + click of the lp
    if (s.gear !== this.lastGear && s.speed > 2) {
      this.shiftDrop = 0.18;
      this.lastGear = s.gear;
    }
    // blow-off when throttle released from high rpm
    if (this.lastThrottle > 0.6 && thr < 0.2 && this.lastRpm > 0.55 && p.turbo) this.blowoff = 0.35;
    // backfire pops: occasional noise bursts on lift-off at high rpm
    if (this.lastThrottle > 0.7 && thr < 0.15 && this.lastRpm > 0.7 && t > this.nextBackfire && !this.simple) {
      this.nextBackfire = t + 0.25 + Math.random() * 0.6;
      this.backfire(t + Math.random() * 0.12);
    }
    this.lastThrottle = thr;
    this.lastRpm = rpm;

    const dropFactor = this.shiftDrop > 0 ? 1 - this.shiftDrop * 1.4 : 1;
    this.shiftDrop = Math.max(0, this.shiftDrop - 0.03);
    this.blowoff = Math.max(0, this.blowoff - 0.03);

    const f0 = (p.idleHz + (p.redlineHz - p.idleHz) * Math.pow(rpm, 1.15)) * dropFactor;
    for (const o of this.oscs) o.o.frequency.setTargetAtTime(f0 * o.ratio, t, SM);
    if (this.sub) this.sub.frequency.setTargetAtTime(f0 * 0.5, t, SM);
    if (this.lumpLfo && this.lumpGain) {
      this.lumpLfo.frequency.setTargetAtTime(f0 * 0.25, t, SM);
      this.lumpGain.gain.setTargetAtTime(p.lump * 0.25 * (1 - rpm * 0.85), t, SM);
    }
    const lpFreq = p.lpMin + (p.lpMax - p.lpMin) * (0.35 * rpm + 0.65 * thr * (0.4 + 0.6 * rpm));
    this.lp.frequency.setTargetAtTime(lpFreq, t, 0.08);
    this.exhaustBp.frequency.setTargetAtTime(f0 * 2 + 60, t, SM);
    this.exhaustGain.gain.setTargetAtTime(p.exhaust * (0.25 + 0.75 * thr) * (0.5 + 0.5 * rpm), t, SM);

    // loudness: idle quiet, throttle louder, plus distance attenuation
    const loud = (0.28 + 0.42 * thr + 0.3 * rpm) * (1 - dist * 0.92);
    this.master.gain.setTargetAtTime(loud * (this.simple ? 0.55 : 1), t, 0.08);
    this.distFilter.frequency.setTargetAtTime(20000 - dist * 18000, t, 0.1);

    if (this.turboOsc && this.turboGain) {
      const turboAmt = clamp01(s.turbo ?? rpm * thr);
      this.turboOsc.frequency.setTargetAtTime(2000 + 4000 * turboAmt, t, 0.12);
      const tg = 0.05 * turboAmt * turboAmt + (this.blowoff > 0 ? 0.0 : 0);
      this.turboGain.gain.setTargetAtTime(tg, t, 0.1);
    }
    // blow-off hiss on nitro/turbo channel
    const nitroAmt = s.nitro ? 0.16 : 0;
    this.nitroGain.gain.setTargetAtTime(nitroAmt + (this.blowoff > 0 ? this.blowoff * 0.3 : 0), t, 0.04);

    const slip = clamp01(s.slip);
    const screech = s.speed > 4 ? Math.pow(slip, 1.3) * 0.32 : 0;
    this.screechGain.gain.setTargetAtTime(screech, t, 0.05);
    this.screechBp.frequency.setTargetAtTime(1200 + 1800 * slip + Math.min(400, s.speed * 6), t, 0.06);

    this.scrapeGain.gain.setTargetAtTime(s.scraping && s.speed > 1 ? 0.22 : 0, t, 0.03);

    const wind = clamp01((s.speed * s.speed) / (75 * 75)) * 0.12;
    this.windGain.gain.setTargetAtTime(wind, t, 0.2);
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
    n.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    n.start(at, Math.random());
    n.stop(at + 0.15);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0, t, 0.08);
    const stopAt = t + 0.5;
    for (const o of this.oscs) o.o.stop(stopAt);
    this.sub?.stop(stopAt);
    this.lumpLfo?.stop(stopAt);
    this.turboOsc?.stop(stopAt);
    for (const n of this.noiseSources) n.stop(stopAt);
    setTimeout(() => {
      try {
        this.distFilter.disconnect();
        this.master.disconnect();
      } catch {
        /* already disconnected */
      }
    }, 600);
  }
}

export function pitchRatio(st: number): number {
  return semitones(st);
}
