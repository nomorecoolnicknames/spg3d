// Shared types for the whole game. Keep this file dependency-free (no three imports)
// so UI, data and QA code can import it without pulling the engine.

export type ScreenId =
  | 'boot'
  | 'menu'
  | 'career'
  | 'quick'
  | 'garage'
  | 'records'
  | 'settings'
  | 'story'
  | 'race'
  | 'boss'
  | 'results';

export type TrackTheme = 'city' | 'desert' | 'snow';

export interface CarSpec {
  id: string;
  name: string;
  brand: string;
  desc: string;
  /** asset key in src/assets/cars (file name without .glb) */
  model: string;
  /** engine power, kW (arcade-scaled) */
  power: number;
  /** kg */
  mass: number;
  /** m/s at redline in top gear */
  topSpeed: number;
  /** lateral grip multiplier 0.8..1.3 */
  grip: number;
  /** steering responsiveness 0.8..1.3 */
  handling: number;
  /** how easily the rear breaks loose 0.8..1.3 (1.3 = drift car) */
  driftiness: number;
  /** nitro strength multiplier */
  nitro: number;
  /** price in $, 0 = free starter */
  price: number;
  /** career wins required (0 = available) */
  unlockWins: number;
  colors: string[];
  /** material name fragments that receive body paint (case-insensitive) */
  paintMaterials: string[];
  /** target length in meters for auto-fit */
  length: number;
  /** extra rotation around Y so that +Z is forward */
  rotateY?: number;
  /** vertical offset after auto-fit (m) */
  offsetY?: number;
  /** explicit wheel node names (front-left, front-right, rear-left, rear-right) if the model has them */
  wheelNodes?: [string, string, string, string];
}

export type UpgradeKey = 'engine' | 'tires' | 'nitro' | 'susp';

export interface Upgrades {
  engine: number;
  tires: number;
  nitro: number;
  susp: number;
}

export interface TrackEnv {
  skyTop: string;
  skyBottom: string;
  horizon: string;
  fog: string;
  fogDensity: number;
  sunColor: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  ambient: number;
  ambientColor: string;
  groundColor: string;
  roadColor: string;
  curbA: string;
  curbB: string;
  barrierColor: string;
  neonA: string;
  neonB: string;
  stars: boolean;
  aurora: boolean;
  headlights: boolean;
  /** distant city silhouettes painted into the sky dome */
  skyline?: boolean;
  /** colour grade + bloom for the post pass (render/Post.ts); missing fields use DEFAULT_GRADE */
  grade?: Partial<import('./render/Post').Grade>;
  /** scene.environmentIntensity for the track HDRI (src/assets/env) */
  envIntensity?: number;
  rain: boolean;
  snow: boolean;
  /** surface grip multiplier (ice < 1) */
  grip: number;
  /** wet reflections on the road */
  wet: boolean;
}

export interface TrackSpec {
  id: string;
  name: string;
  subtitle: string;
  desc: string;
  theme: TrackTheme;
  laps: number;
  roadWidth: number;
  /** control points [x, z, y] — y is elevation (m) */
  points: [number, number, number][];
  /** xz scale applied to the control points */
  scale?: number;
  /** drivable run-off beyond the road edge before the wall (m, default 4.6) */
  runoff?: number;
  /** dense generated centrelines want centripetal Catmull-Rom (no overshoot at uneven spacing) */
  spline?: 'catmullrom' | 'centripetal';
  /** difficulty 1..3 */
  difficulty: number;
  env: TrackEnv;
  /** career rival id (story.ts) */
  rival?: string;
  /** lap length hint for UI (m), computed at build time */
  lengthHint: number;
}

export interface RaceParams {
  trackId: string;
  carId: string;
  color: string;
  laps: number;
  opponents: number;
  /** 0.85 easy .. 1.15 hard */
  difficulty: number;
  /** career race: rival takes part, story after */
  career: boolean;
  timeAttack?: boolean;
}

export interface BossParams {
  carId: string;
  color: string;
}

export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (left positive)
  handbrake: boolean;
  nitro: boolean;
}

export interface FootInput {
  forward: number; // -1..1
  strafe: number; // -1..1 (left positive)
  lookX: number; // accumulated yaw delta this frame (radians)
  lookY: number; // accumulated pitch delta this frame (radians)
  fire: boolean;
  sprint: boolean;
}

export interface LeaderboardEntry {
  name: string;
  color: string;
  isPlayer: boolean;
  lap: number;
  /** meters behind the leader */
  gap: number;
  finished: boolean;
}

export interface MinimapDot {
  x: number; // -1..1
  y: number; // -1..1
  color: string;
  isPlayer: boolean;
}

export interface RaceHUD {
  kind: 'race';
  speedKmh: number;
  rpm: number; // 0..1 normalized
  gear: number; // 1..6, 0 = reverse
  nitro: number; // 0..100
  nitroActive: boolean;
  lap: number;
  totalLaps: number;
  position: number;
  racers: number;
  raceTime: number;
  lapTime: number;
  bestLap: number | null;
  lastLap: number | null;
  drifting: boolean;
  driftScore: number;
  driftCombo: number;
  /** current drift chain points (shown as popup while drifting) */
  driftChain: number;
  wrongWay: boolean;
  countdown: number | 'go' | null;
  started: boolean;
  finished: boolean;
  leaderboard: LeaderboardEntry[];
  minimap: MinimapDot[];
  /** sector split vs best (seconds), null if no best */
  split: number | null;
  timeAttack: boolean;
}

export interface BossHUD {
  kind: 'boss';
  playerHP: number; // 0..100
  bossHP: number; // 0..100
  bossPhase: 1 | 2 | 3;
  bossName: string;
  reload: number; // 0..1 (1 = ready)
  ammoReady: boolean;
  minions: number;
  coreExposed: boolean;
  message: string | null;
  hitFlash: number; // 0..1 decays, for damage vignette
  timer: number;
  won: boolean;
  dead: boolean;
  intro: boolean;
}

export type HUDState = RaceHUD | BossHUD;

export interface RaceResultEntry {
  name: string;
  color: string;
  isPlayer: boolean;
  place: number;
  totalTime: number | null;
  bestLap: number | null;
  finished: boolean;
}

export interface RewardBreakdown {
  place: number;
  drift: number;
  cleanLap: number;
  record: number;
  total: number;
}

export interface RaceResults {
  kind: 'race';
  trackId: string;
  carId: string;
  entries: RaceResultEntry[];
  player: RaceResultEntry;
  driftScore: number;
  reward: RewardBreakdown;
  newRecord: boolean;
  career: boolean;
  timeAttack: boolean;
}

export interface BossResults {
  kind: 'boss';
  won: boolean;
  time: number;
  reward: number;
}

export type GameResults = RaceResults | BossResults;

export type GameEvent =
  | { type: 'countdown'; value: number | 'go' | null }
  | { type: 'lap'; lap: number; total: number; lapTime: number; best: boolean }
  | { type: 'finish' }
  | { type: 'message'; text: string; tone?: 'info' | 'warn' | 'good' }
  | { type: 'drift-end'; points: number; combo: number }
  | { type: 'overtake'; position: number }
  | { type: 'boss-phase'; phase: number }
  | { type: 'boss-dead' }
  | { type: 'player-dead' };

export interface SceneCallbacks {
  onHUD: (h: HUDState) => void;
  onEvent: (e: GameEvent) => void;
  onFinish: (r: GameResults) => void;
}

export interface QualitySettings {
  level: 'low' | 'medium' | 'high';
  shadows: boolean;
  bloom: boolean;
  reflections: boolean;
  pixelRatio: number;
}

export interface SpgSnapshot {
  screen: ScreenId;
  hud: HUDState | null;
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  playerPos?: [number, number, number];
  playerSpeed?: number;
  extra?: Record<string, unknown>;
  extra2?: Record<string, unknown>;
}
