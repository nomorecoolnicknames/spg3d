import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPost, DEFAULT_GRADE, type Post } from '../render/Post';
import type { SceneController, Viewport } from '../Viewport';
import type { CarInput, CarSpec, LeaderboardEntry, RaceHUD, RaceParams, RaceResultEntry, SceneCallbacks, SpgSnapshot } from '../types';
import { TrackData, SECTORS } from '../world/TrackData';
import { buildTrackMesh, type TrackMesh } from '../world/TrackMesh';
import { createSky, type SkyRig } from '../world/Sky';
import { createWeather, type WeatherRig } from '../world/Weather';
import { buildProps, type PropsRig } from '../world/Props';
import { CarPhysics } from '../vehicle/CarPhysics';
import { createCarVisual, type CarVisual } from '../vehicle/CarVisual';
import { getEnvMap, type EnvName } from '../assets';
import { buildCity } from '../world/city/City';
import { buildOsmCity } from '../world/osm/OsmCity';
import { LampField } from '../render/LampField';
import { roadHeadlights, roadTime } from '../world/RoadMaterial';
import { CarGlows } from '../render/CarGlows';
import { buildCanyonFeatures } from '../world/features/Canyon';
import { buildAlpineFeatures } from '../world/features/Alpine';
import { RacerAI, type AIContext, type AIOther } from '../ai/RacerAI';
import { RaceCamera } from './RaceCamera';
import { Smoke, Sparks, SkidMarks } from './Fx';
import { Traffic } from './Traffic';
import { buildCrowd, type CrowdRig } from '../world/Crowd';
import { input } from '../input/Input';
import { audio } from '../audio';
import type { EngineVoice } from '../audio/api';
import { AI_DRIVERS, CAR_BY_ID, CARS } from '@/data/cars';
import { TRACKS, TRACK_BY_ID } from '@/data/tracks';
import { getMapWorld } from '@/data/maps';
import { RIVALS } from '@/data/story';
import { S } from '@/data/strings';
import { effectiveCar, getState } from '@/state/store';

const PHYS_DT = 1 / 120;
const PLACE_PRIZE = [3000, 1800, 1200, 800, 500, 350, 250, 150];

interface Racer {
  name: string;
  color: string;
  isPlayer: boolean;
  spec: CarSpec;
  car: CarPhysics;
  vis: CarVisual;
  ai: RacerAI | null;
  engine: EngineVoice | null;
  idx: number;
  lat: number;
  progress: number;
  lap: number;
  nextSector: number;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  finished: boolean;
  /** the easter-egg flight was used during this lap: it counts, but not as a best lap or record */
  flewThisLap: boolean;
  finishTime: number | null;
  wallHitsThisLap: number;
  wrongWayT: number;
  lastGear: number;
  input: CarInput;
  /** recorded transforms for the ghost (player only, time attack) */
  rec: Float32Array | null;
  recN: number;
}

function engineProfile(spec: CarSpec): 'v8' | 'i6-turbo' | 'v6' | 'w16' | 'v12' {
  switch (spec.id) {
    case 'supra':
      return 'i6-turbo';
    case 'lancia':
      return 'v6';
    case 'bolide':
      return 'w16';
    default:
      return 'v8';
  }
}

export class RaceScene implements SceneController {
  private scene = new THREE.Scene();
  private cam!: RaceCamera;
  private vp!: Viewport;
  private track!: TrackData;
  private mesh!: TrackMesh;
  private sky!: SkyRig;
  private weather: WeatherRig | null = null;
  private props!: PropsRig;
  private features: PropsRig | null = null;
  private lampField: LampField | null = null;
  private glows: CarGlows | null = null;
  private lampFocus = new THREE.Vector3();
  private sun!: THREE.DirectionalLight;
  private post: Post | null = null;
  private racers: Racer[] = [];
  private player!: Racer;
  private smoke!: Smoke;
  private sparks!: Sparks;
  private skids!: SkidMarks;
  private pmrem: THREE.Texture | null = null;
  private acc = 0;
  private elapsed = 0;
  private raceTime = 0;
  private countdownT = 3.999;
  private countdownShown: number | 'go' | null = null;
  private started = false;
  private finishT = -1;
  private resultsSent = false;
  private paused = false;
  private hudT = 0;
  private driftChain = 0;
  private driftCombo = 1;
  private driftT = 0;
  private driftOffT = 0;
  private driftScore = 0;
  private cleanLaps = 0;
  private lastPosition = 0;
  private wrongWay = false;
  private nitroWas = false;
  private ghost: CarVisual | null = null;
  private ghostRec: Float32Array | null = null;
  private ghostN = 0;
  private ghostLapTime = 0;
  private bestRecordLap: number | null;
  private disposed = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private splitT = -1;
  private split: number | null = null;
  private bestSectorTimes: number[] | null = null;
  private curSectorTimes: number[] = [];
  private aiOthers: AIOther[] = [];
  /** F: free flight through everything (debug / sightseeing), laps are not counted */
  private fly = false;
  private flySpeed = 0;
  private flyProbe = 0;
  private viewOverride: [number, number, number, number, number, number] | null = null;
  private aiCtx: AIContext = { progress: 0, lat: 0, others: this.aiOthers, selfIndex: -1, canDrive: false };
  private traffic: Traffic | null = null;
  private crowd: CrowdRig | null = null;

  constructor(
    public params: RaceParams,
    public cb: SceneCallbacks,
  ) {
    const rec = getState().save.records[params.trackId];
    this.bestRecordLap = rec?.bestLap ?? null;
  }

  start(vp: Viewport): void {
    this.vp = vp;
    const spec = TRACK_BY_ID[this.params.trackId] ?? TRACKS[0];
    const env = spec.env;
    // by day shadows carry the picture: on from the medium tier (one 1024 map following the car)
    const q = !env.headlights && vp.quality.level !== 'low' ? { ...vp.quality, shadows: true } : vp.quality;
    vp.renderer.shadowMap.enabled = q.shadows;
    this.track = new TrackData(spec);
    this.scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
    this.scene.background = new THREE.Color(env.fog);

    // environment reflections: the track's HDRI (cached for the session), RoomEnvironment if it failed
    const envTex = getEnvMap(vp.renderer, spec.envMap ?? (spec.id as EnvName));
    if (envTex) this.scene.environment = envTex;
    else {
      const pm = new THREE.PMREMGenerator(vp.renderer);
      this.pmrem = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      this.scene.environment = this.pmrem;
    }
    this.scene.environmentIntensity = env.envIntensity ?? (env.headlights ? 0.35 : 0.8);

    // lights
    this.sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
    this.sun.castShadow = q.shadows;
    const sm = q.level === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -55;
    sc.right = 55;
    sc.top = 55;
    sc.bottom = -55;
    sc.near = 10;
    sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(env.skyBottom, env.groundColor, env.ambient));
    this.scene.add(new THREE.AmbientLight(env.ambientColor, 0.35));

    // world
    this.sky = createSky(env);
    this.scene.add(this.sky.group);
    this.mesh = buildTrackMesh(this.track, { shadows: q.shadows, low: q.level === 'low' });
    this.scene.add(this.mesh.group);
    const world = spec.map ? getMapWorld(spec.map) : undefined;
    const worldT0 = performance.now();
    const osm = world ? buildOsmCity(this.track, world, q, { night: env.headlights }) : null;
    this.props = osm ?? (spec.theme === 'city' ? buildCity(this.track, q) : buildProps(this.track, this.mesh.terrainHeight, { shadows: q.shadows, level: q.level }));
    const worldMs = Math.round(performance.now() - worldT0);
    // QA: how long the world took to build (phones are a few times slower than the headless desktop)
    window.__spg.knobs.worldStats = () => ({ ms: worldMs, ...(osm?.stats ?? {}) });
    this.scene.add(this.props.group);
    if (spec.theme === 'desert' && spec.features) this.features = buildCanyonFeatures(this.track, this.mesh.terrainHeight, q);
    if (spec.theme === 'snow' && spec.features) this.features = buildAlpineFeatures(this.track, this.mesh.terrainHeight, q);
    if (this.features) this.scene.add(this.features.group);
    // street lamps light cars and wet asphalt; halos on every lamp head
    const lamps = [...(this.props.lamps ?? []), ...(this.features?.lamps ?? [])];
    if (lamps.length && new URLSearchParams(location.search).get('lamps') !== '0') {
      this.lampField = new LampField(lamps);
      if (this.lampField.halos) this.scene.add(this.lampField.halos);
    }
    // spectators behind the barriers
    if (q.level !== 'low') {
      this.crowd = buildCrowd(this.track, { count: q.level === 'high' ? 420 : 240, shadows: q.shadows });
      this.scene.add(this.crowd.group);
    }
    // city traffic to dodge (?traffic=0 turns it off for QA frame comparisons)
    const trafficCount = q.level === 'low' ? 0 : q.level === 'medium' ? 5 : 9;
    if (spec.theme === 'city' && trafficCount && new URLSearchParams(location.search).get('traffic') !== '0') {
      this.traffic = new Traffic(this.track, { count: trafficCount, shadows: q.shadows, night: env.headlights, lod: q.level === 'high' ? 2 : 3 });
      this.scene.add(this.traffic.group);
    }
    // ?weather=0: no rain/snow particles (QA frame comparisons)
    if ((env.rain || env.snow) && new URLSearchParams(location.search).get('weather') !== '0') {
      this.weather = createWeather(env.rain ? 'rain' : 'snow', q.level === 'low' ? 350 : 1600);
      this.scene.add(this.weather.group);
    }

    // fx
    this.smoke = new Smoke(200, spec.theme === 'desert' ? '#b8905f' : spec.theme === 'snow' ? '#dfe8f0' : '#6a6a74');
    this.sparks = new Sparks();
    this.skids = new SkidMarks();
    this.scene.add(this.smoke.mesh, this.sparks.points, this.skids.mesh);

    // racers
    const playerSpec = effectiveCar(this.params.carId);
    const total = this.params.timeAttack ? 1 : this.params.opponents + 1;
    const rival = this.params.career && spec.rival ? RIVALS[spec.rival] : null;
    const drivers = [...AI_DRIVERS].filter((d) => !rival || d.name !== rival.name);
    const carPool = CARS.filter((c) => c.id !== 'bolide');
    for (let i = 0; i < total; i++) {
      const gridIdx = (this.track.count - 8 - i * 6 + this.track.count) % this.track.count;
      const lat = (i % 2 === 0 ? 1 : -1) * 2.7;
      const isPlayer = i === 0;
      let name: string, color: string, cspec: CarSpec, skill = 1;
      if (isPlayer) {
        name = 'ВЫ';
        color = this.params.color;
        cspec = playerSpec;
      } else if (rival && i === 1) {
        name = rival.name;
        color = rival.color;
        cspec = CAR_BY_ID[rival.carId] ?? carPool[0];
        skill = rival.skill;
      } else {
        const d = drivers[(i - 1) % drivers.length];
        name = d.name;
        color = d.color;
        cspec = carPool[(i * 2 + 1) % carPool.length];
        skill = d.skill;
      }
      const car = new CarPhysics(cspec);
      const s = this.track.samples[gridIdx];
      car.place(s.pos.x + s.left.x * lat, s.pos.z + s.left.z * lat, s.pos.y, this.track.headingAt(gridIdx));
      const vis = createCarVisual(cspec, color, {
        player: isPlayer,
        shadows: q.shadows,
        night: env.headlights,
        hd: isPlayer && q.level !== 'low',
        physical: q.level === 'high',
        opaqueGlass: q.level === 'low',
        lod: isPlayer ? (q.level === 'high' ? 0 : 1) : 2,
      });
      this.scene.add(vis.root, ...vis.extras);
      const r: Racer = {
        name, color, isPlayer, spec: cspec, car, vis,
        ai: isPlayer ? null : new RacerAI(this.track, skill, this.params.difficulty, 0.4 + Math.random() * 0.5),
        engine: null,
        idx: gridIdx, lat, progress: gridIdx, lap: 0, nextSector: 0, lapStart: 0, lastLap: null, bestLap: null,
        finished: false, finishTime: null, wallHitsThisLap: 0, flewThisLap: false, wrongWayT: 0, lastGear: 1,
        input: { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false },
        rec: isPlayer && this.params.timeAttack ? new Float32Array(20 * 240 * 4) : null,
        recN: 0,
      };
      r.engine = audio.createEngine(engineProfile(cspec));
      this.racers.push(r);
      if (isPlayer) this.player = r;
    }
    // race grid: player starts last for career/quick races
    this.racers.sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    if (env.headlights) {
      this.glows = new CarGlows(this.racers.length);
      this.scene.add(this.glows.points);
    }
    this.racers.forEach((r, i) => {
      const gridIdx = (this.track.count - 8 - i * 6 + this.track.count) % this.track.count;
      const lat = (i % 2 === 0 ? 1 : -1) * 2.7;
      const s = this.track.samples[gridIdx];
      r.car.place(s.pos.x + s.left.x * lat, s.pos.z + s.left.z * lat, s.pos.y, this.track.headingAt(gridIdx));
      r.idx = gridIdx;
      r.progress = gridIdx;
      r.lat = lat;
      this.syncVisual(r, 0);
    });

    // camera + post
    this.cam = new RaceCamera(vp.width / vp.height);
    this.cam.mode = getState().save.settings.camera;
    this.cam.fovKick = getState().save.settings.fovKick;
    this.cam.snapTo(this.player.car);
    this.smoke.setCamera(this.cam.camera);
    this.buildComposer();

    input.reset();
    input.pointerLockWanted = false;
    audio.duckMusic(0.35, 0.3);
    if (env.rain) audio.loop('rain', true, 0.5);
    if (spec.theme === 'snow') audio.loop('wind', true, 0.35);
    this.sendHUD();
    window.__spg.knobs.skipCountdown = () => {
      this.countdownT = 0.01;
    };
    window.__spg.knobs.probe = () => {
      const c = this.player.car;
      const s = this.track.samples[this.player.idx];
      const box = new THREE.Box3().setFromObject(this.mesh.road);
      const wheels = { lod: this.player.vis.lod };
      const ray = new THREE.Raycaster(new THREE.Vector3(c.x, c.y + 5, c.z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObjects(this.mesh.group.children, true).map((h) => ({ name: h.object.name || h.object.type, y: +h.point.y.toFixed(3) }));
      const rp = this.mesh.road.geometry.attributes.position.array as Float32Array;
      let best = Infinity, bi = 0;
      for (let i = 0; i < rp.length; i += 3) { const d = (rp[i] - c.x) ** 2 + (rp[i + 2] - c.z) ** 2; if (d < best) { best = d; bi = i; } }
      const ri = this.mesh.road.geometry.index!.array;
      let nan = 0;
      for (let i = 0; i < rp.length; i++) if (!Number.isFinite(rp[i])) nan++;
      const ray2 = new THREE.Raycaster(new THREE.Vector3(rp[bi], rp[bi + 1] + 5, rp[bi + 2] + 0.01), new THREE.Vector3(0, -1, 0));
      const roadHit = ray2.intersectObject(this.mesh.road, false).map((h) => +h.point.y.toFixed(3));
      const bs = this.mesh.road.geometry.boundingSphere;
      const nearest = { roadHit, nan, idx0: Array.from(ri.slice(0, 6)), idxCount: ri.length, bs: bs ? [+bs.center.x.toFixed(1), +bs.center.y.toFixed(1), +bs.center.z.toFixed(1), +bs.radius.toFixed(1)] : null, roadMatSide: (this.mesh.road.material as THREE.Material).side, dist: Math.sqrt(best), v: [rp[bi], rp[bi + 1], rp[bi + 2]], count: rp.length / 3, car: [c.x, c.y, c.z], sample: [s.pos.x, s.pos.y, s.pos.z], left: [s.left.x, s.left.z], first: [rp[0], rp[1], rp[2]] };
      return { nearest, hits, wheels, wheelSpin: c.wheelSpin, carY: c.y, sampleY: s.pos.y, terrainY: this.mesh.terrainHeight(c.x, c.z), roadVisible: this.mesh.road.visible, roadBoxY: [box.min.y, box.max.y], roadTris: (this.mesh.road.geometry.index?.count ?? 0) / 3, groupChildren: this.mesh.group.children.length, camY: this.cam.camera.position.y, mat: (() => { const m = this.mesh.road.material as THREE.MeshStandardMaterial; const img = m.map?.image as HTMLCanvasElement | undefined; return { hasMap: !!m.map, imgW: img?.width, color: m.color.getHexString(), rough: m.roughness, metal: m.metalness, visible: m.visible, opacity: m.opacity, transparent: m.transparent, uv: !!this.mesh.road.geometry.attributes.uv, uvSample: Array.from((this.mesh.road.geometry.attributes.uv.array as Float32Array).slice(0, 8)) }; })() };
    };
    window.__spg.knobs.hide = (name: unknown) => {
      const o = this.mesh.group.getObjectByName(String(name));
      if (o) o.visible = !o.visible;
      return o ? o.visible : null;
    };
    // QA tour: put the player at a lap fraction, rolling at the racing-line speed (lap counting is not touched)
    window.__spg.knobs.warp = (u: unknown) => {
      const r = this.player;
      const idx = Math.floor(((Number(u) % 1) + 1) % 1 * this.track.count);
      const s = this.track.samples[idx];
      r.car.place(s.pos.x + s.left.x * s.lineOffset, s.pos.z + s.left.z * s.lineOffset, s.pos.y, this.track.headingAt(idx));
      r.car.vx = Math.min(s.lineSpeed, 30);
      r.idx = idx;
      r.lat = s.lineOffset;
      r.progress = Math.floor(r.progress / this.track.count) * this.track.count + idx;
      this.cam.update(r.car, 1, this.elapsed);
      return idx;
    };
    // QA: look at the world from a fixed point (landmark shots); call without arguments to release
    window.__spg.knobs.viewFrom = (...a: unknown[]) => {
      this.viewOverride = a.length >= 6 ? (a.slice(0, 6).map(Number) as [number, number, number, number, number, number]) : null;
    };
    window.__spg.knobs.finishNow = () => {
      this.player.lap = this.params.laps;
      this.player.finished = true;
      this.player.finishTime = this.raceTime;
      this.finishT = 0;
    };
    vp.warmup(this.scene, this.cam.camera);
  }

  private buildComposer(): void {
    this.post?.dispose();
    this.post = createPost(this.vp, this.track.spec.env.grade);
    this.post?.setSize(this.vp.width, this.vp.height);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) for (const r of this.racers) r.engine?.update({ rpm: 0.2, throttle: 0, gear: 1, speed: 0, nitro: false, slip: 0, scraping: false, distance: 1 });
  }

  targetFps(): number | undefined {
    return this.paused ? 0 : undefined;
  }

  setCameraMode(m: number): void {
    this.cam.mode = m < 0 ? (this.cam.mode + 1) % 4 : m % 4;
    this.cb.onEvent({ type: 'message', text: S.race.cameras[this.cam.mode], tone: 'info' });
  }

  toggleFly(): void {
    this.fly = !this.fly;
    const r = this.player;
    if (this.fly) {
      this.flySpeed = Math.max(0, r.car.vx);
      this.cb.onEvent({ type: 'message', text: S.race.flyOn, tone: 'info' });
    } else {
      // land on the nearest point of the track
      const p = this.track.projectGlobal(r.car.x, r.car.z);
      r.idx = p.idx;
      r.progress = Math.floor(r.progress / this.track.count) * this.track.count + p.idx;
      const s = this.track.samples[p.idx];
      const lat = THREE.MathUtils.clamp(p.lat, -this.track.halfW, this.track.halfW);
      r.car.place(s.pos.x + s.left.x * lat, s.pos.z + s.left.z * lat, s.pos.y, this.track.headingAt(p.idx));
      r.lat = lat;
      // the anti-shortcut sector chain restarts where the car lands, so the next line crossing completes the lap
      r.nextSector = s.sector + 1;
      r.flewThisLap = true;
      this.cb.onEvent({ type: 'message', text: S.race.flyOff, tone: 'info' });
    }
  }

  respawn(): void {
    const r = this.player;
    const idx = Math.floor(r.progress % this.track.count);
    const s = this.track.samples[idx];
    r.car.place(s.pos.x + s.left.x * s.lineOffset * 0.5, s.pos.z + s.left.z * s.lineOffset * 0.5, s.pos.y, this.track.headingAt(idx));
    r.wrongWayT = 0;
  }

  resize(w: number, h: number): void {
    this.cam.resize(w / h);
    this.post?.setSize(w, h);
  }

  // ---------------------------------------------------------------- update
  update(dt: number, _elapsed: number): void {
    if (this.disposed) return;
    this.elapsed += dt;
    if (this.paused) return;

    // countdown
    if (!this.started) {
      const prev = Math.ceil(this.countdownT);
      this.countdownT -= dt;
      const cur = Math.max(0, Math.ceil(this.countdownT));
      if (cur !== prev) {
        if (cur > 0) {
          this.countdownShown = cur;
          audio.play('count-beep');
          this.cb.onEvent({ type: 'countdown', value: cur });
        } else {
          this.started = true;
          this.countdownShown = 'go';
          audio.play('count-go');
          audio.duckMusic(1, 1.2);
          this.cb.onEvent({ type: 'countdown', value: 'go' });
          for (const r of this.racers) r.lapStart = 0;
          window.setTimeout(() => {
            if (!this.disposed) {
              this.countdownShown = null;
              this.cb.onEvent({ type: 'countdown', value: null });
            }
          }, 900);
        }
      }
    } else if (this.finishT < 0 || this.finishT < 2.5) {
      this.raceTime += dt;
    }

    // fixed-step simulation
    this.acc += dt;
    let steps = 0;
    // at most ~66 ms of simulation per frame: a slow frame must not snowball into slower frames
    // (QA runs with a large maxDt/timeScale and needs the old catch-up budget)
    const maxSteps = this.vp.maxDt > 0.1 || this.vp.timeScale !== 1 ? 240 : 8;
    while (this.acc >= PHYS_DT && steps < maxSteps) {
      this.stepAll(PHYS_DT);
      this.acc -= PHYS_DT;
      steps++;
    }
    if (steps === maxSteps) this.acc = 0;

    // finish sequence
    if (this.finishT >= 0 && !this.resultsSent) {
      this.finishT += dt;
      if (this.finishT > 2.6) {
        this.resultsSent = true;
        this.sendResults();
      }
    }

    // visuals
    for (const r of this.racers) this.syncVisual(r, dt);
    this.updateGhost(dt);
    if (this.viewOverride) {
      const [x, y, z, tx, ty, tz] = this.viewOverride;
      this.cam.camera.position.set(x, y, z);
      this.cam.camera.lookAt(tx, ty, tz);
    } else this.cam.update(this.player.car, dt, this.elapsed);
    const pp = this.player.car;
    this.sun.position.set(pp.x, pp.y, pp.z).addScaledVector(this.tmp.set(...this.track.spec.env.sunDir).normalize(), 220);
    this.sun.target.position.set(pp.x, pp.y, pp.z);
    this.sky.update(this.elapsed);
    roadTime.value = this.elapsed;
    {
      // the player's low beams light the road ahead at night (road shader)
      const pc = this.player.car;
      roadHeadlights.pos.value.set(pc.x + pc.forwardX * pc.length * 0.45, pc.y + 0.7, pc.z + pc.forwardZ * pc.length * 0.45, this.track.spec.env.headlights ? 1 : 0);
      roadHeadlights.dir.value.set(pc.forwardX, 0, pc.forwardZ);
    }
    if (this.lampField) {
      // the lamps that matter are the ones just ahead of the camera
      const cam = this.cam.camera;
      cam.getWorldDirection(this.lampFocus);
      this.lampFocus.multiplyScalar(22).add(cam.position);
      this.lampField.update(this.lampFocus);
    }
    this.props.update(this.elapsed);
    this.features?.update(this.elapsed);
    this.weather?.update(dt, this.cam.camera.position, this.tmp2.set(pp.forwardX * pp.vx, 0, pp.forwardZ * pp.vx));
    this.smoke.update(dt);
    this.sparks.update(dt);
    if (this.post) {
      const want = (this.track.spec.env.grade?.bloom ?? DEFAULT_GRADE.bloom) + (pp.nitroActive ? 0.35 : 0);
      this.post.grade.bloom += (want - this.post.grade.bloom) * Math.min(1, dt * 5);
    }

    // audio
    for (const r of this.racers) {
      const c = r.car;
      const d = r.isPlayer ? 0 : Math.min(1, Math.hypot(c.x - pp.x, c.z - pp.z) / 90);
      r.engine?.update({
        rpm: c.rpm, throttle: r.input.throttle, gear: c.gear, speed: Math.abs(c.vx), nitro: c.nitroActive,
        slip: r.isPlayer ? c.slip : c.slip * 0.6, scraping: c.scraping, distance: d,
        turbo: r.spec.id === 'supra' ? c.rpm * r.input.throttle : 0,
      });
    }

    // HUD ~20 Hz
    this.hudT += dt;
    if (this.hudT > (this.vp.quality.level === 'low' ? 0.09 : 0.05)) {
      this.hudT = 0;
      this.sendHUD();
    }
  }

  private stepAll(dt: number): void {
    const canDrive = this.started;
    const n = this.track.count;
    const autopilot = window.__spg?.autopilot;
    const playerProg = this.player.progress;
    // snapshot for AI avoidance, updated in place (no per-step allocations)
    const others = this.aiOthers;
    for (let i = 0; i < this.racers.length; i++) {
      const o = this.racers[i];
      const snap = (others[i] ??= { progress: 0, lat: 0, speed: 0, isPlayer: false });
      snap.progress = o.progress;
      snap.lat = o.lat;
      snap.speed = o.car.speed;
      snap.isPlayer = o.isPlayer;
    }
    others.length = this.racers.length;
    // the AI treats traffic as slow cars on the route: same avoidance, same overtaking
    this.traffic?.forEachObstacle((progress, lat, speed) => {
      const snap = (others[others.length] ??= { progress: 0, lat: 0, speed: 0, isPlayer: false });
      snap.progress = progress;
      snap.lat = lat;
      snap.speed = Math.abs(speed);
      snap.isPlayer = false;
    });
    for (let ri = 0; ri < this.racers.length; ri++) {
      const r = this.racers[ri];
      // inputs
      if (r.isPlayer && !autopilot) {
        r.input = input.car(dt);
        if (r.finished) r.input = { steer: 0, throttle: 0, brake: 0.4, handbrake: false, nitro: false };
      } else {
        if (!r.ai) r.ai = new RacerAI(this.track, 1.0, this.params.difficulty, 0.5);
        const ctx = this.aiCtx;
        ctx.progress = r.progress;
        ctx.lat = r.lat;
        ctx.selfIndex = ri;
        ctx.playerProgress = r.isPlayer ? undefined : playerProg;
        ctx.canDrive = canDrive && !r.finished;
        r.input = r.ai.drive(r.car, ctx, dt);
        if (r.finished) r.input.throttle = Math.min(r.input.throttle, 0.4);
        if (r.ai.wantsRespawn) {
          // wedged against a barrier or another car: put it back on the racing line where it stands
          r.ai.wantsRespawn = false;
          const si = Math.floor(r.progress) % this.track.count;
          const sm = this.track.samples[si];
          r.car.place(sm.pos.x + sm.left.x * sm.lineOffset, sm.pos.z + sm.left.z * sm.lineOffset, sm.pos.y, this.track.headingAt(si));
        }
      }
      if (r.isPlayer && this.fly) {
        r.flewThisLap = true;
        this.flyStep(r, dt);
        continue;
      }
      // physics
      const s0 = this.track.samples[r.idx];
      const slopeAlong = s0.slope * ((r.car.forwardX * s0.tan.x + r.car.forwardZ * s0.tan.z) / Math.max(1e-3, Math.hypot(s0.tan.x, s0.tan.z)));
      const c = r.car;
      const gearBefore = c.gear;
      c.step(r.input, dt, { grip: this.track.spec.env.grip, slopeAlong }, canDrive);
      if (r.isPlayer && c.gear !== gearBefore && c.gear > 1 && c.gear > gearBefore) audio.play('gear-shift', { gain: 0.5 });
      // projection + walls
      const p = this.track.project(c.x, c.z, r.idx, 14);
      const s = this.track.samples[p.idx];
      // the barrier stops the car's rotated footprint, not a point with half a width
      const maxLat = this.track.barrierFace - c.extentAlong(s.left.x, s.left.z);
      c.scraping = false;
      if (Math.abs(p.lat) > maxLat) {
        const sgn = Math.sign(p.lat);
        c.x -= s.left.x * (p.lat - sgn * maxLat);
        c.z -= s.left.z * (p.lat - sgn * maxLat);
        const into = c.hitWall(-s.left.x * sgn, -s.left.z * sgn);
        c.scraping = c.speed > 4;
        if (into > 2.5) {
          r.wallHitsThisLap++;
          const ext = c.extentAlong(s.left.x, s.left.z);
          const hp = this.tmp.set(c.x + s.left.x * sgn * ext, c.y + 0.4, c.z + s.left.z * sgn * ext);
          this.sparks.burst(hp, this.tmp2.set(c.forwardX, 0, c.forwardZ), Math.min(40, 6 + into * 2), 6 + into * 0.5);
          if (r.isPlayer) {
            this.cam.shake = Math.min(1, this.cam.shake + into * 0.06);
            audio.play('hit-wall', { gain: Math.min(1, 0.3 + into * 0.05) });
          } else {
            const d = Math.hypot(c.x - this.player.car.x, c.z - this.player.car.z);
            if (d < 60) audio.play('hit-wall', { gain: Math.min(0.6, into * 0.03) * (1 - d / 60) });
          }
        } else if (c.scraping && r.isPlayer && Math.random() < dt * 8) {
          this.sparks.burst(this.tmp.set(c.x + s.left.x * sgn * c.width * 0.5, c.y + 0.3, c.z + s.left.z * sgn * c.width * 0.5), this.tmp2.set(-c.forwardX, 0, -c.forwardZ), 3, 4);
        }
        p.lat = sgn * maxLat;
      }
      c.y = p.y;
      r.lat = p.lat;
      // sectors / laps (with wrong-way guard)
      const sector = s.sector;
      const prevIdx = r.idx;
      r.idx = p.idx;
      if (sector === r.nextSector % SECTORS) {
        if (sector === 0 && r.nextSector === SECTORS) this.completeLap(r);
        r.nextSector = sector + 1;
        if (r.isPlayer && this.started && !r.finished) this.sectorSplit(sector);
      }
      const backwards = ((prevIdx - p.idx + n) % n) > 0 && ((prevIdx - p.idx + n) % n) < n / 2 && c.vx > 3;
      // progress: monotonic-ish (lap based), allows small backward motion
      const lapBase = r.lap * n;
      let within = p.progress;
      if (r.nextSector <= 1 && p.idx > n * 0.5) within -= n; // just before the line but counted in previous lap
      r.progress = lapBase + within;
      // wrong way (player only)
      if (r.isPlayer) {
        const dot = c.forwardX * s.tan.x + c.forwardZ * s.tan.z;
        if (dot < -0.2 && c.vx > 4 && backwards) r.wrongWayT += dt;
        else r.wrongWayT = Math.max(0, r.wrongWayT - dt * 2);
        this.wrongWay = r.wrongWayT > 1.2;
      }
    }
    // car-car collisions
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        const imp = CarPhysics.collide(a.car, b.car);
        if (imp > 2 && (a.isPlayer || b.isPlayer)) {
          this.cam.shake = Math.min(1, this.cam.shake + imp * 0.05);
          audio.play('hit-car', { gain: Math.min(1, 0.25 + imp * 0.06) });
          const mid = this.tmp.set((a.car.x + b.car.x) / 2, a.car.y + 0.5, (a.car.z + b.car.z) / 2);
          this.sparks.burst(mid, this.tmp2.set(0, 0, 0), 10, 4);
        }
      }
    }
    // drift scoring + nitro recharge + fx (player)
    this.updateDrift(dt);
    // position change events
    if (this.started && !this.player.finished) {
      const pos = this.position(this.player);
      if (this.lastPosition && pos < this.lastPosition) {
        audio.play('overtake', { gain: 0.6 });
        this.cb.onEvent({ type: 'overtake', position: pos });
      }
      this.lastPosition = pos;
    }
    // ghost recording (time attack)
    const pr = this.player;
    if (pr.rec && this.started && !pr.finished) {
      const slot = Math.floor((this.raceTime - pr.lapStart) * 20);
      if (slot * 4 + 3 < pr.rec.length && slot >= pr.recN) {
        pr.rec[slot * 4] = pr.car.x;
        pr.rec[slot * 4 + 1] = pr.car.y;
        pr.rec[slot * 4 + 2] = pr.car.z;
        pr.rec[slot * 4 + 3] = pr.car.heading;
        pr.recN = slot + 1;
      }
    }
    // nitro sfx
    const nOn = pr.car.nitroActive;
    if (nOn !== this.nitroWas) {
      audio.play(nOn ? 'nitro-start' : 'nitro-end', { gain: 0.7 });
      this.nitroWas = nOn;
    }
  }

  private sectorSplit(sector: number): void {
    const t = this.raceTime - this.player.lapStart;
    if (sector === 0) return;
    this.curSectorTimes[sector] = t;
    if (this.bestSectorTimes && this.bestSectorTimes[sector] != null) {
      this.split = t - this.bestSectorTimes[sector];
      this.splitT = 2.5;
    }
  }

  private completeLap(r: Racer): void {
    if (!this.started || r.finished) return;
    const lapTime = this.raceTime - r.lapStart;
    // r.lap = laps completed; a crossing seconds after the start is not a lap
    if (lapTime <= 5) return;
    r.lap++;
    r.lastLap = lapTime;
    const counts = !r.flewThisLap;
    const best = counts && (r.bestLap === null || lapTime < r.bestLap);
    if (best) r.bestLap = lapTime;
    if (r.isPlayer) {
      const clean = r.wallHitsThisLap === 0;
      if (clean) this.cleanLaps++;
      r.car.nitro = Math.min(100, r.car.nitro + 25);
      this.cb.onEvent({ type: 'lap', lap: r.lap, total: this.params.laps, lapTime, best });
      audio.play(best && r.lap > 1 ? 'best-lap' : 'lap');
      if (this.params.laps > 1 && r.lap === this.params.laps - 1) this.cb.onEvent({ type: 'message', text: S.race.finalLap, tone: 'warn' });
      // sector bests + ghost
      if (best) {
        this.bestSectorTimes = [...this.curSectorTimes];
        if (r.rec) {
          this.ghostRec = r.rec.slice(0, r.recN * 4);
          this.ghostN = r.recN;
          this.ghostLapTime = lapTime;
          if (!this.ghost) this.spawnGhost();
        }
      }
      this.curSectorTimes = [];
      r.recN = 0;
    }
    r.lapStart = this.raceTime;
    r.wallHitsThisLap = 0;
    r.flewThisLap = false;
    if (r.lap >= this.params.laps) {
      r.finished = true;
      r.finishTime = this.raceTime;
      if (r.isPlayer) {
        this.finishT = 0;
        audio.play('finish');
        audio.duckMusic(0.5, 0.5);
        this.cb.onEvent({ type: 'finish' });
      }
    }
  }

  private updateDrift(dt: number): void {
    const r = this.player;
    const c = r.car;
    if (c.drifting && this.started && !r.finished) {
      this.driftT += dt;
      this.driftOffT = 0;
      const pts = Math.abs(c.vx) * Math.min(1.6, Math.abs(c.vy) * 0.18 + 0.4) * 2.2 * dt;
      this.driftChain += pts;
      this.driftCombo = 1 + Math.floor(this.driftT / 2.0);
      c.nitro = Math.min(100, c.nitro + 11 * dt);
    } else if (this.driftChain > 0) {
      this.driftOffT += dt;
      if (this.driftOffT > 0.8) {
        const gained = Math.round(this.driftChain * this.driftCombo);
        this.driftScore += gained;
        this.cb.onEvent({ type: 'drift-end', points: gained, combo: this.driftCombo });
        if (gained > 150) audio.play('drift-score', { gain: Math.min(1, 0.4 + gained / 2000) });
        this.driftChain = 0;
        this.driftT = 0;
        this.driftCombo = 1;
      }
    }
    // smoke + skids for every drifting/spinning car (visual parity)
    for (const rr of this.racers) {
      const cc = rr.car;
      const slipping = cc.slip > 0.55 && cc.speed > 6;
      if (slipping) {
        const rate = rr.isPlayer ? 34 : 14;
        if (Math.random() < dt * rate * cc.slip) {
          const side = Math.sign(cc.vy || 1);
          const p = this.tmp.set(cc.x - cc.forwardX * cc.wheelbase * 0.5 + cc.leftX * side * cc.width * 0.5, cc.y + 0.25, cc.z - cc.forwardZ * cc.wheelbase * 0.5 + cc.leftZ * side * cc.width * 0.5);
          const v = this.tmp2.set(cc.leftX * cc.vy * 0.25 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), cc.leftZ * cc.vy * 0.25 + (Math.random() - 0.5) * 1.5);
          this.smoke.emit(p, v, 0.45 + cc.slip * 0.4, 1.0 + Math.random() * 0.6);
        }
      }
      // every car leaves marks when it slides or spins its wheels
      const key = this.racers.indexOf(rr);
      if (slipping || (cc.wheelspin > 0.3 && cc.speed > 2)) {
        const bl = this.tmp.set(cc.x - cc.forwardX * cc.wheelbase * 0.5 + cc.leftX * cc.width * 0.42, cc.y, cc.z - cc.forwardZ * cc.wheelbase * 0.5 + cc.leftZ * cc.width * 0.42);
        const br = this.tmp2.set(cc.x - cc.forwardX * cc.wheelbase * 0.5 - cc.leftX * cc.width * 0.42, cc.y, cc.z - cc.forwardZ * cc.wheelbase * 0.5 - cc.leftZ * cc.width * 0.42);
        this.skids.add(bl, br, Math.min(1, cc.slip + cc.wheelspin), key);
      } else this.skids.add(null, null, 0, key);
    }
    this.skids.tick(dt);
    this.traffic?.update(dt, this.player.progress, this.player.car);
  }

  private flyStep(r: Racer, dt: number): void {
    const c = r.car;
    const inp = r.input;
    const target = inp.throttle * 110 - inp.brake * 60;
    this.flySpeed += (target - this.flySpeed) * Math.min(1, dt * 2.5);
    c.heading += inp.steer * 2.2 * dt;
    c.x += Math.sin(c.heading) * this.flySpeed * dt;
    c.z += Math.cos(c.heading) * this.flySpeed * dt;
    c.y = THREE.MathUtils.clamp(c.y + ((inp.handbrake ? 35 : 0) - (inp.nitro ? 35 : 0)) * dt, -20, 320);
    c.vx = this.flySpeed;
    c.vy = 0;
    c.yawRate = 0;
    c.pitch = 0;
    c.roll = 0;
    c.nitroActive = false;
    c.wheelSpin += (this.flySpeed / 0.34) * dt;
    c.steerAngle = inp.steer * 0.4;
    // keep the minimap dot roughly right without paying a global search every step
    if (++this.flyProbe % 12 === 0) {
      const p = this.track.projectGlobal(c.x, c.z);
      r.idx = p.idx;
      r.lat = p.lat;
    }
  }

  private syncVisual(r: Racer, dt: number): void {
    const c = r.car;
    const root = r.vis.root;
    root.position.set(c.x, c.y, c.z);
    // pitch from track slope + accel, roll from lateral accel
    const s = this.track.samples[r.idx];
    root.rotation.set(0, 0, 0);
    root.rotateY(c.heading);
    root.rotateX(-s.slope * (c.forwardX * s.tan.x + c.forwardZ * s.tan.z) + c.pitch);
    root.rotateZ(c.roll);
    // LOD by camera distance; phones never draw full-detail opponents
    // (the first sync runs from start(), before the camera exists)
    const cp = this.cam ? this.cam.camera.position : this.player.car;
    const d2 = (cp.x - c.x) ** 2 + (cp.z - c.z) ** 2;
    const low = this.vp.quality.level === 'low';
    const hero = this.vp.quality.level === 'high' ? 0 : 1;
    r.vis.setLod(r.isPlayer ? hero : d2 < (low ? 0 : 22 * 22) ? 1 : d2 < 70 * 70 ? 2 : 3);
    r.vis.setWheels(c.wheelSpin, c.steerAngle);
    r.vis.setBrake(r.input.brake > 0.1 || (r.finished && c.vx > 1));
    r.vis.setNitro(c.nitroActive, this.elapsed);
    if (r.vis.extras.length || this.glows) root.updateMatrixWorld();
    if (r.vis.extras.length) r.vis.tick(Math.abs(c.vx) * 3.6);
    if (this.glows) this.glows.set(this.racers.indexOf(r), root, r.spec.length, r.input.brake > 0.1 || (r.finished && c.vx > 1), r.vis.lamps);
    void dt;
  }

  private spawnGhost(): void {
    const vis = createCarVisual(this.player.spec, '#5ac8fa', { player: false, shadows: false, night: false, lod: 2 });
    vis.setGhost();
    this.scene.add(vis.root);
    this.ghost = vis;
  }

  private updateGhost(dt: number): void {
    if (!this.ghost || !this.ghostRec || !this.started || this.player.finished) return;
    const t = this.raceTime - this.player.lapStart;
    const slot = Math.min(this.ghostN - 1, Math.max(0, Math.floor(t * 20)));
    const rec = this.ghostRec;
    this.ghost.root.position.set(rec[slot * 4], rec[slot * 4 + 1], rec[slot * 4 + 2]);
    this.ghost.root.rotation.set(0, rec[slot * 4 + 3], 0);
    this.ghost.root.visible = t < this.ghostLapTime;
    void dt;
  }

  private position(r: Racer): number {
    let pos = 1;
    for (const o of this.racers) {
      if (o === r) continue;
      if (o.finished && !r.finished) pos++;
      else if (o.finished && r.finished) {
        if ((o.finishTime ?? 0) < (r.finishTime ?? 0)) pos++;
      } else if (!o.finished && !r.finished && o.progress > r.progress) pos++;
    }
    return pos;
  }

  private sendHUD(): void {
    const p = this.player;
    const c = p.car;
    const standings = [...this.racers].sort((a, b) => this.position(a) - this.position(b));
    const leader = standings[0];
    const lb: LeaderboardEntry[] = standings.map((r) => ({
      name: r.name,
      color: r.color,
      isPlayer: r.isPlayer,
      lap: Math.min(this.params.laps, Math.max(1, r.lap + 1)),
      gap: Math.max(0, Math.round((leader.progress - r.progress) * this.track.spacing)),
      finished: r.finished,
    }));
    if (this.splitT > 0) this.splitT -= 0.05;
    const hud: RaceHUD = {
      kind: 'race',
      speedKmh: Math.round(Math.abs(c.vx) * 3.6),
      rpm: c.rpm,
      gear: c.gear,
      nitro: c.nitro,
      nitroActive: c.nitroActive,
      lap: Math.min(this.params.laps, Math.max(1, p.lap + 1)),
      totalLaps: this.params.laps,
      position: this.position(p),
      racers: this.racers.length,
      raceTime: this.raceTime,
      lapTime: this.started && !p.finished ? this.raceTime - p.lapStart : p.lastLap ?? 0,
      bestLap: p.bestLap,
      lastLap: p.lastLap,
      drifting: c.drifting,
      driftScore: Math.round(this.driftScore),
      driftCombo: this.driftCombo,
      driftChain: Math.round(this.driftChain),
      wrongWay: this.wrongWay,
      countdown: this.countdownShown,
      started: this.started,
      finished: p.finished,
      leaderboard: lb,
      minimap: this.racers.map((r) => ({ ...this.track.toMinimap(r.car.x, r.car.z), color: r.color, isPlayer: r.isPlayer })),
      split: this.splitT > 0 ? this.split : null,
      timeAttack: !!this.params.timeAttack,
    };
    this.cb.onHUD(hud);
  }

  private sendResults(): void {
    const n = this.track.count;
    const totalProgress = (this.params.laps) * n;
    const sorted = [...this.racers].sort((a, b) => this.position(a) - this.position(b));
    const entries: RaceResultEntry[] = sorted.map((r, i) => {
      let total = r.finishTime;
      if (total === null) {
        const remaining = Math.max(0, totalProgress + n - 8 - r.progress) * this.track.spacing;
        total = this.raceTime + remaining / Math.max(12, r.car.speed);
      }
      return { name: r.name, color: r.color, isPlayer: r.isPlayer, place: i + 1, totalTime: total, bestLap: r.bestLap, finished: r.finished };
    });
    const player = entries.find((e) => e.isPlayer)!;
    const placePrize = this.params.timeAttack ? 400 : PLACE_PRIZE[player.place - 1] ?? 100;
    const drift = Math.round(this.driftScore / 8);
    const clean = this.cleanLaps * 400;
    const newRecord = player.bestLap != null && (this.bestRecordLap == null || player.bestLap < this.bestRecordLap);
    const record = newRecord ? 1500 : 0;
    const total = placePrize + drift + clean + record;
    this.cb.onFinish({
      kind: 'race',
      trackId: this.params.trackId,
      carId: this.params.carId,
      entries,
      player,
      driftScore: Math.round(this.driftScore),
      reward: { place: placePrize, drift, cleanLap: clean, record, total },
      newRecord,
      career: this.params.career,
      timeAttack: !!this.params.timeAttack,
    });
  }

  // ---------------------------------------------------------------- render
  render(vp: Viewport): void {
    if (this.post) this.post.render(this.scene, this.cam.camera);
    else vp.renderer.render(this.scene, this.cam.camera);
  }

  snapshot(): Partial<SpgSnapshot> {
    const c = this.player.car;
    return {
      playerPos: [c.x, c.y, c.z],
      playerSpeed: c.speed,
      extra: { lap: this.player.lap, progress: this.player.progress, idx: this.player.idx, lat: this.player.lat, started: this.started, finished: this.player.finished, camera: this.cam.mode, racers: this.racers.length },
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.vp) this.vp.renderer.shadowMap.enabled = this.vp.quality.shadows;
    audio.loop('rain', false);
    audio.loop('wind', false);
    audio.duckMusic(1, 0.5);
    for (const r of this.racers) {
      r.engine?.stop();
      r.vis.dispose();
    }
    this.ghost?.dispose();
    this.traffic?.dispose();
    this.crowd?.dispose();
    this.mesh.dispose();
    this.sky.dispose();
    this.weather?.dispose();
    this.props.dispose();
    this.features?.dispose();
    this.lampField?.dispose();
    this.glows?.dispose();
    this.smoke.dispose();
    this.sparks.dispose();
    this.skids.dispose();
    this.post?.dispose();
    this.pmrem?.dispose();
    this.sun.shadow.dispose();
    delete window.__spg.knobs.skipCountdown;
    delete window.__spg.knobs.finishNow;
    delete window.__spg.knobs.viewFrom;
    delete window.__spg.knobs.worldStats;
    this.scene.clear();
  }
}
