import type { AudioSystem, EngineVoice, SfxName } from './api';
import { getBuses, isUnlocked, liveBuses, onUnlocked, panGain, unlock as ctxUnlock } from './context';
import type { EngineProfileName } from './engine';
import { BankEngineVoice, engineBankReady, prepareEngineBank } from './engineBank';
import { Loops } from './loops';
import { MusicManager } from './music';
import { SFX, pitchRatio } from './sfx';

const MAX_VOICES = 8;
const SFX_MIN_GAP = 0.04;

class AudioSystemImpl implements AudioSystem {
  readonly music = new MusicManager();
  private loops: Loops | null = null;
  private voices: BankEngineVoice[] = [];
  /** every voice handed out and not stopped yet (attached or still waiting for its bank) */
  private handles = new Set<LazyVoice>();
  private lastPlayed = new Map<SfxName, number>();
  private volumes = { master: 0.9, music: 0.45, sfx: 0.8, engine: 0.7 };
  private pendingVoices: { profile: EngineProfileName; player: boolean; handle: LazyVoice }[] = [];

  constructor() {
    onUnlocked(() => {
      this.applyVolumes();
      for (const p of this.pendingVoices.splice(0)) this.attachWhenReady(p.profile, p.player, p.handle);
      // pre-render the engine loops while the player is still in the menus
      void ['v8', 'i6-turbo', 'v6', 'w16'].reduce<Promise<unknown>>((chain, pr) => chain.then(() => prepareEngineBank(pr as EngineProfileName)), Promise.resolve());
      this.music.resumeIfWanted();
    });
  }

  get unlocked(): boolean {
    return isUnlocked();
  }

  unlock(): void {
    ctxUnlock();
  }

  setVolumes(v: { master?: number; music?: number; sfx?: number; engine?: number }): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const b = getBuses();
    if (!b) return;
    const t = b.ctx.currentTime;
    const c = (x: number): number => Math.max(0, Math.min(1, x));
    b.master.gain.setTargetAtTime(c(this.volumes.master) * 0.9, t, 0.05);
    b.music.gain.setTargetAtTime(c(this.volumes.music), t, 0.05);
    b.sfx.gain.setTargetAtTime(c(this.volumes.sfx), t, 0.05);
    b.engine.gain.setTargetAtTime(c(this.volumes.engine) * 0.6, t, 0.05);
  }

  play(name: SfxName, opts: { pan?: number; gain?: number; pitch?: number } = {}): void {
    const b = liveBuses();
    if (!b) return;
    const gen = SFX[name];
    if (!gen) return;
    const t = b.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (t - last < SFX_MIN_GAP) return;
    this.lastPlayed.set(name, t);
    const out = panGain(b.ctx, b.sfx, opts.pan ?? 0, Math.max(0, Math.min(1.5, opts.gain ?? 1)));
    try {
      gen(b.ctx, out, t + 0.005, pitchRatio(opts.pitch));
    } catch (e) {
      // never let a synth bug break gameplay
      void e;
    }
    // detach the wrapper after the longest possible tail
    window.setTimeout(() => out.disconnect(), 5000);
  }

  private attachWhenReady(profile: EngineProfileName, player: boolean, handle: LazyVoice): void {
    const make = () => {
      const b = getBuses();
      const bank = engineBankReady(profile);
      if (!b || !bank) return;
      const v = new BankEngineVoice(b.ctx, b.engine, bank, player);
      this.voices.push(v);
      handle.attach(v);
    };
    if (engineBankReady(profile)) make();
    else void prepareEngineBank(profile).then(make);
  }

  createEngine(profile: EngineProfileName): EngineVoice {
    // the first voice of a session is the player's (RaceScene creates it first)
    const player = this.handles.size === 0;
    if (this.handles.size >= MAX_VOICES) return { update() {}, stop() {} };
    const handle = new LazyVoice(() => {
      this.handles.delete(handle);
      this.voices = this.voices.filter((v) => v !== handle.inner);
      this.pendingVoices = this.pendingVoices.filter((p) => p.handle !== handle);
    });
    this.handles.add(handle);
    if (isUnlocked()) this.attachWhenReady(profile, player, handle);
    else this.pendingVoices.push({ profile, player, handle });
    return handle;
  }

  duckMusic(factor: number, seconds = 0.4): void {
    this.music.duck(factor, seconds);
  }

  loop(name: 'laser-beam' | 'mech-idle' | 'rain' | 'wind' | 'core-hum', on: boolean, gain = 1): void {
    const b = liveBuses();
    if (!b) return;
    if (!this.loops) this.loops = new Loops(b.ctx, b.sfx);
    this.loops.set(name, on, gain);
  }

  stopAll(): void {
    this.loops?.stopAll();
    for (const v of this.voices.splice(0)) v.stop();
    for (const h of [...this.handles]) h.stop();
    this.pendingVoices = [];
  }
}

/** Engine voice proxy: created before unlock, attached to a real voice once audio is live. */
class LazyVoice implements EngineVoice {
  inner: BankEngineVoice | null = null;
  private stopped = false;
  constructor(private onStop: () => void) {}
  attach(v: BankEngineVoice): void {
    if (this.stopped) {
      v.stop();
      return;
    }
    this.inner = v;
  }
  update(s: Parameters<EngineVoice['update']>[0]): void {
    this.inner?.update(s);
  }
  stop(): void {
    this.stopped = true;
    this.inner?.stop();
    this.inner = null;
    this.onStop();
  }
}

export const audio: AudioSystem = new AudioSystemImpl();
export type { AudioSystem, EngineVoice, SfxName } from './api';
