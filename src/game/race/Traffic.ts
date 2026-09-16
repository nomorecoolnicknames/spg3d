import * as THREE from 'three';
import { CARS } from '@/data/cars';
import type { CarSpec } from '../types';
import { CarPhysics } from '../vehicle/CarPhysics';
import { createCarVisual, type CarVisual } from '../vehicle/CarVisual';
import type { TrackData } from '../world/TrackData';

/**
 * City traffic on the race route: ordinary cars in their own lane — the ones going your way keep right, the
 * oncoming ones come at you on the left. Every traffic car is a real CarPhysics body driven by a calm driver
 * (keep the lane, ease off for corners and for whatever is in front), so it moves smoothly, has the same
 * footprint as every other car, and collisions with the player and the racers push both ways. A car that got
 * knocked about stays where it ended up and is recycled once it is out of sight.
 *
 * (It used to be kinematic: placed on the nearest route sample every frame — jumping 1.5 m at a time — and
 * snapped back into its lane after every contact, so it juddered and hit like a wall.)
 */
export interface TrafficCar {
  car: CarPhysics;
  vis: CarVisual;
  /** route sample the car is on (hint for projection) */
  idx: number;
  /** sample index along the route (float) */
  progress: number;
  /** +1 with the race, −1 against it */
  dir: 1 | -1;
  /** lane offset it tries to keep (m, left positive) */
  lane: number;
  lat: number;
  /** cruising speed, m/s */
  cruise: number;
  /** seconds it has been knocked out of its lane or stopped */
  lost: number;
  alive: boolean;
  steer: number;
  /** bumped on every respawn (QA motion probe: a respawn is not a jump) */
  generation: number;
}

const COLOURS = ['#8a8f96', '#2b2e33', '#e8e6e0', '#1e3a5f', '#4a5a3c', '#9b7a45', '#6b1f22', '#c8ccd2'];

export class Traffic {
  readonly group = new THREE.Group();
  readonly cars: TrafficCar[] = [];
  private t = 0;
  private respawnTimer = 0;

  constructor(
    private track: TrackData,
    opts: { count: number; shadows: boolean; night: boolean; lod?: 0 | 1 | 2 | 3 },
  ) {
    this.group.name = 'traffic';
    const specs = CARS.filter((c) => c.id !== 'bolide' && c.id !== 'gt40');
    for (let i = 0; i < opts.count; i++) {
      const spec: CarSpec = specs[i % specs.length];
      const car = new CarPhysics(spec);
      const vis = createCarVisual(spec, COLOURS[i % COLOURS.length], {
        player: false,
        shadows: opts.shadows,
        night: opts.night,
        lod: opts.lod ?? 2,
        opaqueGlass: true,
      });
      vis.setHeadlights(opts.night);
      vis.root.visible = false;
      this.group.add(vis.root);
      this.cars.push({ car, vis, idx: 0, progress: 0, dir: 1, lane: 0, lat: 0, cruise: 14, lost: 0, alive: false, steer: 0, generation: 0 });
    }
  }

  /** put a car on the road ahead of the player, out of sight, rolling at its cruising speed */
  private spawn(t: TrafficCar, playerProgress: number, i: number): void {
    const n = this.track.count;
    const lanes = Math.max(2.2, this.track.halfW * 0.45);
    t.dir = i % 3 === 0 ? -1 : 1;
    // oncoming cars start far ahead and come towards us; the ones going our way start a little closer
    const aheadM = t.dir === -1 ? 190 + Math.random() * 170 : 90 + Math.random() * 200;
    const si = Math.round(((playerProgress + aheadM / this.track.spacing) % n + n) % n);
    const sm = this.track.samples[si];
    t.lane = t.dir === 1 ? -lanes : lanes;
    t.cruise = t.dir === 1 ? 11 + Math.random() * 6 : 13 + Math.random() * 6;
    t.car.place(sm.pos.x + sm.left.x * t.lane, sm.pos.z + sm.left.z * t.lane, sm.pos.y, this.track.headingAt(si) + (t.dir === -1 ? Math.PI : 0));
    t.car.vx = Math.min(t.cruise, Math.sqrt(5.5 / Math.max(1e-4, Math.abs(sm.curv))));
    t.idx = si;
    t.progress = si;
    t.lat = t.lane;
    t.lost = 0;
    t.steer = 0;
    t.alive = true;
    t.generation++;
    t.vis.root.visible = true;
  }

  savePoses(): void {
    for (const t of this.cars) if (t.alive) t.car.savePose();
  }

  /** draw every car between its last two simulation steps (see CarPhysics.beginRender) */
  beginRender(alpha: number): void {
    for (const t of this.cars) {
      if (!t.alive) continue;
      const c = t.car;
      c.beginRender(alpha);
      t.vis.root.position.set(c.x, c.y, c.z);
      t.vis.root.rotation.set(0, c.heading, 0);
      t.vis.root.rotateX(c.pitch);
      t.vis.root.rotateZ(c.roll);
      t.vis.setWheels(c.wheelSpin, c.steerAngle);
      t.vis.tick(Math.max(0, c.vx) * 3.6);
    }
  }

  endRender(): void {
    for (const t of this.cars) if (t.alive) t.car.endRender();
  }

  /** the racing AI sees traffic as cars on the route (speed is signed: oncoming cars move against it) */
  forEachObstacle(fn: (progress: number, lat: number, speed: number) => void): void {
    for (const t of this.cars) if (t.alive) fn(t.progress, t.lat, t.car.vx * t.dir);
  }

  /** every live traffic car body, for collisions with the racers */
  bodies(): CarPhysics[] {
    const out: CarPhysics[] = [];
    for (const t of this.cars) if (t.alive) out.push(t.car);
    return out;
  }

  update(dt: number, playerProgress: number, racers: readonly { progress: number; lat: number; car: CarPhysics }[]): void {
    this.t += dt;
    this.respawnTimer -= dt;
    const n = this.track.count;
    const spacing = this.track.spacing;
    for (let i = 0; i < this.cars.length; i++) {
      const t = this.cars[i];
      if (!t.alive) {
        // stagger spawns so a whole column does not appear at once
        if (this.respawnTimer <= 0) {
          this.spawn(t, playerProgress, i);
          this.respawnTimer = 0.35;
        }
        continue;
      }
      let gap = t.progress - playerProgress;
      if (gap > n / 2) gap -= n;
      if (gap < -n / 2) gap += n;
      const gapM = gap * spacing;
      const knocked = t.lost > 4;
      if (gapM > 480 || gapM < -260 || (knocked && Math.abs(gapM) > 90)) {
        t.alive = false;
        t.vis.root.visible = false;
        continue;
      }
      const c = t.car;
      const v = Math.max(0, c.vx);
      // --- driver: pure pursuit on its lane a little ahead ---
      const look = Math.max(6, Math.min(26, 5 + v * 0.8));
      const li = ((t.idx + t.dir * Math.round(look / spacing)) % n + n) % n;
      const ls = this.track.samples[li];
      const tx = ls.pos.x + ls.left.x * t.lane - c.x, tz = ls.pos.z + ls.left.z * t.lane - c.z;
      let diff = Math.atan2(tx, tz) - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const kappa = (2 * Math.sin(diff)) / Math.max(3, Math.hypot(tx, tz));
      const steerWant = Math.max(-1, Math.min(1, Math.atan(kappa * c.wheelbase) / Math.max(0.05, c.maxSteer(v))));
      t.steer += (steerWant - t.steer) * Math.min(1, dt * 8);
      // --- speed: cruise, corners ahead, and whatever is in front in the same lane ---
      let want = t.cruise;
      for (let k = 0; k <= 40; k += 4) {
        const s = this.track.samples[((t.idx + t.dir * Math.round(k / spacing)) % n + n) % n];
        want = Math.min(want, Math.sqrt(5.5 / Math.max(1e-4, Math.abs(s.curv))) + k * 0.12);
      }
      const ahead = (progress: number, lat: number, speedAlong: number) => {
        let d = (progress - t.progress) * t.dir;
        if (d > n / 2) d -= n;
        if (d < -n / 2) d += n;
        const m = d * spacing;
        if (m > 0.5 && m < 30 && Math.abs(lat - t.lat) < 2.6) want = Math.min(want, Math.max(0, speedAlong - (30 - m) * 0.45));
      };
      for (const o of this.cars) if (o !== t && o.alive) ahead(o.progress, o.lat, o.car.vx * (o.dir === t.dir ? 1 : -1));
      for (const r of racers) ahead(r.progress, r.lat, r.car.vx * t.dir);
      if (knocked) want = 0;
      const throttle = v < want - 0.4 ? Math.min(0.6, (want - v) * 0.25 + 0.15) : 0;
      // (no brake below walking pace: CarPhysics reads brake at a standstill as reverse)
      const brake = v > want + 0.8 && v > 1 ? Math.min(1, (v - want) * 0.2 + 0.1) : 0;
      const sm = this.track.samples[t.idx];
      c.step({ steer: t.steer, throttle, brake, handbrake: false, nitro: false }, dt, { grip: this.track.spec.env.grip, slopeAlong: sm.slope * (c.forwardX * sm.tan.x + c.forwardZ * sm.tan.z) }, true);
      // --- keep it on the road between the barriers, like the racers ---
      const p = this.track.project(c.x, c.z, t.idx, 12);
      const s = this.track.samples[p.idx];
      const maxLat = this.track.barrierFace - c.extentAlong(s.left.x, s.left.z);
      if (Math.abs(p.lat) > maxLat) {
        const sgn = Math.sign(p.lat);
        c.x -= s.left.x * (p.lat - sgn * maxLat);
        c.z -= s.left.z * (p.lat - sgn * maxLat);
        c.hitWall(-s.left.x * sgn, -s.left.z * sgn);
        p.lat = sgn * maxLat;
      }
      c.y = p.y;
      t.idx = p.idx;
      t.progress = p.progress;
      t.lat = p.lat;
      // out of its lane, sideways or stopped: after a while it is written off and recycled out of sight
      const offLane = Math.abs(p.lat - t.lane) > 3 || Math.abs(c.beta) > 0.5 || v < 2;
      t.lost = offLane ? t.lost + dt : Math.max(0, t.lost - dt * 2);
      // visual
    }
    // traffic against itself (the racers are handled by the race, together with the player)
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.cars.length; j++) {
        const b = this.cars[j];
        if (b.alive) CarPhysics.collide(a.car, b.car);
      }
    }
  }

  dispose(): void {
    for (const t of this.cars) t.vis.dispose();
    this.group.clear();
  }
}
