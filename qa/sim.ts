/**
 * Headless physics/AI simulation (no WebGL): runs AI cars on every track and reports
 * lap times, wall hits, spins and stuck events. Bundle + run:
 *   npx esbuild qa/sim.ts --bundle --platform=node --format=esm --outfile=/mnt/ramdisk/spg3d-sim.mjs && node /mnt/ramdisk/spg3d-sim.mjs
 */
import { TRACKS } from '../src/data/tracks';
import { CARS } from '../src/data/cars';
import { TrackData } from '../src/game/world/TrackData';
import { CarPhysics } from '../src/game/vehicle/CarPhysics';
import { RacerAI } from '../src/game/ai/RacerAI';

const DT = 1 / 120;
const LAPS = 2;

interface Sim {
  car: CarPhysics;
  ai: RacerAI;
  idx: number;
  progress: number;
  lat: number;
  lap: number;
  lapStart: number;
  laps: number[];
  wallHits: number;
  spins: number;
  stuck: number;
  maxSpeed: number;
  driftTime: number;
  name: string;
}

function run(trackIdx: number, carIdx: number, nCars: number): Sim[] {
  const track = new TrackData(TRACKS[trackIdx]);
  const sims: Sim[] = [];
  for (let i = 0; i < nCars; i++) {
    const spec = CARS[(carIdx + i) % CARS.length];
    const car = new CarPhysics(spec);
    const gridIdx = (track.count - 6 - i * 5 + track.count) % track.count;
    const s = track.samples[gridIdx];
    const lat = (i % 2 === 0 ? 1 : -1) * 2.6;
    car.place(s.pos.x + s.left.x * lat, s.pos.z + s.left.z * lat, s.pos.y, track.headingAt(gridIdx));
    sims.push({ car, ai: new RacerAI(track, 1.0, 1.0, Number(process.env.AGGR ?? 0.6)), idx: gridIdx, progress: gridIdx, lat, lap: 0, lapStart: 0, laps: [], wallHits: 0, spins: 0, stuck: 0, maxSpeed: 0, driftTime: 0, name: spec.id });
  }
  let t = 0;
  const maxT = 400;
  while (t < maxT && sims.some((s) => s.laps.length < LAPS)) {
    for (const s of sims) {
      if (s.laps.length >= LAPS) continue;
      const ctx = {
        progress: s.progress,
        lat: s.lat,
        others: process.env.NOAVOID ? [] : sims.filter((o) => o !== s).map((o) => ({ progress: o.progress, lat: o.lat, speed: o.car.speed, isPlayer: false })),
        canDrive: true,
      };
      const inp = s.ai.drive(s.car, ctx, DT);
      const p = track.project(s.car.x, s.car.z, s.idx);
      const smp = track.samples[p.idx];
      const slopeAlong = smp.slope * (s.car.forwardX * smp.tan.x + s.car.forwardZ * smp.tan.z) / Math.max(1e-3, Math.hypot(smp.tan.x, smp.tan.z));
      s.car.step(inp, DT, { grip: TRACKS[trackIdx].env.grip, slopeAlong }, true);
      const q = track.project(s.car.x, s.car.z, p.idx);
      // lap wrap
      const prevIdx = s.idx;
      s.idx = q.idx;
      s.lat = q.lat;
      s.car.y = q.y;
      if (prevIdx > track.count * 0.8 && q.idx < track.count * 0.2) {
        if (s.lap > 0) s.laps.push(t - s.lapStart);
        s.lap++;
        s.lapStart = t;
      }
      s.progress = s.lap * track.count + q.progress;
      // walls
      const maxLat = track.halfW - s.car.width * 0.5 - 0.2;
      if (Math.abs(q.lat) > maxLat) {
        const sgn = Math.sign(q.lat);
        const qs = track.samples[q.idx];
        s.car.x -= qs.left.x * (q.lat - sgn * maxLat);
        s.car.z -= qs.left.z * (q.lat - sgn * maxLat);
        const into = s.car.hitWall(-qs.left.x * sgn, -qs.left.z * sgn);
        if (into > 3) s.wallHits++;
        s.lat = sgn * maxLat;
      }
      if (Math.abs(s.car.yawRate) > 3.5) s.spins++;
      if (s.car.speed < 1 && t > 5) s.stuck++;
      if (s.car.drifting) s.driftTime += DT;
      s.maxSpeed = Math.max(s.maxSpeed, s.car.speed);
    }
    if (!process.env.NOCOLLIDE) for (let i = 0; i < sims.length; i++) for (let j = i + 1; j < sims.length; j++) CarPhysics.collide(sims[i].car, sims[j].car);
    t += DT;
  }
  return sims;
}

for (let ti = 0; ti < TRACKS.length; ti++) {
  const track = new TrackData(TRACKS[ti]);
  const minV = Math.min(...track.samples.map((s) => s.lineSpeed));
  const maxC = Math.max(...track.samples.map((s) => Math.abs(s.curv)));
  console.log(`\n== ${TRACKS[ti].name}: length ${track.length.toFixed(0)} m, samples ${track.count}, minLineSpeed ${minV.toFixed(1)} m/s, minRadius ${(1 / maxC).toFixed(1)} m`);
  const sims = run(ti, 0, 6);
  for (const s of sims) {
    console.log(
      `${s.name.padEnd(8)} laps=[${s.laps.map((l) => l.toFixed(1)).join(', ')}] max=${(s.maxSpeed * 3.6).toFixed(0)}km/h walls=${s.wallHits} spins=${s.spins} stuck=${(s.stuck * DT).toFixed(1)}s drift=${s.driftTime.toFixed(1)}s`,
    );
  }
}

// straight-line test: acceleration 0-100 and top speed per car
console.log('\n== straight line');
for (const spec of CARS) {
  const car = new CarPhysics(spec);
  car.place(0, 0, 0, 0);
  let t = 0, t100 = -1;
  while (t < 40) {
    car.step({ steer: 0, throttle: 1, brake: 0, handbrake: false, nitro: false }, DT, { grip: 1, slopeAlong: 0 }, true);
    t += DT;
    if (t100 < 0 && car.vx * 3.6 >= 100) t100 = t;
  }
  console.log(`${spec.id.padEnd(8)} 0-100 ${t100.toFixed(2)}s  top ${(car.vx * 3.6).toFixed(0)} km/h (spec ${(spec.topSpeed * 3.6).toFixed(0)})`);
}

// handbrake drift test: does the car slide and recover?
{
  const car = new CarPhysics(CARS[1]);
  car.place(0, 0, 0, 0);
  let t = 0, maxYaw = 0, maxAlpha = 0, driftFrames = 0;
  while (t < 12) {
    const phase = t < 4 ? 'accel' : t < 5.2 ? 'hb' : 'recover';
    const inp = { steer: phase === 'hb' ? 1 : phase === 'recover' ? -0.4 : 0, throttle: phase === 'recover' ? 0.8 : 1, brake: 0, handbrake: phase === 'hb', nitro: false };
    car.step(inp, DT, { grip: 1, slopeAlong: 0 }, true);
    maxYaw = Math.max(maxYaw, Math.abs(car.yawRate));
    if (car.drifting) driftFrames++;
    maxAlpha = Math.max(maxAlpha, Math.abs(car.vy));
    t += DT;
  }
  console.log(`\n== drift test: maxYaw ${maxYaw.toFixed(2)} rad/s, maxLateral ${maxAlpha.toFixed(1)} m/s, drift ${(driftFrames * DT).toFixed(2)} s, final speed ${(car.speed * 3.6).toFixed(0)} km/h, heading ${car.heading.toFixed(2)}`);
}

// single-car trace on the first track (set TRACE=1)
if (process.env.TRACE) {
  const track = new TrackData(TRACKS[Number(process.env.TRACE_TRACK ?? 0)]);
  const spec = CARS[0];
  const car = new CarPhysics(spec);
  const ai = new RacerAI(track, 1, 1, 0);
  const g0 = track.count - 6;
  const s0 = track.samples[g0];
  const lat0 = Number(process.env.TRACE_LAT ?? 0);
  car.place(s0.pos.x + s0.left.x * lat0, s0.pos.z + s0.left.z * lat0, s0.pos.y, track.headingAt(g0));
  let idx = g0, t = 0, lastPrint = -1;
  const grip0 = Number(process.env.TRACE_GRIP ?? 1);
  while (t < 60) {
    const p = track.project(car.x, car.z, idx);
    idx = p.idx;
    const inp = ai.drive(car, { progress: p.progress, lat: p.lat, others: [], canDrive: true }, DT);
    const smp = track.samples[p.idx];
    const slopeAlong = process.env.TRACE_SLOPE ? smp.slope * (car.forwardX * smp.tan.x + car.forwardZ * smp.tan.z) / Math.max(1e-3, Math.hypot(smp.tan.x, smp.tan.z)) : 0;
    car.step(inp, DT, { grip: grip0, slopeAlong }, true);
    const maxLat = track.halfW - car.width * 0.5 - 0.2;
    const q = track.project(car.x, car.z, idx);
    if (Math.abs(q.lat) > maxLat) {
      const sgn = Math.sign(q.lat);
      const qs = track.samples[q.idx];
      car.x -= qs.left.x * (q.lat - sgn * maxLat);
      car.z -= qs.left.z * (q.lat - sgn * maxLat);
      const into = car.hitWall(-qs.left.x * sgn, -qs.left.z * sgn);
      if (into > 1) console.log(`  WALL t=${t.toFixed(1)} into=${into.toFixed(1)} idx=${q.idx}`);
    }
    if (Math.floor(t * 2) !== lastPrint) {
      lastPrint = Math.floor(t * 2);
      console.log(`t=${t.toFixed(1)} idx=${q.idx} lat=${q.lat.toFixed(1)} v=${(car.vx*3.6).toFixed(0)} vy=${car.vy.toFixed(1)} yaw=${car.yawRate.toFixed(2)} steer=${inp.steer.toFixed(2)} thr=${inp.throttle.toFixed(2)} brk=${inp.brake.toFixed(2)} line=${smp.lineSpeed.toFixed(1)} curv=${smp.curv.toFixed(4)} drift=${car.drifting}`);
    }
    t += DT;
  }
}
