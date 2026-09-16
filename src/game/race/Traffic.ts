import * as THREE from 'three';
import { CARS } from '@/data/cars';
import type { CarSpec } from '../types';
import { CarPhysics } from '../vehicle/CarPhysics';
import { createCarVisual, type CarVisual } from '../vehicle/CarVisual';
import type { TrackData } from '../world/TrackData';

/**
 * City traffic on the race route: ordinary cars rolling along their own lane — the ones going your way keep
 * right, the oncoming ones come at you on the left. They are kinematic (they follow the route and slow down
 * for corners and for each other), which keeps them cheap and predictable; a real hit hands the car over to
 * CarPhysics so it spins away, and the racing AI sees them as cars to overtake.
 */
export interface TrafficCar {
  car: CarPhysics;
  vis: CarVisual;
  /** sample index along the route (float) */
  progress: number;
  /** +1 with the race, −1 against it */
  dir: 1 | -1;
  lat: number;
  speed: number;
  /** seconds left of the physics-driven spin after a hit */
  spun: number;
  alive: boolean;
}

const COLOURS = ['#8a8f96', '#2b2e33', '#e8e6e0', '#1e3a5f', '#4a5a3c', '#9b7a45', '#6b1f22', '#c8ccd2'];

export class Traffic {
  readonly group = new THREE.Group();
  readonly cars: TrafficCar[] = [];
  private t = 0;

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
      this.group.add(vis.root);
      this.cars.push({ car, vis, progress: 0, dir: 1, lat: 0, speed: 14, spun: 0, alive: false });
    }
  }

  /** put a car back on the road ahead of or behind the player, out of sight */
  private respawn(t: TrafficCar, playerProgress: number, i: number): void {
    const n = this.track.count;
    const lanes = Math.max(2.2, this.track.halfW * 0.45);
    t.dir = i % 3 === 0 ? -1 : 1;
    // ahead of the player for the ones coming towards us, behind for the ones we catch up with
    const aheadM = t.dir === -1 ? 170 + Math.random() * 190 : 60 + Math.random() * 220;
    t.progress = (((playerProgress + (aheadM / this.track.spacing) * (t.dir === -1 ? 1 : 1)) % n) + n) % n;
    t.lat = t.dir === 1 ? -lanes : lanes;
    t.speed = t.dir === 1 ? 11 + Math.random() * 6 : 13 + Math.random() * 7;
    t.spun = 0;
    t.alive = true;
    t.car.place(0, 0, 0, 0);
  }

  /** the AI sees traffic as slow cars on the route */
  forEachObstacle(fn: (progress: number, lat: number, speed: number) => void): void {
    for (const t of this.cars) if (t.alive) fn(t.progress, t.lat, t.speed * t.dir);
  }

  update(dt: number, playerProgress: number, player: CarPhysics): void {
    this.t += dt;
    const n = this.track.count;
    const spacing = this.track.spacing;
    for (let i = 0; i < this.cars.length; i++) {
      const t = this.cars[i];
      if (!t.alive) {
        this.respawn(t, playerProgress, i);
        continue;
      }
      let gap = t.progress - playerProgress;
      if (gap > n / 2) gap -= n;
      if (gap < -n / 2) gap += n;
      const gapM = gap * spacing;
      if (gapM > 460 || gapM < -320) {
        this.respawn(t, playerProgress, i);
        continue;
      }
      if (t.spun > 0) {
        // knocked about: physics takes over for a moment
        t.spun -= dt;
        const idx = ((Math.round(t.progress) % n) + n) % n;
        const sm = this.track.samples[idx];
        const slope = sm.slope * (t.car.forwardX * sm.tan.x + t.car.forwardZ * sm.tan.z);
        t.car.step({ steer: 0, throttle: 0, brake: 0.6, handbrake: false, nitro: false }, dt, { grip: 1, slopeAlong: slope }, true);
        const p = this.track.project(t.car.x, t.car.z, idx, 10);
        t.progress = p.idx;
        t.lat = p.lat;
        t.speed = Math.max(0, t.car.vx);
        this.place(t, t.car.x, t.car.y, t.car.z, t.car.heading);
        if (t.spun <= 0 && t.car.speed < 4) t.alive = false;
        continue;
      }
      // keep the lane, ease off for corners and for whatever is in front
      const idx = ((Math.round(t.progress) % n) + n) % n;
      const sm = this.track.samples[idx];
      const curveLimit = Math.sqrt(Math.max(4, 5.5 / Math.max(1e-4, Math.abs(sm.curv))));
      let want = Math.min(t.dir === 1 ? 17 : 19, curveLimit);
      for (const o of this.cars) {
        if (o === t || !o.alive || o.dir !== t.dir || Math.abs(o.lat - t.lat) > 2) continue;
        let d = (o.progress - t.progress) * t.dir;
        if (d > n / 2) d -= n;
        if (d < -n / 2) d += n;
        const dm = d * spacing;
        if (dm > 0 && dm < 26) want = Math.min(want, Math.max(3, o.speed - (26 - dm) * 0.35));
      }
      // and for the player coming up behind in the same lane
      if (t.dir === 1 && gapM < 0 && gapM > -30 && Math.abs(player.vx) > t.speed + 4) want = Math.min(want, t.speed + 2);
      t.speed += Math.max(-9 * dt, Math.min(4 * dt, want - t.speed));
      t.progress = (((t.progress + (t.dir * t.speed * dt) / spacing) % n) + n) % n;
      const i2 = ((Math.round(t.progress) % n) + n) % n;
      const s2 = this.track.samples[i2];
      const x = s2.pos.x + s2.left.x * t.lat, z = s2.pos.z + s2.left.z * t.lat;
      const heading = this.track.headingAt(i2) + (t.dir === -1 ? Math.PI : 0);
      t.car.place(x, z, s2.pos.y, heading);
      t.car.vx = t.speed * t.dir;
      this.place(t, x, s2.pos.y, z, heading);
      t.vis.setWheels(this.t * t.speed * 2.2, 0);
      // contact with the player: hand the traffic car to physics so it spins away
      const hit = CarPhysics.collide(player, t.car);
      if (hit > 2.5) {
        t.spun = 3.5;
        t.car.vy += (Math.random() - 0.5) * 4;
        t.car.yawRate += (Math.random() - 0.5) * 1.6;
      }
    }
  }

  private place(t: TrafficCar, x: number, y: number, z: number, heading: number): void {
    t.vis.root.position.set(x, y, z);
    t.vis.root.rotation.set(0, heading, 0);
    t.vis.tick(Math.abs(t.speed) * 3.6);
  }

  dispose(): void {
    for (const t of this.cars) t.vis.dispose();
    this.group.clear();
  }
}
