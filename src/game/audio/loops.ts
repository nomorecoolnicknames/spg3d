import { distortionCurve, filter, noiseBuffer } from './context';

export type LoopName = 'laser-beam' | 'mech-idle' | 'rain' | 'wind' | 'core-hum';

interface LoopNodes {
  gain: GainNode;
  stoppables: { stop(when?: number): void }[];
  base: number;
}

/**
 * Continuous synthesized loops. Each `start` builds its graph; `set(on=false)` fades and
 * tears it down after the fade. Idempotent: repeated `on` calls only adjust gain.
 */
export class Loops {
  private active = new Map<LoopName, LoopNodes>();
  constructor(private ctx: AudioContext, private out: AudioNode) {}

  set(name: LoopName, on: boolean, gain = 1): void {
    const t = this.ctx.currentTime;
    const cur = this.active.get(name);
    if (on) {
      if (cur) {
        cur.gain.gain.setTargetAtTime(cur.base * gain, t, 0.15);
        return;
      }
      const nodes = this.build(name);
      nodes.gain.gain.setValueAtTime(0.0001, t);
      nodes.gain.gain.setTargetAtTime(nodes.base * gain, t, 0.25);
      this.active.set(name, nodes);
    } else if (cur) {
      cur.gain.gain.setTargetAtTime(0.0001, t, 0.2);
      this.active.delete(name);
      const stopAt = t + 1.0;
      for (const s of cur.stoppables) s.stop(stopAt);
      setTimeout(() => cur.gain.disconnect(), 1200);
    }
  }

  stopAll(): void {
    for (const k of [...this.active.keys()]) this.set(k, false);
  }

  private noiseSrc(): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = noiseBuffer(this.ctx, 'white');
    s.loop = true;
    s.start(this.ctx.currentTime, Math.random() * 1.5);
    return s;
  }

  private build(name: LoopName): LoopNodes {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.connect(this.out);
    const st: { stop(when?: number): void }[] = [];
    const t = ctx.currentTime;
    switch (name) {
      case 'laser-beam': {
        const sh = ctx.createWaveShaper();
        sh.curve = distortionCurve(0.7);
        sh.connect(gain);
        const trem = ctx.createGain();
        trem.gain.value = 0.6;
        trem.connect(sh);
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 17;
        const lg = ctx.createGain();
        lg.gain.value = 0.35;
        lfo.connect(lg);
        lg.connect(trem.gain);
        lfo.start(t);
        for (const [type, f] of [['sawtooth', 180], ['square', 271], ['sawtooth', 361]] as [OscillatorType, number][]) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f;
          o.connect(trem);
          o.start(t);
          st.push(o);
        }
        const n = this.noiseSrc();
        const hp = filter(ctx, 'highpass', 2500, 0.8);
        const ng = ctx.createGain();
        ng.gain.value = 0.25;
        n.connect(hp);
        hp.connect(ng);
        ng.connect(gain);
        st.push(n, lfo);
        return { gain, stoppables: st, base: 0.3 };
      }
      case 'mech-idle': {
        // low hydraulic hum with slow pulse and servo whine
        const o1 = ctx.createOscillator();
        o1.type = 'sawtooth';
        o1.frequency.value = 44;
        const o2 = ctx.createOscillator();
        o2.type = 'square';
        o2.frequency.value = 22;
        const lp = filter(ctx, 'lowpass', 220, 1.5);
        const mix = ctx.createGain();
        mix.gain.value = 0.5;
        o1.connect(lp);
        o2.connect(lp);
        lp.connect(mix);
        mix.connect(gain);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.8;
        const lg = ctx.createGain();
        lg.gain.value = 0.25;
        lfo.connect(lg);
        lg.connect(mix.gain);
        const whine = ctx.createOscillator();
        whine.type = 'sine';
        whine.frequency.value = 1850;
        const wl = ctx.createOscillator();
        wl.frequency.value = 0.23;
        const wlg = ctx.createGain();
        wlg.gain.value = 320;
        wl.connect(wlg);
        wlg.connect(whine.frequency);
        const wg = ctx.createGain();
        wg.gain.value = 0.03;
        whine.connect(wg);
        wg.connect(gain);
        for (const o of [o1, o2, lfo, whine, wl]) {
          o.start(t);
          st.push(o);
        }
        return { gain, stoppables: st, base: 0.35 };
      }
      case 'rain': {
        const n = this.noiseSrc();
        const bp = filter(ctx, 'bandpass', 3800, 0.6);
        const hp = filter(ctx, 'highpass', 1200, 0.7);
        n.connect(hp);
        hp.connect(bp);
        bp.connect(gain);
        // patter modulation
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 9;
        const lg = ctx.createGain();
        lg.gain.value = 0.15;
        const mod = ctx.createGain();
        mod.gain.value = 0.85;
        lfo.connect(lg);
        lg.connect(mod.gain);
        bp.disconnect();
        bp.connect(mod);
        mod.connect(gain);
        lfo.start(t);
        st.push(n, lfo);
        return { gain, stoppables: st, base: 0.18 };
      }
      case 'wind': {
        const n = this.noiseSrc();
        const lp = filter(ctx, 'lowpass', 500, 0.8);
        const bp = filter(ctx, 'bandpass', 700, 1.2);
        n.connect(lp);
        lp.connect(bp);
        bp.connect(gain);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.17;
        const lg = ctx.createGain();
        lg.gain.value = 350;
        lfo.connect(lg);
        lg.connect(bp.frequency);
        lfo.start(t);
        st.push(n, lfo);
        return { gain, stoppables: st, base: 0.2 };
      }
      case 'core-hum': {
        const o1 = ctx.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = 110;
        const o2 = ctx.createOscillator();
        o2.type = 'triangle';
        o2.frequency.value = 220.7;
        const o3 = ctx.createOscillator();
        o3.type = 'sine';
        o3.frequency.value = 1320;
        const g3 = ctx.createGain();
        g3.gain.value = 0.08;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const lg = ctx.createGain();
        lg.gain.value = 0.06;
        lfo.connect(lg);
        lg.connect(g3.gain);
        o1.connect(gain);
        o2.connect(gain);
        o3.connect(g3);
        g3.connect(gain);
        for (const o of [o1, o2, o3, lfo]) {
          o.start(t);
          st.push(o);
        }
        return { gain, stoppables: st, base: 0.2 };
      }
    }
  }
}
