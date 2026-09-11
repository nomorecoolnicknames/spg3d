import type { QualitySettings, Upgrades } from '@/game/types';

export interface TrackRecord {
  initials: string;
  bestLap: number;
  totalTime: number;
  carId: string;
  date: number;
}

export interface Settings {
  quality: QualitySettings['level'];
  shadows: boolean;
  bloom: boolean;
  reflections: boolean;
  master: number;
  music: number;
  sfx: number;
  engine: number;
  camera: number;
  fovKick: boolean;
  invertY: boolean;
  touch: 'auto' | 'on' | 'off';
  dsp: { bass: boolean; mode: 'normal' | 'nightcore' | 'slowed' };
  musicTrack: number;
  musicPlaying: boolean;
}

export interface SaveData {
  v: number;
  money: number;
  /** career stage ids won */
  careerWins: string[];
  bossDefeated: boolean;
  ownedCars: string[];
  selectedCar: string;
  colors: Record<string, string>;
  upgrades: Record<string, Upgrades>;
  records: Record<string, TrackRecord | undefined>;
  career: { races: number; wins: number; driftPoints: number; earned: number; bossKills: number };
  initials: string;
  goldPaint: boolean;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  shadows: true,
  bloom: true,
  reflections: true,
  master: 0.9,
  music: 0.45,
  sfx: 0.8,
  engine: 0.7,
  camera: 0,
  fovKick: true,
  invertY: false,
  touch: 'auto',
  dsp: { bass: false, mode: 'normal' },
  musicTrack: 0,
  musicPlaying: true,
};

export const DEFAULT_SAVE: SaveData = {
  v: 2,
  money: 0,
  careerWins: [],
  bossDefeated: false,
  ownedCars: ['m5cs'],
  selectedCar: 'm5cs',
  colors: {},
  upgrades: {},
  records: {},
  career: { races: 0, wins: 0, driftPoints: 0, earned: 0, bossKills: 0 },
  initials: 'RUS',
  goldPaint: false,
  settings: DEFAULT_SETTINGS,
};

const KEY = 'spg3d-save-v2';

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const p = JSON.parse(raw) as Partial<SaveData>;
    const s: SaveData = {
      ...structuredClone(DEFAULT_SAVE),
      ...p,
      career: { ...DEFAULT_SAVE.career, ...(p.career ?? {}) },
      settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}), dsp: { ...DEFAULT_SETTINGS.dsp, ...(p.settings?.dsp ?? {}) } },
      upgrades: p.upgrades ?? {},
      records: p.records ?? {},
      colors: p.colors ?? {},
      ownedCars: p.ownedCars?.length ? p.ownedCars : ['m5cs'],
    };
    return s;
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function persistSave(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const EMPTY_UPGRADES: Upgrades = { engine: 0, tires: 0, nitro: 0, susp: 0 };

export function upgradePrice(level: number): number {
  return 1500 * (level + 1) * (level + 1);
}
