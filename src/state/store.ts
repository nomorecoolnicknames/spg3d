import { useSyncExternalStore } from 'react';
import type { BossParams, CarSpec, GameResults, HUDState, RaceParams, ScreenId, Upgrades } from '@/game/types';
import { CAR_BY_ID, CARS } from '@/data/cars';
import { CAREER, RIVALS } from '@/data/story';
import { TRACK_BY_ID } from '@/data/tracks';
import { DEFAULT_SAVE, EMPTY_UPGRADES, loadSave, persistSave, clearSave, upgradePrice, type SaveData, type Settings } from './save';

export interface StoryCtx {
  rivalId: string;
  phase: 'before' | 'after';
  won?: boolean;
  /** what to launch after the "before" dialogue */
  launch?: { screen: 'race'; params: RaceParams } | { screen: 'boss'; params: BossParams };
}

export interface AppState {
  screen: ScreenId;
  prevScreen: ScreenId;
  save: SaveData;
  loadProgress: number; // 0..1
  loaded: boolean;
  results: GameResults | null;
  story: StoryCtx | null;
  race: RaceParams | null;
  boss: BossParams | null;
  /** quick race form (persisted in memory only) */
  quick: { trackId: string; laps: number; opponents: number; difficulty: number; timeAttack: boolean };
  garageCar: string;
  /** Winamp panel shown in the menu (toggled from the top bar) */
  playerOpen: boolean;
  toast: { text: string; tone: 'info' | 'good' | 'warn'; id: number } | null;
  paused: boolean;
  /** bumps whenever the race/boss scene should be recreated */
  sessionKey: number;
  isTouch: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let state: AppState = {
  screen: 'boot',
  prevScreen: 'boot',
  save: loadSave(),
  loadProgress: 0,
  loaded: false,
  results: null,
  story: null,
  race: null,
  boss: null,
  quick: { trackId: 'neon', laps: 2, opponents: 5, difficulty: 1.0, timeAttack: false },
  garageCar: 'm5cs',
  playerOpen: true,
  toast: null,
  paused: false,
  sessionKey: 0,
  isTouch: typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
};
state.garageCar = state.save.selectedCar;

function emit(): void {
  for (const l of listeners) l();
}

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}

export function updateSave(fn: (s: SaveData) => void): void {
  const s = structuredClone(state.save);
  fn(s);
  persistSave(s);
  setState({ save: s });
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

let toastId = 0;
export function toast(text: string, tone: 'info' | 'good' | 'warn' = 'info'): void {
  setState({ toast: { text, tone, id: ++toastId } });
}

// ---------- navigation ----------

export function goto(screen: ScreenId): void {
  if (screen !== 'race' && screen !== 'boss') setHUD(null);
  setState((s) => ({ prevScreen: s.screen, screen, paused: false }));
}

export function startRace(params: RaceParams): void {
  setHUD(null);
  setState((s) => ({ race: params, boss: null, sessionKey: s.sessionKey + 1, results: null, prevScreen: s.screen, screen: 'race', paused: false }));
}

export function startBoss(params: BossParams): void {
  setHUD(null);
  setState((s) => ({ boss: params, race: null, sessionKey: s.sessionKey + 1, results: null, prevScreen: s.screen, screen: 'boss', paused: false }));
}

export function restartSession(): void {
  setHUD(null);
  setState((s) => ({ sessionKey: s.sessionKey + 1, paused: false }));
}

export function setPaused(p: boolean): void {
  setState({ paused: p });
}

/** Opens the "before" dialogue for a career stage, then launches it. */
export function startCareerStage(stageId: string): void {
  const stage = CAREER.find((c) => c.id === stageId);
  if (!stage) return;
  const save = state.save;
  if (save.careerWins.length < stage.requiresWins) return;
  const carId = save.selectedCar;
  const color = carColor(carId);
  if (stage.kind === 'boss') {
    setState({ story: { rivalId: stage.rivalId, phase: 'before', launch: { screen: 'boss', params: { carId, color } } }, prevScreen: state.screen, screen: 'story' });
  } else {
    const track = TRACK_BY_ID[stage.trackId!];
    setState({
      story: {
        rivalId: stage.rivalId,
        phase: 'before',
        launch: { screen: 'race', params: { trackId: track.id, carId, color, laps: track.laps, opponents: 5, difficulty: 1.0, career: true } },
      },
      prevScreen: state.screen,
      screen: 'story',
    });
  }
}

export function launchFromStory(): void {
  const st = state.story;
  if (!st?.launch) return;
  if (st.launch.screen === 'race') startRace(st.launch.params);
  else startBoss(st.launch.params);
}

// ---------- economy / garage ----------

export function carColor(carId: string): string {
  return state.save.colors[carId] ?? CAR_BY_ID[carId]?.colors[0] ?? '#ffffff';
}

export function setCarColor(carId: string, color: string): void {
  updateSave((s) => {
    s.colors[carId] = color;
  });
}

export function carOwned(carId: string): boolean {
  return state.save.ownedCars.includes(carId);
}

export function carUnlocked(carId: string): boolean {
  const c = CAR_BY_ID[carId];
  return !!c && state.save.careerWins.length >= c.unlockWins;
}

export function buyCar(carId: string): boolean {
  const c = CAR_BY_ID[carId];
  if (!c || carOwned(carId) || !carUnlocked(carId) || state.save.money < c.price) return false;
  updateSave((s) => {
    s.money -= c.price;
    s.ownedCars.push(carId);
    s.selectedCar = carId;
  });
  return true;
}

export function selectCar(carId: string): void {
  if (!carOwned(carId)) return;
  updateSave((s) => {
    s.selectedCar = carId;
  });
  setState({ garageCar: carId });
}

export function getUpgrades(carId: string): Upgrades {
  return { ...EMPTY_UPGRADES, ...(state.save.upgrades[carId] ?? {}) };
}

export function buyUpgrade(carId: string, key: keyof Upgrades): boolean {
  const u = getUpgrades(carId);
  if (u[key] >= 5) return false;
  const price = upgradePrice(u[key]);
  if (state.save.money < price) return false;
  updateSave((s) => {
    s.money -= price;
    s.upgrades[carId] = { ...EMPTY_UPGRADES, ...(s.upgrades[carId] ?? {}), [key]: u[key] + 1 };
  });
  return true;
}

/** CarSpec with tuning applied — what the engine actually drives. */
export function effectiveCar(carId: string): CarSpec {
  const c = CAR_BY_ID[carId] ?? CARS[0];
  const u = getUpgrades(carId);
  return {
    ...c,
    power: c.power * (1 + u.engine * 0.05),
    topSpeed: c.topSpeed * (1 + u.engine * 0.02),
    grip: c.grip * (1 + u.tires * 0.04),
    nitro: c.nitro * (1 + u.nitro * 0.08),
    handling: c.handling * (1 + u.susp * 0.04),
  };
}

export function setSettings(patch: Partial<Settings>): void {
  updateSave((s) => {
    s.settings = { ...s.settings, ...patch };
  });
}

export function resetProgress(): void {
  clearSave();
  const fresh = structuredClone(DEFAULT_SAVE);
  fresh.settings = state.save.settings;
  persistSave(fresh);
  setState({ save: fresh, garageCar: fresh.selectedCar });
}

// ---------- results ----------

export function finishSession(r: GameResults): void {
  const race = state.race;
  updateSave((s) => {
    if (r.kind === 'race') {
      s.money += r.reward.total;
      s.career.earned += r.reward.total;
      s.career.races += 1;
      s.career.driftPoints += r.driftScore;
      if (r.player.place === 1) s.career.wins += 1;
      if (r.newRecord && r.player.bestLap != null && r.player.totalTime != null) {
        s.records[r.trackId] = { initials: s.initials, bestLap: r.player.bestLap, totalTime: r.player.totalTime, carId: r.carId, date: Date.now() };
      }
      if (r.career && r.player.place === 1 && race) {
        const stage = CAREER.find((c) => c.trackId === race.trackId);
        if (stage && !s.careerWins.includes(stage.id)) {
          s.careerWins.push(stage.id);
          s.money += stage.reward;
          s.career.earned += stage.reward;
        }
      }
    } else {
      if (r.won) {
        s.money += r.reward;
        s.career.earned += r.reward;
        s.career.bossKills += 1;
        if (!s.bossDefeated) {
          s.bossDefeated = true;
          s.goldPaint = true;
          for (const c of CARS) if (!s.ownedCars.includes(c.id)) s.ownedCars.push(c.id);
          const stage = CAREER.find((c) => c.kind === 'boss');
          if (stage && !s.careerWins.includes(stage.id)) s.careerWins.push(stage.id);
        }
      }
    }
  });
  const story = state.story;
  const rivalId = story?.rivalId ?? (race?.career ? CAREER.find((c) => c.trackId === race.trackId)?.rivalId : undefined);
  const won = r.kind === 'race' ? r.player.place === 1 : r.won;
  if (rivalId && RIVALS[rivalId] && (race?.career || r.kind === 'boss')) {
    setState({ results: r, story: { rivalId, phase: 'after', won }, prevScreen: state.screen, screen: 'story' });
  } else {
    setState({ results: r, story: null, prevScreen: state.screen, screen: 'results' });
  }
}

export function setLoadProgress(p: number): void {
  setState({ loadProgress: p, loaded: p >= 1 });
}

// HUD lives in its own tiny store: it changes 10–20 times a second and must only
// re-render the HUD layer, never the whole app tree.
let hudState: HUDState | null = null;
const hudListeners = new Set<Listener>();
function subscribeHud(l: Listener): () => void {
  hudListeners.add(l);
  return () => hudListeners.delete(l);
}

export function setHUD(h: HUDState | null): void {
  if (h === hudState) return;
  hudState = h;
  for (const l of hudListeners) l();
}

export function getHUD(): HUDState | null {
  return hudState;
}

/** Selector must return a primitive or the HUD object itself (stable between updates). */
export function useHud<T>(sel: (h: HUDState | null) => T): T {
  return useSyncExternalStore(subscribeHud, () => sel(hudState), () => sel(hudState));
}

export function setInitials(v: string): void {
  updateSave((s) => {
    s.initials = v;
  });
}
