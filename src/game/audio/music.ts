import type { DspSettings, MusicState, MusicTrack } from './api';
import { getBuses, onUnlocked } from './context';

import madk1d_1 from '@/assets/madk1d_1.mp3';
import madk1d_2 from '@/assets/madk1d_2.mp3';
import madk1d_3 from '@/assets/madk1d_3.mp3';
import madk1d_4 from '@/assets/madk1d_4.mp3';
import madk1d_5 from '@/assets/madk1d_5.mp3';
import t_princ_1 from '@/assets/t_princ_1.mp3';
import t_princ_2 from '@/assets/t_princ_2.mp3';
import t_princ_3 from '@/assets/t_princ_3.mp3';
import t_princ_4 from '@/assets/t_princ_4.mp3';
import t_princ_5 from '@/assets/t_princ_5.mp3';

const SUFFIX = ' (remixxx by dj dubstep 2012)';
export const TRACKS: MusicTrack[] = [
  { title: 'низкий флекс' + SUFFIX, artist: 'madk1d', src: madk1d_1 },
  { title: 'ты че обиделась' + SUFFIX, artist: 'madk1d', src: madk1d_2 },
  { title: 'так по***' + SUFFIX, artist: 'madk1d', src: madk1d_3 },
  { title: '8 миля' + SUFFIX, artist: 'madk1d', src: madk1d_4 },
  { title: 'sexyswag2010' + SUFFIX, artist: 'madk1d', src: madk1d_5 },
  { title: 'утекай' + SUFFIX, artist: 'Тёмный Принц', src: t_princ_1 },
  { title: 'Покой' + SUFFIX, artist: 'Тёмный Принц', src: t_princ_2 },
  { title: 'ПАПА' + SUFFIX, artist: 'Тёмный Принц', src: t_princ_3 },
  { title: 'Автозаправка' + SUFFIX, artist: 'Тёмный Принц', src: t_princ_4 },
  { title: 'MAYHEM' + SUFFIX, artist: 'Тёмный Принц', src: t_princ_5 },
];

const BARS = 16;
const XFADE = 0.6;

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode | null;
  src: MediaElementAudioSourceNode | null;
}

/**
 * Two-deck music player with a DSP rack: bass shelf, playback-rate modes and a
 * delay-network reverb for the "slowed" mode. Decks are plain <audio> elements
 * so playback works even before Web Audio is unlocked (then it's routed through the graph).
 */
export class MusicManager {
  readonly tracks = TRACKS;
  readonly state: MusicState;
  private decks: [Deck, Deck];
  private cur = 0;
  private listeners = new Set<(s: MusicState) => void>();
  private dsp: DspSettings = { bass: false, mode: 'normal' };
  private graph: {
    input: GainNode;
    bass: BiquadFilterNode;
    dry: GainNode;
    wet: GainNode;
    duck: GainNode;
    analyser: AnalyserNode;
    data: Uint8Array<ArrayBuffer>;
  } | null = null;
  private raf = 0;
  private wantPlay = false;

  constructor() {
    this.state = { index: 0, playing: false, time: 0, duration: 0, track: TRACKS[0], bars: new Array<number>(BARS).fill(0) };
    this.decks = [this.mkDeck(), this.mkDeck()];
    onUnlocked(() => this.connectGraph());
  }

  private mkDeck(): Deck {
    const el = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
    if (el) {
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.addEventListener('ended', () => {
        if (el === this.decks[this.cur].el) this.next();
      });
      el.addEventListener('timeupdate', () => {
        if (el === this.decks[this.cur].el) {
          this.state.time = el.currentTime;
          this.state.duration = isFinite(el.duration) ? el.duration : 0;
          this.notify();
        }
      });
      el.addEventListener('error', () => {
        if (el === this.decks[this.cur].el) {
          this.state.playing = false;
          this.notify();
        }
      });
    }
    return { el, gain: null, src: null };
  }

  /** Builds the DSP graph once the context is running and routes both decks through it. */
  private connectGraph(): void {
    if (this.graph) return;
    const b = getBuses();
    if (!b) return;
    const ctx = b.ctx;
    const input = ctx.createGain();
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 80;
    bass.gain.value = this.dsp.bass ? 14 : 0;
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = this.dsp.mode === 'slowed' ? 0.4 : 0;
    const duck = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    input.connect(bass);
    bass.connect(dry);
    dry.connect(duck);
    // reverb: feedback delay + three short diffusing delays
    const fb = ctx.createDelay(1);
    fb.delayTime.value = 0.32;
    const fbg = ctx.createGain();
    fbg.gain.value = 0.45;
    const fbLp = ctx.createBiquadFilter();
    fbLp.type = 'lowpass';
    fbLp.frequency.value = 3200;
    bass.connect(fb);
    fb.connect(fbLp);
    fbLp.connect(fbg);
    fbg.connect(fb);
    fbLp.connect(wet);
    for (const dt of [0.043, 0.071, 0.113]) {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = dt;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      fbLp.connect(d);
      d.connect(g);
      g.connect(wet);
    }
    wet.connect(duck);
    duck.connect(analyser);
    analyser.connect(b.music);
    this.graph = { input, bass, dry, wet, duck, analyser, data: new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer> };
    for (const d of this.decks) {
      if (!d.el) continue;
      try {
        d.src = ctx.createMediaElementSource(d.el);
        d.gain = ctx.createGain();
        d.gain.gain.value = d === this.decks[this.cur] ? 1 : 0;
        d.src.connect(d.gain);
        d.gain.connect(input);
      } catch {
        /* element already connected elsewhere */
      }
    }
    this.applyRate();
  }

  private notify(): void {
    for (const l of this.listeners) l(this.state);
  }

  subscribe(cb: (s: MusicState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    this.ensureBars();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private ensureBars(): void {
    if (this.raf || !this.state.playing || this.listeners.size === 0) return;
    let last = 0;
    const tick = (now: number): void => {
      this.raf = 0;
      if (!this.state.playing || this.listeners.size === 0) {
        this.state.bars.fill(0);
        this.notify();
        return;
      }
      if (now - last >= 33) {
        last = now;
        this.updateBars();
        this.notify();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private updateBars(): void {
    const g = this.graph;
    const bars = this.state.bars;
    if (!g) {
      // no analyser yet (context locked): gentle fake motion so the UI isn't dead
      const t = performance.now() / 1000;
      for (let i = 0; i < BARS; i++) bars[i] = 0.2 + 0.2 * Math.abs(Math.sin(t * 3 + i * 0.7));
      return;
    }
    g.analyser.getByteFrequencyData(g.data);
    const n = g.data.length;
    for (let i = 0; i < BARS; i++) {
      // log-spaced bins
      const lo = Math.floor(Math.pow(n, i / BARS));
      const hi = Math.max(lo + 1, Math.floor(Math.pow(n, (i + 1) / BARS)));
      let sum = 0;
      for (let k = lo; k < hi && k < n; k++) sum += g.data[k];
      const v = sum / (hi - lo) / 255;
      bars[i] = Math.max(v, bars[i] * 0.8);
    }
  }

  private load(deck: Deck, index: number): void {
    const t = TRACKS[index];
    if (deck.el.getAttribute('src') !== t.src) {
      deck.el.src = t.src;
      deck.el.load();
    }
  }

  private applyRate(): void {
    const rate = this.dsp.mode === 'nightcore' ? 1.3 : this.dsp.mode === 'slowed' ? 0.82 : 1;
    for (const d of this.decks) {
      if (!d.el) continue;
      d.el.playbackRate = rate;
      d.el.preservesPitch = false;
    }
    if (this.graph) {
      const t = getBuses()?.ctx.currentTime ?? 0;
      this.graph.wet.gain.setTargetAtTime(this.dsp.mode === 'slowed' ? 0.4 : 0, t, 0.2);
      this.graph.bass.gain.setTargetAtTime(this.dsp.bass ? 14 : 0, t, 0.1);
    }
  }

  play(index?: number): void {
    const b = getBuses();
    if (b && b.ctx.state === 'suspended') void b.ctx.resume();
    const switching = index !== undefined && index !== this.state.index;
    const idx = ((index ?? this.state.index) + TRACKS.length) % TRACKS.length;
    this.wantPlay = true;
    if (switching) this.switchTo(idx);
    else {
      const d = this.decks[this.cur];
      this.load(d, idx);
      this.state.index = idx;
      this.state.track = TRACKS[idx];
      d.gain?.gain.setTargetAtTime(1, b?.ctx.currentTime ?? 0, 0.1);
      void d.el.play().catch(() => {
        /* autoplay blocked until gesture */
      });
    }
    this.state.playing = true;
    this.notify();
    this.ensureBars();
  }

  private switchTo(idx: number): void {
    const b = getBuses();
    const t = b?.ctx.currentTime ?? 0;
    const old = this.decks[this.cur];
    this.cur = 1 - this.cur;
    const nu = this.decks[this.cur];
    this.load(nu, idx);
    this.state.index = idx;
    this.state.track = TRACKS[idx];
    this.state.time = 0;
    nu.el.currentTime = 0;
    if (nu.gain && old.gain) {
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + XFADE);
      nu.gain.gain.cancelScheduledValues(t);
      nu.gain.gain.setValueAtTime(0, t);
      nu.gain.gain.linearRampToValueAtTime(1, t + XFADE);
      window.setTimeout(() => {
        if (this.decks[this.cur] !== old) old.el.pause();
      }, XFADE * 1000 + 50);
    } else old.el.pause();
    void nu.el.play().catch(() => {
      /* autoplay blocked */
    });
  }

  pause(): void {
    this.wantPlay = false;
    this.decks[this.cur].el.pause();
    this.state.playing = false;
    this.notify();
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  next(): void {
    this.play((this.state.index + 1) % TRACKS.length);
  }

  prev(): void {
    this.play((this.state.index - 1 + TRACKS.length) % TRACKS.length);
  }

  seek(t: number): void {
    const el = this.decks[this.cur].el;
    if (!el || !isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.duration, t));
    this.state.time = el.currentTime;
    this.notify();
  }

  setDsp(d: Partial<DspSettings>): void {
    this.dsp = { ...this.dsp, ...d };
    this.applyRate();
  }

  /** ramp of the post-DSP music gain, used for ducking */
  duck(factor: number, seconds = 0.4): void {
    const g = this.graph;
    const b = getBuses();
    if (!g || !b) return;
    const t = b.ctx.currentTime;
    g.duck.gain.cancelScheduledValues(t);
    g.duck.gain.setValueAtTime(g.duck.gain.value, t);
    g.duck.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, factor)), t + Math.max(0.01, seconds));
  }

  /** Retry playback after the context is unlocked (autoplay policies). */
  resumeIfWanted(): void {
    if (this.wantPlay && this.decks[this.cur].el.paused) {
      void this.decks[this.cur].el.play().catch(() => {
        /* still blocked */
      });
    }
  }
}
