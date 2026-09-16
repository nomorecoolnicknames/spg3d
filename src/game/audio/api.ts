/**
 * Audio contract. Implementation lives in ./index.ts (exports `audio: AudioSystem`).
 * Everything except music is synthesized with Web Audio — no sample files.
 * All methods must be safe to call before the AudioContext is unlocked (no-ops / queued).
 */
export type SfxName =
  | 'ui-hover'
  | 'ui-click'
  | 'ui-confirm'
  | 'ui-back'
  | 'ui-buy'
  | 'ui-error'
  | 'count-beep'
  | 'count-go'
  | 'lap'
  | 'best-lap'
  | 'finish'
  | 'overtake'
  | 'drift-score'
  | 'nitro-start'
  | 'nitro-end'
  | 'hit-wall'
  | 'hit-car'
  | 'gear-shift'
  | 'backfire'
  | 'rocket-launch'
  | 'rocket-hit'
  | 'explosion'
  | 'explosion-big'
  | 'mech-step'
  | 'mech-roar'
  | 'laser-charge'
  | 'laser-fire'
  | 'slam'
  | 'player-hit'
  | 'player-dead'
  | 'zombie-groan'
  | 'zombie-dead'
  | 'pickup'
  | 'core-open'
  | 'boss-phase'
  | 'boss-dead';

export interface EngineState {
  /** 0..1 normalized rpm within the current gear */
  rpm: number;
  /** 0..1 throttle */
  throttle: number;
  /** 1..6 (0 reverse) — changes trigger a shift blip */
  gear: number;
  /** m/s */
  speed: number;
  nitro: boolean;
  /** 0..1 tire slip magnitude (drives screech) */
  slip: number;
  /** true while scraping a wall */
  scraping: boolean;
  /** 0..1, how far the car is from the listener (player = 0) */
  distance?: number;
  /** turbo whistle amount 0..1 (JDM cars) */
  turbo?: number;
}

export interface EngineVoice {
  update(s: EngineState): void;
  stop(): void;
}

export interface MusicTrack {
  title: string;
  artist: string;
  src: string;
  duration?: number;
}

export interface MusicState {
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  track: MusicTrack;
  /** normalized spectrum bars 0..1 for the visualizer */
  bars: number[];
}

export interface DspSettings {
  bass: boolean;
  mode: 'normal' | 'nightcore' | 'slowed';
}

export interface AudioSystem {
  /** Call on the first user gesture; resumes the context. Idempotent. */
  unlock(): void;
  readonly unlocked: boolean;
  setVolumes(v: { master?: number; music?: number; sfx?: number; engine?: number }): void;
  /** Fire-and-forget one-shot. `opts.pan` -1..1, `opts.gain` 0..1 scale, `opts.pitch` semitone offset. */
  play(name: SfxName, opts?: { pan?: number; gain?: number; pitch?: number }): void;
  /** Per-car engine voice. Player car is voice #0 at full volume; AI voices are attenuated by distance. */
  createEngine(profile: 'v8' | 'i6-turbo' | 'v6' | 'w16' | 'v12'): EngineVoice;
  /** Continuous tire screech is driven through EngineVoice.slip; wind noise through speed. */
  /** Ducks music (e.g. countdown, boss intro). factor 0..1, seconds to ramp. */
  duckMusic(factor: number, seconds?: number): void;
  music: {
    readonly tracks: MusicTrack[];
    readonly state: MusicState;
    play(index?: number): void;
    pause(): void;
    toggle(): void;
    next(): void;
    prev(): void;
    seek(t: number): void;
    setDsp(d: Partial<DspSettings>): void;
    subscribe(cb: (s: MusicState) => void): () => void;
    /** the loudness the current track actually plays at, 0..1 (QA) */
    effectiveVolume(): number;
  };
  /** Boss/mech ambience loops keyed by name; `start` is idempotent. */
  loop(name: 'laser-beam' | 'mech-idle' | 'rain' | 'wind' | 'core-hum', on: boolean, gain?: number): void;
  /** stop everything (scene switch) */
  stopAll(): void;
}
