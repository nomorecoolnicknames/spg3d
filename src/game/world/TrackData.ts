import * as THREE from 'three';
import type { TrackSpec } from '../types';

/**
 * Pure track math (no DOM, no meshes) so it can run in node for physics tests.
 * Samples are ~1.5 m apart along a closed Catmull-Rom spline with elevation.
 */
export interface TrackSample {
  pos: THREE.Vector3;
  /** unit tangent (xz mostly, includes slope) */
  tan: THREE.Vector3;
  /** unit left vector in the xz plane */
  left: THREE.Vector3;
  /** signed curvature 1/m, positive = turning left */
  curv: number;
  /** slope angle (rad), positive uphill */
  slope: number;
  /** distance from start along the lap (m) */
  dist: number;
  /** racing line lateral offset (m, positive = left) */
  lineOffset: number;
  /** racing line target speed (m/s) for a reference car */
  lineSpeed: number;
  /** sector 0..SECTORS-1 */
  sector: number;
}

export const SECTORS = 8;

export interface TrackProjection {
  idx: number;
  /** 0..1 within segment idx→idx+1 */
  frac: number;
  /** lateral offset from the centerline (m, positive = left) */
  lat: number;
  /** continuous progress in samples */
  progress: number;
  /** surface height at that point */
  y: number;
}

export class TrackData {
  readonly samples: TrackSample[] = [];
  readonly count: number;
  readonly halfW: number;
  /** drivable width beyond the road edge (to the wall) */
  readonly runoff: number;
  /** lateral offset of the barrier's inner face (TrackMesh builds the barrier at halfW + runoff + 0.6, 0.16 thick) */
  readonly barrierFace: number;
  readonly length: number;
  readonly spacing: number;
  readonly curve: THREE.CatmullRomCurve3;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number; span: number };

  constructor(readonly spec: TrackSpec) {
    this.halfW = spec.roadWidth / 2;
    this.runoff = spec.runoff ?? 4.6;
    this.barrierFace = this.halfW + this.runoff + 0.44;
    const sc = spec.scale ?? 1;
    this.curve = new THREE.CatmullRomCurve3(
      spec.points.map(([x, z, y]) => new THREE.Vector3(x * sc, y, z * sc)),
      true,
      spec.spline ?? 'catmullrom',
      0.55,
    );
    this.length = this.curve.getLength();
    const n = Math.max(200, Math.round(this.length / 1.5));
    this.count = n;
    this.spacing = this.length / n;
    const pts = this.curve.getSpacedPoints(n);
    pts.pop();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      this.samples.push({
        pos: pts[i].clone(),
        tan: new THREE.Vector3(),
        left: new THREE.Vector3(),
        curv: 0,
        slope: 0,
        dist: i * this.spacing,
        lineOffset: 0,
        lineSpeed: 30,
        sector: Math.floor((i / n) * SECTORS),
      });
    }
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const next = this.samples[(i + 1) % n].pos;
      const prev = this.samples[(i - 1 + n) % n].pos;
      s.tan.subVectors(next, prev).normalize();
      const flat = new THREE.Vector3(s.tan.x, 0, s.tan.z).normalize();
      s.left.crossVectors(up, flat).normalize();
      s.slope = Math.atan2(s.tan.y, Math.hypot(s.tan.x, s.tan.z));
    }
    // signed curvature from heading change (xz)
    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - 2 + n) % n].tan;
      const b = this.samples[(i + 2) % n].tan;
      const ha = Math.atan2(a.x, a.z);
      const hb = Math.atan2(b.x, b.z);
      let d = hb - ha;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.samples[i].curv = d / (4 * this.spacing);
    }
    this.smoothField('curv', 3);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.pos.x);
      maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z);
      maxZ = Math.max(maxZ, s.pos.z);
    }
    this.bounds = { minX, maxX, minZ, maxZ, span: Math.max(maxX - minX, maxZ - minZ) };
    this.buildRacingLine();
  }

  private smoothField(key: 'curv' | 'lineOffset' | 'lineSpeed', radius: number, passes = 1): void {
    const n = this.count;
    for (let p = 0; p < passes; p++) {
      const src = this.samples.map((s) => s[key]);
      for (let i = 0; i < n; i++) {
        let acc = 0, w = 0;
        for (let k = -radius; k <= radius; k++) {
          const wt = 1 - Math.abs(k) / (radius + 1);
          acc += src[(i + k + n) % n] * wt;
          w += wt;
        }
        this.samples[i][key] = acc / w;
      }
    }
  }

  /** Simple out-in-out line: move toward the inside of corners, smoothed widely. */
  private buildRacingLine(): void {
    const n = this.count;
    const maxOff = this.halfW * 0.62;
    for (let i = 0; i < n; i++) {
      const c = this.samples[i].curv;
      const k = Math.min(1, Math.abs(c) * 55); // 1/55 m radius → full inside
      this.samples[i].lineOffset = Math.sign(c) * k * maxOff;
    }
    // widen: before a corner drift to the outside (negative of inside) — done by
    // subtracting a lookahead-shifted copy, then heavy smoothing
    const off = this.samples.map((s) => s.lineOffset);
    const look = Math.round(28 / this.spacing);
    for (let i = 0; i < n; i++) {
      const ahead = off[(i + look) % n];
      this.samples[i].lineOffset = off[i] * 0.9 - ahead * 0.35;
    }
    this.smoothField('lineOffset', Math.round(18 / this.spacing), 3);
    for (const s of this.samples) s.lineOffset = THREE.MathUtils.clamp(s.lineOffset, -maxOff, maxOff);
    this.computeSpeedProfile(10.5 * this.spec.env.grip, 9.5, 5.5);
  }

  /** Curvature-limited speeds with backward braking pass and forward acceleration pass. */
  computeSpeedProfile(aLat: number, aBrake: number, aAccel: number, vMax = 95): void {
    const n = this.count;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // effective curvature of the racing line (approximate by shifting radius by offset)
      const c = this.samples[i].curv;
      const r = Math.abs(c) > 1e-4 ? 1 / Math.abs(c) : 1e4;
      const rEff = Math.max(8, r - Math.sign(c) * this.samples[i].lineOffset * 0.5);
      v[i] = Math.min(vMax, Math.sqrt(aLat * rEff));
    }
    const ds = this.spacing;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < n; k++) {
        const i = (n - 1 - k + n) % n;
        const nx = (i + 1) % n;
        const slopeG = 9.81 * Math.sin(this.samples[i].slope); // uphill helps braking
        v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * (aBrake + slopeG) * ds));
      }
      for (let i = 0; i < n; i++) {
        const nx = (i + 1) % n;
        const slopeG = 9.81 * Math.sin(this.samples[i].slope);
        v[nx] = Math.min(v[nx], Math.sqrt(v[i] * v[i] + 2 * Math.max(1.5, aAccel - slopeG) * ds));
      }
    }
    for (let i = 0; i < n; i++) this.samples[i].lineSpeed = v[i];
  }

  /** Nearest sample search around a hint (fast, ±window), then segment projection. */
  project(x: number, z: number, hint: number, window = 40): TrackProjection {
    const n = this.count;
    let best = hint, bestD = Infinity;
    for (let k = -window; k <= window; k++) {
      const i = (hint + k + n) % n;
      const p = this.samples[i].pos;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // choose segment best→best+1 or best-1→best by projection sign
    const s = this.samples[best];
    const dx = x - s.pos.x, dz = z - s.pos.z;
    const tx = s.tan.x, tz = s.tan.z;
    const tl = Math.hypot(tx, tz) || 1;
    let along = (dx * tx + dz * tz) / tl;
    let idx = best;
    if (along < 0) {
      idx = (best - 1 + n) % n;
      const s2 = this.samples[idx];
      along = ((x - s2.pos.x) * s2.tan.x + (z - s2.pos.z) * s2.tan.z) / (Math.hypot(s2.tan.x, s2.tan.z) || 1);
    }
    const sa = this.samples[idx];
    const sb = this.samples[(idx + 1) % n];
    const frac = THREE.MathUtils.clamp(along / this.spacing, 0, 1);
    const lat = (x - sa.pos.x) * sa.left.x + (z - sa.pos.z) * sa.left.z;
    const y = sa.pos.y + (sb.pos.y - sa.pos.y) * frac;
    return { idx, frac, lat, progress: idx + frac, y };
  }

  /** Global nearest sample (slow, used on spawn/respawn). */
  projectGlobal(x: number, z: number): TrackProjection {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.count; i += 3) {
      const p = this.samples[i].pos;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return this.project(x, z, best, 6);
  }

  heightAt(progress: number): number {
    const n = this.count;
    const i = ((Math.floor(progress) % n) + n) % n;
    const f = progress - Math.floor(progress);
    return this.samples[i].pos.y + (this.samples[(i + 1) % n].pos.y - this.samples[i].pos.y) * f;
  }

  /** world position on the surface for (progress, lateral) */
  pointAt(progress: number, lat: number, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.count;
    const i = ((Math.floor(progress) % n) + n) % n;
    const f = progress - Math.floor(progress);
    const a = this.samples[i], b = this.samples[(i + 1) % n];
    out.set(
      a.pos.x + (b.pos.x - a.pos.x) * f + a.left.x * lat,
      a.pos.y + (b.pos.y - a.pos.y) * f,
      a.pos.z + (b.pos.z - a.pos.z) * f + a.left.z * lat,
    );
    return out;
  }

  headingAt(idx: number): number {
    const t = this.samples[((idx % this.count) + this.count) % this.count].tan;
    return Math.atan2(t.x, t.z);
  }

  /** normalized minimap polyline (-1..1) */
  minimap(step = 6): { x: number; y: number }[] {
    const b = this.bounds;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < this.count; i += step) {
      const p = this.samples[i].pos;
      out.push({ x: ((p.x - b.minX) / b.span) * 2 - 1, y: ((p.z - b.minZ) / b.span) * 2 - 1 });
    }
    return out;
  }

  toMinimap(x: number, z: number): { x: number; y: number } {
    const b = this.bounds;
    return { x: ((x - b.minX) / b.span) * 2 - 1, y: ((z - b.minZ) / b.span) * 2 - 1 };
  }
}
