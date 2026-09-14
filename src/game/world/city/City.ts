import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackData } from '../TrackData';
import { softSpriteTexture } from '../textures';
import { BUILD, LOT_SIZE, type Archetype, type Lot } from './buildings';
import { GeoBuilder, createCityMaterial, type LampSpace } from './kit';
import type { CellName } from './atlas';
import { billboard, busStop, kiosk, parkedCars, trafficLight, trees } from './street';
import { CITY_BOUNDS, GRID, OVERPASS, PAVEMENT, RAIL_Z, ROAD_WIDTH, SQUARE, TUNNEL, districtAt, routeElevation, type District } from './layout';

/**
 * Neon City: streets, blocks, buildings and structures generated from world/city/layout.ts.
 * Geometry is merged per sector (2×2 blocks) into one mesh with the shared city material, so the
 * frustum culls whole sectors and a sector costs one draw call. Street lamps light facades and
 * pavements analytically in the shader (kit.ts); the race road gets light-pool decals.
 */
export interface CityRig {
  group: THREE.Group;
  update(t: number): void;
  dispose(): void;
  stats: { sectors: number; buildings: number; triangles: number; lamps: number };
}

const HALF = ROAD_WIDTH / 2;
const CURB = 0.15;
const LAMP_SPACING = 30;
/** lamp line distance from the street centreline (on the pavement, behind the race barrier) */
const LAMP_OFF = HALF + 3.3;
const LAMP_H = 8.5;
/** trench / overpass walls sit just outside the race barriers */
const WALL = HALF + 2.2;
const RIVER_Y = -3.4;
const STREET_Y = -0.06;
const UP = { x: 0, y: 1, z: 0 };
const DOWN = { x: 0, y: -1, z: 0 };

type V = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): V => ({ x, y, z });

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const range = (a: number, b: number) => a + rnd() * (b - a);

export function buildCity(track: TrackData, quality: { level: 'low' | 'medium' | 'high' }): CityRig {
  seed = 20260914;
  const group = new THREE.Group();
  group.name = 'city';
  const disposables: { dispose(): void }[] = [];
  const { gx0, gx1, gz0 } = CITY_BOUNDS;
  const GZ_RIVER = 4;

  // ── route distance lookup (spatial hash of centreline samples)
  const HASH = 24;
  const hash = new Map<string, THREE.Vector3[]>();
  for (const s of track.samples) {
    const k = `${Math.floor(s.pos.x / HASH)},${Math.floor(s.pos.z / HASH)}`;
    const list = hash.get(k);
    if (list) list.push(s.pos);
    else hash.set(k, [s.pos]);
  }
  const routeDist = (x: number, z: number): number => {
    const cx = Math.floor(x / HASH), cz = Math.floor(z / HASH);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const p of hash.get(`${cx + dx},${cz + dz}`) ?? []) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
      }
    }
    return Math.sqrt(best);
  };
  const onRoute = (x: number, z: number) => routeDist(x, z) < 6;

  // ── sectors: one GeoBuilder per 2×2 blocks
  const sectors = new Map<string, GeoBuilder>();
  const gb = (x: number, z: number): GeoBuilder => {
    const k = `${Math.floor(x / (GRID * 2))},${Math.floor(z / (GRID * 2))}`;
    let b = sectors.get(k);
    if (!b) sectors.set(k, (b = new GeoBuilder()));
    return b;
  };

  const inOverpass = (x: number, z: number) => Math.abs(x - OVERPASS.x) < HALF + 3 && z > OVERPASS.z0 - 8 && z < OVERPASS.z1 + 8;
  const inTunnel = (x: number, z: number) => Math.abs(z - TUNNEL.z) < HALF + 3 && x < TUNNEL.x0 + 8 && x > TUNNEL.x1 - 8;
  const inRail = (z: number) => Math.abs(z - RAIL_Z) < 20;

  /** lamp space for a surface along a street: s runs along `axis`, perp measured from the lamp line */
  const lampSpace = (s0: number, s1: number, perp0: number, perp1: number, k = 1): LampSpace => ({ s0, s1, perp0, perp1, spacing: LAMP_SPACING, height: LAMP_H, k });

  // ── streets
  const lamps: V[] = [];
  /** horizontal rect; lamp s runs along x (p0→p1), perp across z (perp0 at z1, perp1 at z0) */
  const flat = (b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, cell: CellName, tile: number, lamp?: LampSpace) =>
    b.quadFacing(UP, v(x0, y, z1), v(x1, y, z1), v(x1, y, z0), v(x0, y, z0), cell, [(x1 - x0) / tile, (z1 - z0) / tile], 0, [0, 0], lamp);
  /** horizontal rect for north–south streets; lamp s runs along z, perp across x (perp0 at x0, perp1 at x1) */
  const flatZ = (b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, cell: CellName, tile: number, lamp?: LampSpace) =>
    b.quadFacing(UP, v(x0, y, z0), v(x0, y, z1), v(x1, y, z1), v(x1, y, z0), cell, [(z1 - z0) / tile, (x1 - x0) / tile], 0, [0, 0], lamp);

  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz < GZ_RIVER; gz++) {
      const x = gx * GRID, za = gz * GRID + HALF, zb = (gz + 1) * GRID - HALF;
      const cuts: [number, number][] = [[RAIL_Z - 20, RAIL_Z + 20]];
      if (Math.abs(x - OVERPASS.x) < 1) cuts.push([OVERPASS.z0 - 6, OVERPASS.z1 + 6]);
      for (const [a, b] of pieces(za, zb, cuts)) flat(gb(x, (a + b) / 2), x - HALF, a, x + HALF, b, STREET_Y, 'courtyard', 6);
      if (onRoute(x, (za + zb) / 2)) addLamps('z', x, za, zb);
    }
  }
  for (let gz = gz0; gz <= GZ_RIVER; gz++) {
    for (let gx = gx0; gx < gx1; gx++) {
      const z = gz * GRID, xa = gx * GRID + HALF, xb = (gx + 1) * GRID - HALF;
      const cuts: [number, number][] = Math.abs(z - TUNNEL.z) < 1 ? [[TUNNEL.x1 - 6, TUNNEL.x0 + 6]] : [];
      for (const [a, b] of pieces(xa, xb, cuts)) flat(gb((a + b) / 2, z), a, z - HALF, b, z + HALF, STREET_Y, 'courtyard', 6);
      if (onRoute((xa + xb) / 2, z)) addLamps('x', z, xa, xb);
    }
  }
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= GZ_RIVER; gz++) {
      const x = gx * GRID, z = gz * GRID;
      if (inOverpass(x, z) || inTunnel(x, z)) continue;
      flat(gb(x, z), x - HALF, z - HALF, x + HALF, z + HALF, STREET_Y, 'courtyard', 6);
    }
  }

  function pieces(a: number, b: number, cuts: [number, number][]): [number, number][] {
    const out: [number, number][] = [];
    let cur = a;
    for (const [c0, c1] of [...cuts].sort((p, q) => p[0] - q[0])) {
      if (c1 <= cur || c0 >= b) continue;
      if (c0 > cur) out.push([cur, c0]);
      cur = Math.max(cur, c1);
    }
    if (cur < b) out.push([cur, b]);
    return out;
  }

  function addLamps(axis: 'x' | 'z', at: number, from: number, to: number): void {
    for (let s = Math.floor(from / LAMP_SPACING) * LAMP_SPACING + LAMP_SPACING / 2; s < to; s += LAMP_SPACING) {
      if (s < from + 3 || s > to - 3) continue;
      for (const side of [-1, 1]) {
        const x = axis === 'x' ? s : at + side * LAMP_OFF;
        const z = axis === 'x' ? at + side * LAMP_OFF : s;
        if (axis === 'x' ? inTunnel(s, at) : inOverpass(at, s)) continue;
        if (axis === 'z' && inRail(s)) continue;
        lamps.push(v(x, 0, z));
      }
    }
  }

  // ── blocks: pavements, curbs, courtyards and lots
  let buildingCount = 0;
  const treeSpots: { x: number; y: number; z: number; s: number }[] = [];
  const parkSpots: { x: number; y: number; z: number; rot: number }[] = [];
  const archetypeFor = (d: District, route: boolean): Archetype => {
    const r = rnd();
    switch (d) {
      case 'downtown':
        return route ? (r < 0.72 ? 'stalinka' : 'tower') : r < 0.5 ? 'stalinka' : r < 0.75 ? 'brick5' : 'tower';
      case 'panel':
        return r < 0.7 ? 'panel9' : 'brick5';
      case 'industrial':
        return r < 0.55 ? 'garages' : 'warehouse';
      case 'rail':
        return r < 0.5 ? 'warehouse' : 'brick5';
      case 'embankment':
        return r < 0.6 ? 'stalinka' : 'brick5';
    }
  };

  type Side = 'n' | 's' | 'w' | 'e';
  for (let gx = gx0; gx < gx1; gx++) {
    for (let gz = gz0; gz < GZ_RIVER; gz++) {
      const x0 = gx * GRID + HALF, x1 = (gx + 1) * GRID - HALF;
      const zA = gz * GRID + HALF, zB = (gz + 1) * GRID - HALF;
      const rects: { z0: number; z1: number; sides: Side[] }[] = gz === 1
        ? [{ z0: zA, z1: RAIL_Z - 20, sides: ['n'] }, { z0: RAIL_Z + 20, z1: zB, sides: ['s'] }] // the railway cuts this row in two
        : [{ z0: zA, z1: zB, sides: ['n', 's', 'w', 'e'] }];
      const plaza = x0 < SQUARE.x1 && x1 > SQUARE.x0 && zA < SQUARE.z1 && zB > SQUARE.z0;
      for (const r of rects) {
        blockSlab(x0, r.z0, x1, r.z1, plaza, r.sides);
        if (!plaza) placeLots(x0, r.z0, x1, r.z1, r.sides);
      }
    }
  }

  function blockSlab(x0: number, z0: number, x1: number, z1: number, plaza: boolean, sides: Side[]): void {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const b = gb(cx, cz);
    const y = CURB, P = PAVEMENT, L = LAMP_OFF - HALF;
    const pave: CellName = plaza ? 'granite' : 'pavement';
    const has = (s: Side) => sides.includes(s);
    // pavement strips; perp = signed distance from the street's lamp line (curb side −L … facade side P−L)
    const nz = has('n') ? P : 0, sz = has('s') ? P : 0;
    if (has('n')) flat(b, x0, z0, x1, z0 + P, y, pave, 3, onRoute(cx, z0 - HALF) ? lampSpace(x0, x1, P - L, -L) : undefined);
    if (has('s')) flat(b, x0, z1 - P, x1, z1, y, pave, 3, onRoute(cx, z1 + HALF) ? lampSpace(x0, x1, -L, P - L) : undefined);
    flatZ(b, x0, z0 + nz, x0 + P, z1 - sz, y, pave, 3, onRoute(x0 - HALF, cz) ? lampSpace(z0 + nz, z1 - sz, -L, P - L) : undefined);
    flatZ(b, x1 - P, z0 + nz, x1, z1 - sz, y, pave, 3, onRoute(x1 + HALF, cz) ? lampSpace(z0 + nz, z1 - sz, P - L, -L) : undefined);
    // inner courtyard / plaza with trees
    const grass = !plaza && rnd() < 0.55;
    flat(b, x0 + P, z0 + nz, x1 - P, z1 - sz, y, plaza ? 'granite' : grass ? 'grass' : 'courtyard', 5);
    if (plaza) {
      for (let tx = x0 + 12; tx < x1 - 8; tx += 13) for (const tz of [z0 + 12, z1 - 12]) treeSpots.push({ x: tx, y, z: tz, s: 1.1 });
    } else if (z1 - z0 > 50) {
      const n = grass ? 7 : 3;
      for (let i = 0; i < n; i++) treeSpots.push({ x: range(x0 + 26, x1 - 26), y, z: range(z0 + 26, z1 - 26), s: range(0.8, 1.3) });
    }
    // curb faces toward the streets
    const curb = (a: V, c: V, dir: V) => b.quadFacing(dir, v(a.x, STREET_Y, a.z), v(c.x, STREET_Y, c.z), v(c.x, y, c.z), v(a.x, y, a.z), 'granite', [Math.hypot(c.x - a.x, c.z - a.z) / 2, 0.1]);
    curb(v(x0, 0, z0), v(x1, 0, z0), v(0, 0, -1));
    curb(v(x0, 0, z1), v(x1, 0, z1), v(0, 0, 1));
    curb(v(x0, 0, z0), v(x0, 0, z1), v(-1, 0, 0));
    curb(v(x1, 0, z0), v(x1, 0, z1), v(1, 0, 0));
    if (plaza) {
      // a stela in the middle of the square
      const all = (cell: CellName, t: [number, number]) => ({ front: { cell, tile: t }, back: { cell, tile: t }, left: { cell, tile: t }, right: { cell, tile: t } });
      b.box(cx, cz, y, 5, 5, 1.2, 0, { ...all('granite', [1, 0.4]), top: { cell: 'granite', tile: [1, 1] } });
      b.box(cx, cz, y + 1.2, 1.6, 1.6, 24, 0, { ...all('concrete', [0.5, 6]), top: { cell: 'towerCrown', tile: [1, 1] } });
    }
  }

  function placeLots(x0: number, z0: number, x1: number, z1: number, sides: Side[]): void {
    const P = PAVEMENT;
    for (const side of sides) {
      const horiz = side === 'n' || side === 's';
      const from = horiz ? x0 + P : z0 + P + 18;
      const to = horiz ? x1 - P : z1 - P - 18;
      if (to - from < 20) continue;
      const mid = side === 'n' ? v((x0 + x1) / 2, 0, z0 - HALF) : side === 's' ? v((x0 + x1) / 2, 0, z1 + HALF) : side === 'w' ? v(x0 - HALF, 0, (z0 + z1) / 2) : v(x1 + HALF, 0, (z0 + z1) / 2);
      const route = onRoute(mid.x, mid.z);
      const district = districtAt(mid.x, mid.z);
      const rot = side === 's' ? 0 : side === 'n' ? Math.PI : side === 'e' ? Math.PI / 2 : -Math.PI / 2;
      let s = from + range(0, 3);
      while (s < to - 16) {
        const arch = archetypeFor(district, route);
        const [lmin, lmax, depth] = LOT_SIZE[arch];
        let len = Math.min(range(lmin, lmax), to - s);
        if (len < lmin * 0.7) break;
        let placed = false;
        for (let tries = 0; tries < 4 && len >= lmin * 0.6; tries++) {
          const lot = lotAt(side, x0, z0, x1, z1, s, len, depth, rot);
          if (route) lot.lamp = { axis: horiz ? 'x' : 'z', perp: P - (LAMP_OFF - HALF), spacing: LAMP_SPACING, height: LAMP_H };
          if (clearOfRoute(lot)) {
            const h = BUILD[arch](gb(lot.cx, lot.cz), lot, rnd);
            if (route && arch !== 'tower' && arch !== 'garages' && rnd() < 0.2) {
              billboard(gb, lot.cx, lot.cz, lot.y0 + h, lot.rot, rnd() < 0.5 ? 'adRival1' : 'adRival2', 2.2);
            }
            buildingCount++;
            placed = true;
            break;
          }
          len *= 0.72;
        }
        s += (placed ? len : 8) + range(3, 9);
      }
    }
  }

  function lotAt(side: Side, x0: number, z0: number, x1: number, z1: number, s: number, len: number, depth: number, rot: number): Lot {
    const P = PAVEMENT;
    const mid = s + len / 2;
    const cx = side === 'n' || side === 's' ? mid : side === 'w' ? x0 + P + depth / 2 : x1 - P - depth / 2;
    const cz = side === 'w' || side === 'e' ? mid : side === 'n' ? z0 + P + depth / 2 : z1 - P - depth / 2;
    return { cx, cz, y0: CURB, rot, len, depth, seed: rnd() };
  }

  function clearOfRoute(lot: Lot): boolean {
    const cs = Math.cos(lot.rot), sn = Math.sin(lot.rot);
    // archetypes round the length up to whole bays: test a little beyond the lot
    for (const [lx, lz] of [[-0.55, 0.5], [0.55, 0.5], [-0.55, -0.5], [0.55, -0.5], [0, 0.5], [-0.3, 0.5], [0.3, 0.5]]) {
      const px = lx * lot.len, pz = lz * lot.depth;
      const x = lot.cx + px * cs + pz * sn, z = lot.cz - px * sn + pz * cs;
      if (routeDist(x, z) < HALF + PAVEMENT - 0.5) return false;
      if (inRail(z) || inTunnel(x, z) || inOverpass(x, z)) return false;
    }
    return true;
  }

  // ── railway corridor: ballast, rails, fences; a level crossing where the route crosses it
  {
    const xa = gx0 * GRID, xb = gx1 * GRID;
    // route streets crossing the corridor (north–south streets that carry the race)
    const crossings: number[] = [];
    for (let gx = gx0; gx <= gx1; gx++) if (onRoute(gx * GRID, RAIL_Z)) crossings.push(gx * GRID);
    const cuts: [number, number][] = crossings.map((x) => [x - WALL - 1, x + WALL + 1]);
    cuts.push([OVERPASS.x - WALL - 1, OVERPASS.x + WALL + 1]);
    for (const [a, b] of pieces(xa, xb, cuts)) {
      for (let x = a; x < b; x += GRID) {
        const x1 = Math.min(b, x + GRID);
        const bld = gb((x + x1) / 2, RAIL_Z);
        flat(bld, x, RAIL_Z - 20, x1, RAIL_Z + 20, 0, 'ballast', 4);
        for (const tz of [RAIL_Z - 7, RAIL_Z + 7]) {
          for (const rz of [tz - 0.76, tz + 0.76]) {
            const rail = { cell: 'metalVent' as CellName, tile: [(x1 - x) / 4, 1] as [number, number] };
            bld.box((x + x1) / 2, rz, 0, x1 - x, 0.14, 0.18, 0, { front: rail, back: rail, top: rail });
          }
        }
        for (const fz of [RAIL_Z - 20, RAIL_Z + 20]) {
          for (const dir of [-1, 1]) bld.quadFacing(v(0, 0, dir), v(x, 0, fz), v(x1, 0, fz), v(x1, 2.6, fz), v(x, 2.6, fz), 'fencePanel', [(x1 - x) / 3, 1]);
        }
      }
    }
    // under the overpass the ballast continues (the deck is above)
    flat(gb(OVERPASS.x, RAIL_Z), OVERPASS.x - WALL - 1, RAIL_Z - 20, OVERPASS.x + WALL + 1, RAIL_Z + 20, 0, 'ballast', 4);
    for (const cx of crossings) {
      const bld = gb(cx, RAIL_Z);
      flat(bld, cx - WALL - 1, RAIL_Z - 20, cx + WALL + 1, RAIL_Z + 20, STREET_Y, 'courtyard', 6);
      // rails flush with the road surface, crossing signal posts with red lamps, raised barrier arms
      for (const tz of [RAIL_Z - 7, RAIL_Z + 7]) {
        for (const rz of [tz - 0.76, tz + 0.76]) flat(bld, cx - WALL - 1, rz - 0.07, cx + WALL + 1, rz + 0.07, 0.02, 'metalVent', 2);
      }
      for (const side of [-1, 1]) {
        const px = cx + side * (HALF + 1.8);
        for (const pz of [RAIL_Z - 22, RAIL_Z + 22]) {
          const post = { cell: 'fencePanel' as CellName, tile: [0.1, 1] as [number, number] };
          bld.box(px, pz, 0, 0.25, 0.25, 3.6, 0, { front: post, back: post, left: post, right: post });
          const lamp = { cell: 'shopShawarma' as CellName, tile: [0.12, 0.12] as [number, number], start: [0.5, 0.78] as [number, number] };
          bld.box(px, pz, 3.1, 0.9, 0.3, 0.45, 0, { front: lamp, back: lamp, left: lamp, right: lamp, top: lamp });
          // barrier arm pointing up
          const arm = { cell: 'panelStripe' as CellName, tile: [0.2, 0.2] as [number, number], start: [0.4, 0.05] as [number, number] };
          bld.box(px - side * 0.4, pz, 1.2, 0.18, 0.18, 6.5, 0, { front: arm, back: arm, left: arm, right: arm });
        }
      }
    }
  }

  // ── overpass: fill walls on the ramps, an open deck over the railway
  {
    const X = OVERPASS.x;
    const step = 4;
    for (let z = OVERPASS.z0 - 4; z < OVERPASS.z1 + 4; z += step) {
      const ya = routeElevation(X, z), yb = routeElevation(X, z + step);
      if (ya < 0.05 && yb < 0.05) continue;
      const overRail = z + step > RAIL_Z - 20 && z < RAIL_Z + 20;
      const bA = overRail ? ya - 1.4 : STREET_Y, bB = overRail ? yb - 1.4 : STREET_Y;
      for (const side of [-1, 1]) {
        const x = X + side * WALL, xi = X + side * (WALL - 0.5), xe = X + side * HALF;
        const b = gb(x, z);
        const out = v(side, 0, 0), inward = v(-side, 0, 0);
        b.quadFacing(out, v(x, bA, z), v(x, bB, z + step), v(x, yb + 1.1, z + step), v(x, ya + 1.1, z), 'concrete', [step / 4, Math.max(0.3, (ya + 1.1 - bA) / 4)]);
        b.quadFacing(UP, v(xi, ya + 1.1, z), v(xi, yb + 1.1, z + step), v(x, yb + 1.1, z + step), v(x, ya + 1.1, z), 'concrete', [step / 4, 0.15]);
        b.quadFacing(inward, v(xi, ya, z), v(xi, yb, z + step), v(xi, yb + 1.1, z + step), v(xi, ya + 1.1, z), 'concrete', [step / 4, 0.3]);
        b.quadFacing(UP, v(xe, ya - 0.01, z), v(xe, yb - 0.01, z + step), v(xi, yb - 0.01, z + step), v(xi, ya - 0.01, z), 'courtyard', [step / 4, 0.4]);
      }
      if (overRail) gb(X, z).quadFacing(DOWN, v(X - WALL, bA, z), v(X + WALL, bA, z), v(X + WALL, bB, z + step), v(X - WALL, bB, z + step), 'concrete', [WALL / 2, step / 4]);
    }
    for (const [z, dir] of [[RAIL_Z - 20, 1], [RAIL_Z + 20, -1]] as const) {
      const y = routeElevation(X, z) - 1.4;
      gb(X, z).quadFacing(v(0, 0, dir), v(X - WALL, 0, z), v(X + WALL, 0, z), v(X + WALL, y, z), v(X - WALL, y, z), 'concrete', [WALL / 2, y / 4]);
    }
    const pier = { cell: 'concrete' as CellName, tile: [0.4, 1.3] as [number, number] };
    for (const px of [X - 6, X + 6]) gb(px, RAIL_Z).box(px, RAIL_Z, 0, 1.4, 1.4, OVERPASS.height - 1.4, 0, { front: pier, back: pier, left: pier, right: pier });
  }

  // ── tunnel under the square: trench walls, roof, portals
  {
    const Z = TUNNEL.z;
    const step = 4;
    for (let x = TUNNEL.x1 - 4; x < TUNNEL.x0 + 4; x += step) {
      const ya = routeElevation(x, Z), yb = routeElevation(x + step, Z);
      if (ya > -0.05 && yb > -0.05) continue;
      const covered = x + step > TUNNEL.cover1 && x < TUNNEL.cover0;
      const top = covered ? -0.9 : 1.0;
      for (const side of [-1, 1]) {
        const z = Z + side * WALL, ze = Z + side * HALF;
        const b = gb(x, z);
        const lamp: LampSpace = { s0: x, s1: x + step, perp0: WALL, perp1: WALL, spacing: covered ? 10 : LAMP_SPACING, height: covered ? -1.4 : LAMP_H, k: covered ? 2.2 : 0.6 };
        b.quadFacing(v(0, 0, -side), v(x, ya, z), v(x + step, yb, z), v(x + step, top, z), v(x, top, z), 'tunnelWall', [step / 4, Math.max(0.3, (top - Math.min(ya, yb)) / 4)], 0, [0, 0], lamp);
        b.quadFacing(UP, v(x, ya - 0.01, ze), v(x + step, yb - 0.01, ze), v(x + step, yb - 0.01, z), v(x, ya - 0.01, z), 'courtyard', [step / 4, 0.4]);
        if (!covered) {
          const zp = Z + side * (WALL + 0.2);
          for (const dir of [-1, 1]) b.quadFacing(v(0, 0, dir), v(x, 0, zp), v(x + step, 0, zp), v(x + step, 1.0, zp), v(x, 1.0, zp), 'concrete', [step / 4, 0.25]);
        }
      }
      if (covered) {
        const b = gb(x, Z);
        b.quadFacing(DOWN, v(x, -0.9, Z - WALL), v(x + step, -0.9, Z - WALL), v(x + step, -0.9, Z + WALL), v(x, -0.9, Z + WALL), 'tunnelCeil', [step / 6, (WALL * 2) / 6]);
        flat(b, x, Z - WALL, x + step, Z + WALL, CURB, 'granite', 3);
      }
    }
    for (const [x, face] of [[TUNNEL.cover0, 1], [TUNNEL.cover1, -1]] as const) {
      gb(x, Z).quadFacing(v(face, 0, 0), v(x, -0.9, Z - WALL), v(x, -0.9, Z + WALL), v(x, 1.2, Z + WALL), v(x, 1.2, Z - WALL), 'towerLed', [(WALL * 2) / 6, 1]);
    }
  }

  // ── embankment: promenade, granite parapet, wall down to the water, the far bank
  {
    const zc = GZ_RIVER * GRID + HALF;
    const zp = zc + PAVEMENT;
    const L = LAMP_OFF - HALF;
    for (let x = gx0 * GRID; x < gx1 * GRID; x += GRID / 2) {
      const xb = x + GRID / 2;
      const b = gb(x + GRID / 4, zp);
      flat(b, x, zc, xb, zp, CURB, 'granite', 3, lampSpace(x, xb, PAVEMENT - L, -L));
      b.quadFacing(v(0, 0, -1), v(x, STREET_Y, zc), v(xb, STREET_Y, zc), v(xb, CURB, zc), v(x, CURB, zc), 'granite', [GRID / 4, 0.1]);
      const g = { cell: 'granite' as CellName, tile: [GRID / 6, 0.4] as [number, number] };
      b.box(x + GRID / 4, zp + 0.3, CURB, GRID / 2, 0.6, 1.0, 0, { front: g, back: g, top: { cell: 'granite', tile: [GRID / 6, 0.2] } });
      b.quadFacing(v(0, 0, 1), v(x, RIVER_Y - 1, zp + 0.6), v(xb, RIVER_Y - 1, zp + 0.6), v(xb, CURB, zp + 0.6), v(x, CURB, zp + 0.6), 'granite', [GRID / 6, 1.2]);
    }
    const farZ = zp + 150;
    for (let x = (gx0 - 2) * GRID; x < (gx1 + 2) * GRID; ) {
      const arch: Archetype = rnd() < 0.6 ? 'stalinka' : rnd() < 0.5 ? 'brick5' : 'panel9';
      const [lmin, lmax, depth] = LOT_SIZE[arch];
      const len = range(lmin, lmax);
      const lot: Lot = { cx: x + len / 2, cz: farZ + depth / 2, y0: 0, rot: Math.PI, len, depth, seed: rnd() };
      BUILD[arch](gb(lot.cx, lot.cz), lot, rnd);
      buildingCount++;
      x += len + range(2, 8);
    }
    const b = gb(0, farZ);
    flat(b, (gx0 - 2) * GRID, farZ - 8, (gx1 + 2) * GRID, farZ + 40, 0, 'granite', 12);
    b.quadFacing(v(0, 0, -1), v((gx0 - 2) * GRID, RIVER_Y - 1, farZ - 8), v((gx1 + 2) * GRID, RIVER_Y - 1, farZ - 8), v((gx1 + 2) * GRID, 0, farZ - 8), v((gx0 - 2) * GRID, 0, farZ - 8), 'granite', [80, 1]);
  }

  // ── tram tracks embedded in the avenue
  for (let x = (gx0 + 1) * GRID; x < (gx1 - 1) * GRID; x += GRID / 2) {
    for (const tz of [-2.4, 2.4]) {
      for (const rz of [tz - 0.72, tz + 0.72]) flat(gb(x + GRID / 4, 0), x, rz - 0.07, x + GRID / 2, rz + 0.07, 0.02, 'metalVent', 4);
    }
  }

  // ── street furniture: bus stops between lamps, kiosks and traffic lights at route corners,
  //    trees on the promenade, parked cars on the side streets next to the route
  {
    let stop = 0;
    for (let gx = gx0; gx < gx1; gx++) {
      for (let gz = gz0; gz <= GZ_RIVER; gz++) {
        const z = gz * GRID, xa = gx * GRID + HALF, xb = (gx + 1) * GRID - HALF;
        if (!onRoute((xa + xb) / 2, z) || inTunnel((xa + xb) / 2, z)) continue;
        if (stop++ % 3 === 1) busStop(gb, (xa + xb) / 2 + 15, z - (HALF + 3.1), CURB, Math.PI);
        if (gz === GZ_RIVER) for (let x = xa + 8; x < xb; x += LAMP_SPACING) treeSpots.push({ x, y: CURB, z: z + HALF + 3.6, s: 0.9 });
      }
    }
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= GZ_RIVER; gz++) {
        const x = gx * GRID, z = gz * GRID;
        if (!onRoute(x, z) && routeDist(x, z) > 45) continue;
        if (inTunnel(x, z) || inOverpass(x, z) || inRail(z)) continue;
        // four pavement corners of the intersection
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const cx = x + sx * (HALF + 1.6), cz = z + sz * (HALF + 1.6);
          if (gz === GZ_RIVER && sz > 0) continue;
          if (routeDist(cx, cz) < HALF + 1.2) continue;
          const r = rnd();
          if (onRoute(x, z)) trafficLight(gb, cx, cz, CURB, Math.atan2(-sx, -sz));
          else if (r < 0.35) kiosk(gb, x + sx * (HALF + 3.5), z + sz * (HALF + 7), CURB, sz > 0 ? 0 : Math.PI, Math.floor(r * 100));
        }
      }
    }
    if (quality.level !== 'low') {
      // side streets that touch the route: cars along both curbs for the first ~45 m
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz < GZ_RIVER; gz++) {
          const x = gx * GRID;
          for (const [a, dir] of [[gz * GRID + HALF + 4, 1], [(gz + 1) * GRID - HALF - 4, -1]] as const) {
            if (onRoute(x, (gz + 0.5) * GRID) || routeDist(x, a - dir * 12) > HALF + 6 || inRail(a)) continue;
            for (let k = 0; k < 5; k++) {
              const zz = a + dir * k * 7.5;
              for (const side of [-1, 1]) if (rnd() < 0.55) parkSpots.push({ x: x + side * (HALF - 1.4), y: STREET_Y, z: zz, rot: dir > 0 ? 0 : Math.PI });
            }
          }
        }
      }
      for (let gz = gz0; gz <= GZ_RIVER; gz++) {
        for (let gx = gx0; gx < gx1; gx++) {
          const z = gz * GRID;
          for (const [a, dir] of [[gx * GRID + HALF + 4, 1], [(gx + 1) * GRID - HALF - 4, -1]] as const) {
            if (onRoute((gx + 0.5) * GRID, z) || routeDist(a - dir * 12, z) > HALF + 6 || inTunnel(a, z)) continue;
            for (let k = 0; k < 5; k++) {
              const xx = a + dir * k * 7.5;
              for (const side of [-1, 1]) if (rnd() < 0.55) parkSpots.push({ x: xx, y: STREET_Y, z: z + side * (HALF - 1.4), rot: dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
            }
          }
        }
      }
    }
  }

  // ── lamp posts: pole, arm over the road, glowing head
  const pole = { cell: 'metalVent' as CellName, tile: [0.1, 2] as [number, number] };
  const head = { cell: 'tunnelCeil' as CellName, tile: [0.1, 0.12] as [number, number], start: [0.45, 0.78] as [number, number] };
  for (const l of lamps) {
    const b = gb(l.x, l.z);
    b.box(l.x, l.z, CURB, 0.28, 0.28, LAMP_H, 0, { front: pole, back: pole, left: pole, right: pole });
    // the arm points at the road: toward the nearest route sample
    const pr = track.projectGlobal(l.x, l.z);
    const s = track.samples[pr.idx].pos;
    const dx = s.x - l.x, dz = s.z - l.z, dl = Math.hypot(dx, dz) || 1;
    const ax = (dx / dl) * 1.6, az = (dz / dl) * 1.6;
    const along = Math.abs(dx) > Math.abs(dz);
    b.box(l.x + ax, l.z + az, CURB + LAMP_H - 0.25, along ? 3.2 : 0.5, along ? 0.5 : 3.2, 0.3, 0, { front: head, back: head, left: head, right: head, top: { cell: 'metalVent', tile: [0.2, 0.2] } });
  }

  // ── merge sectors
  const { material, uniforms } = createCityMaterial(true);
  disposables.push(material);
  let triangles = 0;
  for (const [key, b] of sectors) {
    if (!b.vertexCount) continue;
    const geo = b.toGeometry();
    triangles += (geo.index?.count ?? 0) / 3;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `city:${key}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    disposables.push(geo);
  }

  // ── trees and parked cars (instanced)
  {
    const t = trees(treeSpots);
    group.add(t.mesh);
    disposables.push(t);
    const cars = parkedCars(parkSpots.slice(0, quality.level === 'high' ? 60 : 28));
    for (const m of cars.meshes) group.add(m);
    disposables.push(cars);
  }

  // ── water: one reflective plane
  {
    const w = (gx1 - gx0 + 8) * GRID;
    const g = new THREE.PlaneGeometry(w, 180);
    g.rotateX(-Math.PI / 2);
    g.translate(((gx0 + gx1) / 2) * GRID, RIVER_Y, GZ_RIVER * GRID + HALF + PAVEMENT + 88);
    const m = new THREE.MeshStandardMaterial({ color: '#07131c', roughness: 0.06, metalness: 0, envMapIntensity: 1.3 });
    const water = new THREE.Mesh(g, m);
    water.name = 'city:water';
    group.add(water);
    disposables.push(g, m);
  }

  // ── light pools on the race road under the lamps and in the tunnel
  {
    const pools: THREE.BufferGeometry[] = [];
    const add = (x: number, y: number, z: number, r: number) => {
      const p = new THREE.PlaneGeometry(r, r);
      p.rotateX(-Math.PI / 2);
      p.translate(x, y + 0.05, z);
      pools.push(p);
    };
    for (const l of lamps) {
      if (routeDist(l.x, l.z) > LAMP_OFF + 2) continue;
      const pr = track.projectGlobal(l.x, l.z);
      const s = track.samples[pr.idx];
      const p = s.pos.clone().addScaledVector(s.left, (Math.sign(pr.lat) || 1) * (HALF - 2.5));
      add(p.x, s.pos.y, p.z, 11);
    }
    for (let x = TUNNEL.cover1; x < TUNNEL.cover0; x += 10) add(x, routeElevation(x, TUNNEL.z), TUNNEL.z, 7);
    if (pools.length) {
      const geo = mergeGeometries(pools)!;
      pools.forEach((p) => p.dispose());
      const tex = softSpriteTexture(1, 0);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#ffb25c', transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      mesh.name = 'city:pools';
      group.add(mesh);
      disposables.push(geo, mat, tex);
    }
  }

  return {
    group,
    stats: { sectors: sectors.size, buildings: buildingCount, triangles, lamps: lamps.length },
    update(t: number) {
      uniforms.time.value = t;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
