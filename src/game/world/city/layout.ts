/**
 * Neon City street plan (pure data + math, no three.js): a 96 m street grid, the race route through
 * it with filleted corners and an elevation profile, and the named districts the city builder
 * dresses. World axes: +x east, +z south, y up. One grid unit = 96 m (≈ 80 m block + 16 m street).
 */
export const GRID = 96;
export const ROAD_WIDTH = 18;
/** kerb-to-facade: pavement width on each side of a street */
export const PAVEMENT = 5;
/** facade line distance from a street centreline */
export const FRONTAGE = ROAD_WIDTH / 2 + PAVEMENT;

export type District = 'downtown' | 'panel' | 'embankment' | 'industrial' | 'rail';

interface RouteNode {
  /** corner position in grid units */
  gx: number;
  gz: number;
  /** fillet radius (m) */
  r: number;
}

/**
 * Clockwise loop. Start/finish on the avenue (z = 0) heading east.
 *   avenue (tram, downtown) → overpass over the railway → panel district → embankment with the
 *   tunnel under Vosstaniya Square → industrial zig-zag between garages → back onto the avenue.
 */
const NODES: RouteNode[] = [
  { gx: 3, gz: 0, r: 38 },
  { gx: 3, gz: 3, r: 30 },
  { gx: 1, gz: 3, r: 28 },
  { gx: 1, gz: 4, r: 28 },
  { gx: -3, gz: 4, r: 32 },
  { gx: -3, gz: 2, r: 26 },
  { gx: -2, gz: 2, r: 24 },
  { gx: -2, gz: 1, r: 24 },
  { gx: -3, gz: 1, r: 24 },
  { gx: -3, gz: 0, r: 30 },
];

export const RAIL_Z = 1.5 * GRID; // railway runs east–west under the overpass
export const RIVER_Z = 4 * GRID + FRONTAGE + 6; // embankment parapet line; water beyond
export const SQUARE = { x0: -1.9 * GRID, x1: -0.95 * GRID, z0: 3.35 * GRID, z1: 4.65 * GRID };
export const OVERPASS = { x: 3 * GRID, z0: 0.55 * GRID, z1: 2.45 * GRID, top0: 1.35 * GRID, top1: 1.65 * GRID, height: 6.5 };
export const TUNNEL = { z: 4 * GRID, x0: -0.2 * GRID, x1: -2.6 * GRID, cover0: -1.0 * GRID, cover1: -1.8 * GRID, depth: -6 };

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** road surface elevation at a point on the route (the zones are axis-aligned street segments) */
export function routeElevation(x: number, z: number): number {
  let y = 0;
  if (Math.abs(x - OVERPASS.x) < 2) y += OVERPASS.height * smooth(OVERPASS.z0, OVERPASS.top0, z) * (1 - smooth(OVERPASS.top1, OVERPASS.z1, z));
  if (Math.abs(z - TUNNEL.z) < 2) y += TUNNEL.depth * smooth(-TUNNEL.x0, -TUNNEL.cover0, -x) * (1 - smooth(-TUNNEL.cover1, -TUNNEL.x1, -x));
  return y;
}

export interface RoutePoint {
  x: number;
  z: number;
  y: number;
}

/** Dense centreline: straights every `step` m, fillet arcs every ~5°. Starts on the avenue. */
export function routePoints(step = 8): RoutePoint[] {
  const n = NODES.length;
  const pts: RoutePoint[] = [];
  const P = NODES.map((c) => ({ x: c.gx * GRID, z: c.gz * GRID, r: c.r }));
  // tangent points of each fillet
  const fil = P.map((c, i) => {
    const prev = P[(i - 1 + n) % n], next = P[(i + 1) % n];
    const ax = prev.x - c.x, az = prev.z - c.z, al = Math.hypot(ax, az);
    const bx = next.x - c.x, bz = next.z - c.z, bl = Math.hypot(bx, bz);
    const ux = ax / al, uz = az / al, vx = bx / bl, vz = bz / bl;
    const ang = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    const t = c.r / Math.tan(ang / 2); // distance from the corner to each tangent point
    const inX = c.x + ux * t, inZ = c.z + uz * t;
    const outX = c.x + vx * t, outZ = c.z + vz * t;
    // arc centre along the bisector
    const bisX = ux + vx, bisZ = uz + vz, bisL = Math.hypot(bisX, bisZ);
    const d = c.r / Math.sin(ang / 2);
    const cx = c.x + (bisX / bisL) * d, cz = c.z + (bisZ / bisL) * d;
    return { inX, inZ, outX, outZ, cx, cz, r: c.r };
  });
  for (let i = 0; i < n; i++) {
    const f = fil[i];
    // arc from in → out around the centre
    const a0 = Math.atan2(f.inZ - f.cz, f.inX - f.cx);
    let a1 = Math.atan2(f.outZ - f.cz, f.outX - f.cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    a1 = a0 + da;
    const k = Math.max(2, Math.ceil(Math.abs(da) / (5 * Math.PI / 180)));
    for (let j = 0; j < k; j++) {
      const a = a0 + (da * j) / k;
      pts.push({ x: f.cx + Math.cos(a) * f.r, z: f.cz + Math.sin(a) * f.r, y: 0 });
    }
    // straight to the next fillet
    const g = fil[(i + 1) % n];
    const len = Math.hypot(g.inX - f.outX, g.inZ - f.outZ);
    const m = Math.max(1, Math.round(len / step));
    for (let j = 0; j < m; j++) {
      const t = j / m;
      pts.push({ x: f.outX + (g.inX - f.outX) * t, z: f.outZ + (g.inZ - f.outZ) * t, y: 0 });
    }
  }
  for (const p of pts) p.y = routeElevation(p.x, p.z);
  // rotate so the lap starts on the avenue, ~100 m after the last corner
  const start = pts.reduce((best, p, i) => (Math.hypot(p.x + 2 * GRID, p.z) < Math.hypot(pts[best].x + 2 * GRID, pts[best].z) ? i : best), 0);
  return [...pts.slice(start), ...pts.slice(0, start)];
}

/** Axis-aligned street segments of the grid inside the city area (for pavements and side streets). */
export interface Street {
  /** 'x' = runs east–west at constant z; 'z' = runs north–south at constant x */
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  /** the race route uses this street */
  route: boolean;
}

export const CITY_BOUNDS = { gx0: -5, gx1: 5, gz0: -2, gz1: 5 };

export function districtAt(x: number, z: number): District {
  if (Math.abs(z - RAIL_Z) < 22) return 'rail';
  if (z > 3.5 * GRID) return 'embankment';
  if (x < -1.5 * GRID && z > 0.5 * GRID) return 'industrial';
  if (x > 0.5 * GRID && z > 2 * GRID) return 'panel';
  return 'downtown';
}
