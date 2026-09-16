import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import polygonClipping from 'polygon-clipping';
import type { TrackData } from '../TrackData';
import type { Lamp } from '../../render/LampField';
import { GeoBuilder, createCityMaterial, type LampSpace } from '../city/kit';
import type { CellName } from '../city/atlas';
import { parkedCars, trafficLight, trees } from '../city/street';
import { BUILDING_KIND as K, type Flat, type OsmStyle, type OsmWorld } from './types';
import { getGLTF } from '../../assets';

/**
 * A real place built from OpenStreetMap data (scripts/osm-map.mjs): ground and water with embankment
 * walls, streets, parks and squares, rails, building footprints extruded with facade modules of the
 * city kit (tinted per building), street lamps along the race route, bridges where the route crosses
 * water. Everything static merges per 192 m sector into one mesh with the shared city material.
 *
 * Height layers (m) keep coplanar surfaces apart: ground −0.40, railway land −0.34, parks −0.30,
 * squares −0.26, footways −0.20, streets −0.12, race road 0 (TrackMesh), route pavement +0.15.
 */
/** a building wall facing an arena: A→B along the ground, n = unit normal towards the yard, h = eaves height */
export interface YardWall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  h: number;
}

export interface OsmCityRig {
  group: THREE.Group;
  /** t = elapsed seconds; the camera position lets distant tree cells switch off */
  update(t: number, camX?: number, camZ?: number): void;
  dispose(): void;
  lamps: Lamp[];
  /** arena mode: walls within 14 m of the rim that face the yard (for wall dressing) */
  walls: YardWall[];
  stats: { sectors: number; buildings: number; triangles: number; lamps: number };
}

const PAVE = 5;
const CURB = 0.15;
const LAMP_SPACING = 30;
const LAMP_H = 8.5;
const GROUND_Y = -0.4;
const AREA_Y: Record<number, number> = { 1: -0.3, 2: -0.26, 3: -0.34 };
const FOOT_Y = -0.2;
const STREET_Y = -0.12;
const WATER_Y: Record<OsmStyle, number> = { shch: -1.9, spb: -3.2, waw: -2.4 };

type V = { x: number; y: number; z: number };
type P2 = { x: number; z: number };
const v = (x: number, y: number, z: number): V => ({ x, y, z });
const UP = v(0, 1, 0);

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length];

const decode = (f: Flat): P2[] => {
  const out: P2[] = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push({ x: f[i] / 10, z: f[i + 1] / 10 });
  return out;
};
const area = (r: P2[]): number => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};
function inside(pt: P2, r: P2[]): boolean {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i].z > pt.z !== r[j].z > pt.z && pt.x < ((r[j].x - r[i].x) * (pt.z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) hit = !hit;
  }
  return hit;
}
function triangulate(outer: P2[], holes: P2[][] = []): { pts: P2[]; tris: number[][] } {
  const contour = outer.map((p) => new THREE.Vector2(p.x, p.z));
  const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  return { pts: [...outer, ...holes.flat()], tris };
}

/** plaster colours relative to the neutral plaster module (#d9d4ca) */
const NEUTRAL = new THREE.Color('#d9d4ca');
const tintOf = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [Math.min(1.25, c.r / NEUTRAL.r), Math.min(1.25, c.g / NEUTRAL.g), Math.min(1.25, c.b / NEUTRAL.b)];
};
const SPB_PAINT = ['#e2c07e', '#e6d3a3', '#d9a38f', '#b9c7a6', '#a9bccb', '#e9e0cc', '#c98a6a', '#cfcac0', '#d8b86c', '#9fb39a'];
const WAW_PAINT = ['#e6dccb', '#d9c9a8', '#c9ced1', '#e3c7a5', '#b8b2a6', '#d7d0c0', '#cdb79a'];
const CSS_NAMES: Record<string, string> = { white: '#eeeeea', yellow: '#e8cf7a', beige: '#e3d3b0', brown: '#9a6e50', red: '#b5553f', pink: '#dea0a0', grey: '#b0aca6', gray: '#b0aca6', green: '#a9c19a', blue: '#9db4c9', orange: '#e0a060', cream: '#ece2c8', maroon: '#8a4a3a', tan: '#cfb18a' };
function colourTint(tag: string): [number, number, number] | null {
  const t = tag.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(t) ? t : CSS_NAMES[t];
  return hex ? tintOf(hex) : null;
}

interface Facade {
  main: CellName;
  ground?: CellName;
  /** shop fronts: the ground floor splits into runs of a few bays, each with a random module from the list */
  groundMix?: CellName[];
  groundH: number;
  cap?: CellName;
  capH: number;
  bay: number;
  floor: number;
  tint: [number, number, number];
  roof: CellName;
  office: boolean;
}

const SHOPS_RU: CellName[] = ['shopFood', 'shopPharmacy', 'shopShawarma', 'shopFlowers', 'shopOptics', 'shopKeys', 'shopCafe'];

function facadeFor(style: OsmStyle, kind: number, h: number, footprint: number, colour: string, landmark: string): Facade {
  const f: Facade = { main: 'brickWin', groundH: 0, capH: 0, bay: 3.2, floor: 3, tint: [1, 1, 1], roof: 'roofBitumen', office: false };
  const paint = colourTint(colour);
  if (landmark === 'premium') return { ...f, main: 'redWin', ground: 'glassLobby', groundH: 9, cap: 'glassBlue', capH: 12, floor: 3.4, tint: tintOf('#e0a37e'), roof: 'metalVent' };
  if (landmark === 'chapel') return { ...f, main: 'redBlank', floor: 3, bay: 3, tint: tintOf('#d98f7c'), roof: 'roofRed' };
  if (landmark === 'pkin') return { ...f, main: 'stalPilaster', cap: 'stalCornice', capH: 1.6, floor: 3.6, bay: 3.2, tint: [1.12, 1.02, 0.86], roof: 'roofGravel' };
  if (kind === K.small) return { ...f, main: pick(['garageRust', 'garageGreen', 'corrGrey'] as const), floor: Math.max(2.6, h), bay: 3 };
  if (kind === K.industrial) return { ...f, main: pick(['corrGrey', 'corrBlue', 'wareWin', 'brickBlank'] as const), floor: 4.2, bay: 4, roof: 'roofGravel' };
  if (style === 'spb') {
    if ((kind === K.commercial && footprint > 2500) || h > 40) return { ...f, main: pick(['glassSpandrel', 'glassDark'] as const), ground: 'glassLobby', groundH: 5, floor: 3.8, bay: 3.4, office: true };
    // low 19th-century depots and warehouses (Ligovsky 50 and the like): bare red brick
    if (h <= 11 && kind !== K.house && kind !== K.religious) return { ...f, main: pick(['redWin', 'redWin', 'brickWin'] as const), ground: 'redDoor', groundH: 4.2, cap: 'brickTop', capH: 0.7, floor: 3.6, bay: 3.4, roof: 'metalVent' };
    const tint = paint ?? tintOf(pick(SPB_PAINT));
    return { ...f, main: pick(['plWin', 'plWinPed', 'plWin'] as const), ground: 'plRustic', groundMix: kind === K.commercial || kind === K.station ? ['stalShop', 'stalShop', 'plRustic'] : undefined, groundH: 4.4, cap: 'plCornice', capH: 1.4, floor: 3.7, bay: 3.4, tint, roof: 'metalVent' };
  }
  if (style === 'waw') {
    if (h >= 60) return { ...f, main: pick(['glassBlue', 'glassDark', 'glassSpandrel'] as const), ground: 'glassLobby', groundH: 6, floor: 3.8, bay: 3.2, office: true, roof: 'roofGravel' };
    if (kind === K.commercial || kind === K.station) return { ...f, main: pick(['glassSpandrel', 'towerWin'] as const), ground: 'glassLobby', groundH: 5, floor: 3.6, bay: 3.2, office: true, roof: 'roofGravel' };
    if (h >= 24) return { ...f, main: pick(['towerWin', 'panelWin', 'panelLoggia'] as const), ground: 'panelBlank', groundH: 3, cap: 'panelTop', capH: 1.2, floor: 3, bay: 3.2, tint: paint ?? [1, 1, 1] };
    return { ...f, main: pick(['plWin', 'plWinPed'] as const), ground: 'plRustic', groundH: 4, cap: 'plCornice', capH: 1.2, floor: 3.4, bay: 3.3, tint: paint ?? tintOf(pick(WAW_PAINT)) };
  }
  // Shchyolkovo: prefab panel blocks, brick five-storeys, late-Soviet and new commercial centres
  if (kind === K.commercial) {
    if (h >= 16) return { ...f, main: pick(['glassSpandrel', 'towerWin'] as const), ground: 'glassLobby', groundH: 4.5, floor: 3.4, office: true };
    return { ...f, main: pick(['brickWin', 'redWin'] as const), ground: 'brickDoor', groundMix: [...SHOPS_RU, 'brickBlank'], groundH: 4, cap: 'brickTop', capH: 0.8, floor: 3.2 };
  }
  if (kind === K.civic || kind === K.station || kind === K.religious) return { ...f, main: pick(['stalWin', 'stalWinPed'] as const), ground: 'stalRustic', groundH: 3.6, cap: 'stalCornice', capH: 1.2, floor: 3.4, bay: 3.2, tint: paint ?? tintOf(pick(['#e9e0cc', '#e6d3a3', '#d9a38f'])) };
  if (h >= 24) return { ...f, main: pick(['panelWin', 'panelLoggia', 'panelWinB', 'panelLoggiaB'] as const), cap: 'panelTop', capH: 1.2, floor: 2.8, bay: 3.2 };
  if (kind === K.house) return { ...f, main: pick(['brickWin', 'redWin'] as const), floor: 3, roof: 'roofRed' };
  return { ...f, main: pick(['brickWin', 'brickBalcony', 'redWin'] as const), cap: 'brickTop', capH: 0.8, floor: 3, bay: 3.2 };
}

/** tiling ripple normals for rivers: a few crossing sine waves (integer frequencies, so the tile repeats cleanly) */
function waterNormals(): THREE.DataTexture {
  const S = 128;
  const h = (x: number, y: number) => {
    const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
    return Math.sin(u * 3 + v * 2) * 0.5 + Math.sin(u * -5 + v * 7 + 1.3) * 0.3 + Math.sin(u * 11 - v * 4 + 2.1) * 0.15 + Math.sin(u * 2 + v * 13 + 0.4) * 0.12;
  };
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
      const i = (y * S + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export interface OsmCityOptions {
  /** boss courtyard: keep this circle clear (buildings slide out of it) and build only `reach` metres around it */
  arena?: { x: number; z: number; r: number; reach: number };
  /** night: lit windows, glowing signs and bridge LEDs, light pools under the lamps (default) */
  night?: boolean;
}

/** `track` = the race route (pavements, lamps, bridges, signs); null builds the surroundings of an arena */
export function buildOsmCity(track: TrackData | null, world: OsmWorld, quality: { level: 'low' | 'medium' | 'high'; shadows?: boolean }, opts: OsmCityOptions = {}): OsmCityRig {
  seed = 20260915;
  const night = opts.night ?? true;
  const style = world.style;
  const SEC = world.sector;
  const HALF = track?.halfW ?? 8;
  const arena = opts.arena;
  const inReach = (x: number, z: number, margin = 0) => !arena || Math.hypot(x - arena.x, z - arena.z) < arena.reach + margin;
  const inArena = (x: number, z: number, margin = 0) => !!arena && Math.hypot(x - arena.x, z - arena.z) < arena.r + margin;
  const LAMP_OFF = HALF + 3.3;
  const waterY = WATER_Y[style];
  let waterTex: THREE.Texture | null = null;
  let treeRig: { setCamera(x: number, z: number): void } | null = null;
  const group = new THREE.Group();
  group.name = `osm:${world.id}`;
  const disposables: { dispose(): void }[] = [];
  const [bx0, bz0, bx1, bz1] = world.bounds;

  const sectors = new Map<string, GeoBuilder>();
  const gb = (x: number, z: number): GeoBuilder => {
    // around an arena the city surrounds the camera on every side: sector culling saves nothing, one mesh saves draw calls
    const k = arena ? 'arena' : `${Math.floor(x / SEC)},${Math.floor(z / SEC)}`;
    let b = sectors.get(k);
    if (!b) sectors.set(k, (b = new GeoBuilder()));
    return b;
  };

  // ── route lookup: nearest centreline sample, lateral offset and lap distance of a point
  const HASH = 24;
  const hash = new Map<string, number[]>();
  track?.samples.forEach((s, i) => {
    const k = `${Math.floor(s.pos.x / HASH)},${Math.floor(s.pos.z / HASH)}`;
    const list = hash.get(k);
    if (list) list.push(i);
    else hash.set(k, [i]);
  });
  const near = (x: number, z: number, reach = 1): { i: number; d: number; lat: number; s: number } => {
    if (!track) return { i: -1, d: Infinity, lat: 0, s: 0 };
    const cx = Math.floor(x / HASH), cz = Math.floor(z / HASH);
    let best = -1, bd = Infinity;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (const i of hash.get(`${cx + dx},${cz + dz}`) ?? []) {
          const p = track.samples[i].pos;
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    if (best < 0) return { i: -1, d: Infinity, lat: 0, s: 0 };
    const sm = track.samples[best];
    const dx = x - sm.pos.x, dz = z - sm.pos.z;
    const lat = dx * sm.left.x + dz * sm.left.z;
    const along = dx * sm.tan.x + dz * sm.tan.z;
    return { i: best, d: Math.sqrt(bd), lat, s: sm.dist + along };
  };
  const routeDist = (x: number, z: number) => near(x, z).d;

  // ── ground: solid sectors, or the land pieces of sectors that touch water; embankment walls on banks
  const wetSectors = new Map(world.ground.map(([sx, sz, polys]) => [`${sx},${sz}`, polys]));
  const bankCell: CellName = style === 'shch' ? 'concrete' : 'granite';
  // Shchyolkovo's blocks stand on lawns; the Petersburg and Warsaw centres are paved
  const groundCell: CellName = style === 'shch' ? 'grass' : 'pavement';
  for (let x = bx0; x < bx1; x += SEC) {
    for (let z = bz0; z < bz1; z += SEC) {
      const sx = Math.round(x / SEC), sz = Math.round(z / SEC);
      if (!inReach(x + SEC / 2, z + SEC / 2, SEC * 0.75)) continue;
      const b = gb(x + SEC / 2, z + SEC / 2);
      const polys = wetSectors.get(`${sx},${sz}`);
      if (!polys) {
        b.flatPoly([{ x, z }, { x: x + SEC, z }, { x: x + SEC, z: z + SEC }, { x, z: z + SEC }], [[0, 1, 2], [0, 2, 3]], GROUND_Y, groundCell, 4);
        continue;
      }
      for (const poly of polys) {
        const rings = poly.map(decode);
        const { pts, tris } = triangulate(rings[0], rings.slice(1));
        b.flatPoly(pts, tris, GROUND_Y, groundCell, 4);
        for (const r of rings) {
          for (let i = 0; i < r.length; i++) {
            const p = r[i], q = r[(i + 1) % r.length];
            const onEdge = (a: number, c: number, s0: number) => Math.abs(a - s0) < 0.15 && Math.abs(c - s0) < 0.15;
            if (onEdge(p.x, q.x, x) || onEdge(p.x, q.x, x + SEC) || onEdge(p.z, q.z, z) || onEdge(p.z, q.z, z + SEC)) continue;
            const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz);
            if (l < 0.05) continue;
            // polygon-clipping output: outer rings CCW, holes CW → water is always on the right
            b.quadFacing(v(dz / l, 0, -dx / l), v(p.x, waterY - 0.8, p.z), v(q.x, waterY - 0.8, q.z), v(q.x, GROUND_Y, q.z), v(p.x, GROUND_Y, p.z), bankCell, [l / 3, (GROUND_Y - waterY + 0.8) / 3]);
          }
        }
      }
    }
  }

  // ── water surface
  if (world.water.length) {
    const pos: number[] = [], idx: number[] = [];
    for (const [wsx, wsz, polys] of world.water) {
      if (!inReach((wsx + 0.5) * SEC, (wsz + 0.5) * SEC, SEC * 0.75)) continue;
      for (const poly of polys) {
        const rings = poly.map(decode);
        const { pts, tris } = triangulate(rings[0], rings.slice(1));
        const base = pos.length / 3;
        for (const p of pts) pos.push(p.x, waterY, p.z);
        for (const [a, b2, c] of tris) {
          const cross = (pts[b2].x - pts[a].x) * (pts[c].z - pts[a].z) - (pts[b2].z - pts[a].z) * (pts[c].x - pts[a].x);
          if (cross > 0) idx.push(base + a, base + c, base + b2);
          else idx.push(base + a, base + b2, base + c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // world-space UVs (13 m per tile) for the ripple normal map, which drifts with the current in update()
    const uv: number[] = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 13, pos[i + 2] / 13);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const ripples = waterNormals();
    const m = new THREE.MeshStandardMaterial({ color: style === 'shch' ? (night ? '#0a1612' : '#1b3431') : '#07131c', roughness: night ? 0.05 : 0.12, metalness: 0, envMapIntensity: 1.2, normalMap: ripples, normalScale: new THREE.Vector2(0.18, 0.18) });
    const water = new THREE.Mesh(g, m);
    water.name = 'osm:water';
    group.add(water);
    disposables.push(g, m, ripples);
    waterTex = ripples;
  }

  // ── parks, squares, railway land
  const AREA_CELL: Record<number, [CellName, number]> = { 1: ['grass', 5], 2: ['granite', 3], 3: ['ballast', 4] };
  const greenAreas: P2[][] = [];
  for (const a of world.areas) {
    const [kind, outerF, ...holeF] = a;
    const cell = AREA_CELL[kind];
    if (!cell) continue;
    const outer = decode(outerF);
    const holes = holeF.map(decode);
    let cx = 0, cz = 0;
    for (const p of outer) {
      cx += p.x;
      cz += p.z;
    }
    if (!inReach(cx / outer.length, cz / outer.length) || inArena(cx / outer.length, cz / outer.length)) continue;
    const { pts, tris } = triangulate(outer, holes);
    gb(cx / outer.length, cz / outer.length).flatPoly(pts, tris, AREA_Y[kind], cell[0], cell[1]);
    if (kind === 1) greenAreas.push(outer);
  }

  // ── streets (world-space asphalt), footways, non-route bridges
  for (const [kind, wdm, flags, flat] of world.roads) {
    const line = decode(flat);
    const w = wdm / 10;
    const foot = kind >= 5;
    const y = foot ? FOOT_Y : STREET_Y;
    const cell: CellName = foot ? (kind === 5 ? 'granite' : 'pavement') : 'courtyard';
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], c = line[i + 1];
      const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz);
      if (l < 0.1) continue;
      if (!inReach((a.x + c.x) / 2, (a.z + c.z) / 2) || inArena((a.x + c.x) / 2, (a.z + c.z) / 2, w / 2 + 1)) continue;
      const ux = dx / l, uz = dz / l, nx = -uz * (w / 2), nz = ux * (w / 2);
      const ex = ux * (w / 2), ez = uz * (w / 2);
      const quad = [{ x: a.x + nx - ex, z: a.z + nz - ez }, { x: c.x + nx + ex, z: c.z + nz + ez }, { x: c.x - nx + ex, z: c.z - nz + ez }, { x: a.x - nx - ex, z: a.z - nz - ez }];
      const b = gb((a.x + c.x) / 2, (a.z + c.z) / 2);
      b.flatPoly(quad, [[0, 1, 2], [0, 2, 3]], y, cell, foot ? 3 : 6);
      if (!(flags & 1)) {
        // granite kerbs down to the ground (their tops stay flush with the surface, so crossings show no seams)
        for (const sd of [-1, 1]) {
          const p0 = v(a.x + nx * sd, GROUND_Y, a.z + nz * sd), p1 = v(c.x + nx * sd, GROUND_Y, c.z + nz * sd);
          b.quadFacing(v(-uz * sd, 0, ux * sd), p0, p1, v(p1.x, y, p1.z), v(p0.x, y, p0.z), 'granite', [l / 2, 0.15]);
        }
      }
      if (flags & 1) {
        // bridge deck edge: a fascia under both sides
        for (const s of [-1, 1]) {
          const p0 = v(a.x + nx * s, waterY + 0.6, a.z + nz * s), p1 = v(c.x + nx * s, waterY + 0.6, c.z + nz * s);
          b.quadFacing(v(-uz * s, 0, ux * s), p0, p1, v(p1.x, y, p1.z), v(p0.x, y, p0.z), 'concrete', [l / 4, 0.5]);
        }
      }
    }
  }

  // ── rails: tram tracks lie in the streets (on the race road where the route follows them), railways on ballast
  for (const [kind, , flat] of world.rails) {
    const line = decode(flat);
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], c = line[i + 1];
      const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz);
      if (l < 0.1) continue;
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      if (!inReach(mx, mz) || inArena(mx, mz, 1)) continue;
      const r = near(mx, mz);
      const y = track && r.d < HALF - 0.8 ? track.samples[r.i].pos.y + 0.02 : kind === 1 ? STREET_Y + 0.05 : AREA_Y[3] + 0.05;
      const ux = dx / l, uz = dz / l;
      const b = gb(mx, mz);
      for (const off of [-0.72, 0.72]) {
        const ox = -uz * off, oz = ux * off;
        const hw = 0.07;
        const q = [{ x: a.x + ox - uz * hw, z: a.z + oz + ux * hw }, { x: c.x + ox - uz * hw, z: c.z + oz + ux * hw }, { x: c.x + ox + uz * hw, z: c.z + oz - ux * hw }, { x: a.x + ox + uz * hw, z: a.z + oz - ux * hw }];
        b.flatPoly(q, [[0, 1, 2], [0, 2, 3]], y, 'metalVent', 2);
      }
    }
  }

  // ── route: raised pavements with curbs, bridge decks, street lamps
  const lamps: Lamp[] = [];
  const lampPosts: { x: number; y: number; z: number; side: number; i: number }[] = [];
  const pinkLights: Lamp[] = [];
  if (track) {
    const n = track.count;
    const L = LAMP_OFF - HALF;
    {
      const STEP = 3;
      for (let i = 0; i < n; i += STEP) {
        const j = Math.min(i + STEP, n);
        const sa = track.samples[i], sb = track.samples[j % n];
        const da = sa.dist, db = j === n ? track.length : sb.dist;
        for (const side of [-1, 1]) {
          const at = (s: typeof sa, lat: number, y: number) => v(s.pos.x + s.left.x * lat * side, s.pos.y + y, s.pos.z + s.left.z * lat * side);
          const b = gb(sa.pos.x + sa.left.x * side * (HALF + 2), sa.pos.z + sa.left.z * side * (HALF + 2));
          const lamp: LampSpace = { s0: da, s1: db, perp0: -L, perp1: PAVE - L, spacing: LAMP_SPACING, height: LAMP_H, k: 1 };
          b.quadFacing(UP, at(sa, HALF, CURB), at(sb, HALF, CURB), at(sb, HALF + PAVE, CURB), at(sa, HALF + PAVE, CURB), style === 'spb' ? 'granite' : 'pavement', [(db - da) / 3, PAVE / 3], 0, [0, 0], lamp);
          const seg = db - da;
          const inward = v(-sa.left.x * side, 0, -sa.left.z * side);
          b.quadFacing(inward, at(sa, HALF, STREET_Y), at(sb, HALF, STREET_Y), at(sb, HALF, CURB), at(sa, HALF, CURB), 'granite', [seg / 2, 0.1]);
          const bridge = sa.pos.y > 0.05 || sb.pos.y > 0.05;
          const bottom = bridge ? -1.2 : GROUND_Y;
          b.quadFacing(v(-inward.x, 0, -inward.z), at(sa, HALF + PAVE, bottom), at(sb, HALF + PAVE, bottom), at(sb, HALF + PAVE, CURB), at(sa, HALF + PAVE, CURB), bridge ? 'concrete' : 'granite', [seg / 3, (CURB - bottom) / 3]);
        }
        if (sa.pos.y > 0.05 || sb.pos.y > 0.05) {
          // bridge underside across the full width
          const b = gb(sa.pos.x, sa.pos.z);
          const W = HALF + PAVE;
          const at = (s: typeof sa, lat: number) => v(s.pos.x + s.left.x * lat, s.pos.y - 1.2, s.pos.z + s.left.z * lat);
          b.quadFacing(v(0, -1, 0), at(sa, -W), at(sb, -W), at(sb, W), at(sa, W), 'concrete', [W / 3, (db - da) / 3]);
        }
      }
      // piers under bridges where there is water below, and the pink LED line of Shchyolkovo's Proletarsky bridge
      let run: number[] = [];
      const flushBridge = () => {
        if (run.length < 4) {
          run = [];
          return;
        }
        const spanLen = run.length * track.spacing;
        const pink = style === 'shch' && spanLen > 45;
        for (let k = 0; k < run.length; k += Math.max(1, Math.round(16 / track.spacing))) {
          const s = track.samples[run[k]];
          const heading = Math.atan2(s.tan.x, s.tan.z);
          const pierH = s.pos.y - 1.2 - (waterY - 1);
          gb(s.pos.x, s.pos.z).box(s.pos.x, s.pos.z, waterY - 1, (HALF + PAVE) * 1.6, 1.6, pierH, heading, { front: { cell: 'concrete', tile: [3, 1] }, back: { cell: 'concrete', tile: [3, 1] }, left: { cell: 'concrete', tile: [0.5, 1] }, right: { cell: 'concrete', tile: [0.5, 1] } });
        }
        if (pink && night) {
          const pos: number[] = [];
          for (let k = 0; k + 1 < run.length; k++) {
            const a = track.samples[run[k]], c = track.samples[run[k + 1]];
            for (const side of [-1, 1]) {
              const W = (HALF + PAVE + 0.05) * side;
              const ax = a.pos.x + a.left.x * W, az = a.pos.z + a.left.z * W, cx2 = c.pos.x + c.left.x * W, cz2 = c.pos.z + c.left.z * W;
              const y0 = a.pos.y - 1.1, y1 = a.pos.y - 0.75, y2 = c.pos.y - 1.1, y3 = c.pos.y - 0.75;
              pos.push(ax, y0, az, cx2, y2, cz2, cx2, y3, cz2, ax, y0, az, cx2, y3, cz2, ax, y1, az);
            }
            if (k % Math.max(1, Math.round(14 / track.spacing)) === 0) {
              for (const side of [-1, 1]) pinkLights.push({ x: a.pos.x + a.left.x * side * (HALF + 1), y: a.pos.y - 2.2, z: a.pos.z + a.left.z * side * (HALF + 1), color: '#ff3fd2', range: 22, intensity: 1.4 });
            }
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          const m = new THREE.MeshBasicMaterial({ color: '#ff40d0', side: THREE.DoubleSide, toneMapped: false });
          const mesh = new THREE.Mesh(g, m);
          mesh.name = 'osm:bridge-led';
          group.add(mesh);
          disposables.push(g, m);
        }
        run = [];
      };
      for (let i = 0; i < n; i++) {
        if (track.samples[i].pos.y > 0.3) run.push(i);
        else flushBridge();
      }
      flushBridge();

      for (let k = 0; ; k++) {
        const s = (k + 0.5) * LAMP_SPACING;
        if (s > track.length - LAMP_SPACING / 2) break;
        const i = Math.floor(s / track.spacing) % n;
        const sm = track.samples[i];
        for (const side of [-1, 1]) lampPosts.push({ x: sm.pos.x + sm.left.x * side * LAMP_OFF, y: sm.pos.y + CURB, z: sm.pos.z + sm.left.z * side * LAMP_OFF, side, i });
      }
    }
    const pole = { cell: 'metalVent' as CellName, tile: [0.1, 2] as [number, number] };
    const head = { cell: 'tunnelCeil' as CellName, tile: [0.1, 0.12] as [number, number], start: [0.45, 0.78] as [number, number] };
    const plinth = { cell: 'concrete' as CellName, tile: [0.2, 0.3] as [number, number] };
    const all = <T,>(f: T) => ({ front: f, back: f, left: f, right: f });
    for (const l of lampPosts) {
      const b = gb(l.x, l.z);
      const sm = track.samples[l.i];
      // a slim pole on a concrete foot, an arm over the road and a flat «cobra» luminaire
      b.box(l.x, l.z, l.y, 0.38, 0.38, 0.9, 0, { ...all(plinth), top: plinth });
      b.box(l.x, l.z, l.y + 0.9, 0.2, 0.2, LAMP_H - 0.9, 0, all(pole));
      const ux = -sm.left.x * l.side, uz = -sm.left.z * l.side;
      const heading = Math.atan2(sm.tan.x, sm.tan.z);
      b.box(l.x + ux * 1.0, l.z + uz * 1.0, l.y + LAMP_H - 0.12, 0.09, 2.0, 0.09, heading + Math.PI / 2, { ...all(pole), top: pole });
      b.box(l.x + ux * 2.2, l.z + uz * 2.2, l.y + LAMP_H - 0.24, 0.38, 0.95, 0.18, heading + Math.PI / 2, { ...all(head), top: { cell: 'metalVent', tile: [0.2, 0.2] } });
      lamps.push({ x: l.x + ux * 2.9, y: l.y + LAMP_H - 0.35, z: l.z + uz * 2.9, color: style === 'waw' ? '#ffd9a8' : '#ffc58a', range: 26 });
    }
    // speed radars on the two quickest stretches (TrackData.speedTraps): a grey post with a camera box
    for (const ti of track.speedTraps) {
      const sm = track.samples[ti % track.count];
      const side = -1;
      const px = sm.pos.x + sm.left.x * side * (HALF + 2.4), pz = sm.pos.z + sm.left.z * side * (HALF + 2.4);
      const heading = Math.atan2(sm.tan.x, sm.tan.z);
      const b = gb(px, pz);
      const grey = { cell: 'metalVent' as CellName, tile: [0.3, 1] as [number, number] };
      b.box(px, pz, sm.pos.y + CURB, 0.22, 0.22, 5.0, heading, { front: grey, back: grey, left: grey, right: grey });
      const camX = px - sm.left.x * side * 0.8, camZ = pz - sm.left.z * side * 0.8;
      b.box(camX, camZ, sm.pos.y + CURB + 4.3, 0.9, 0.5, 0.5, heading, { ...all({ cell: 'concrete' as CellName, tile: [0.4, 0.4] as [number, number] }), top: { cell: 'metalVent' as CellName, tile: [0.3, 0.3] as [number, number] } });
      b.box(camX, camZ, sm.pos.y + CURB + 3.5, 0.7, 0.08, 0.5, heading, all({ cell: 'adStop' as CellName, tile: [1, 1] as [number, number] }));
    }
    // Shchyolkovo: benches and litter bins at the back of the pavement, halfway between the lamps
    if (style === 'shch') {
      const wood = { cell: 'woodWall' as CellName, tile: [0.3, 0.3] as [number, number] };
      for (let k = 1; ; k++) {
        const s = k * LAMP_SPACING;
        if (s > track.length - LAMP_SPACING) break;
        const i = Math.floor(s / track.spacing) % track.count;
        const sm = track.samples[i];
        if (sm.pos.y > 0.05) continue;
        const side = k % 2 ? 1 : -1;
        const heading = Math.atan2(sm.tan.x, sm.tan.z);
        const at = (lat: number, along: number) => ({ x: sm.pos.x + sm.left.x * side * lat + sm.tan.x * along, z: sm.pos.z + sm.left.z * side * lat + sm.tan.z * along });
        const y = sm.pos.y + CURB;
        const b = gb(sm.pos.x, sm.pos.z);
        const seat = at(HALF + PAVE - 0.9, 0), back = at(HALF + PAVE - 0.66, 0);
        b.box(seat.x, seat.z, y + 0.42, 0.46, 1.8, 0.06, heading, { ...all(wood), top: wood });
        b.box(back.x, back.z, y + 0.52, 0.06, 1.8, 0.42, heading, { ...all(wood), top: wood });
        for (const along of [-0.78, 0.78]) {
          const leg = at(HALF + PAVE - 0.82, along);
          b.box(leg.x, leg.z, y, 0.5, 0.07, 0.95, heading, { ...all(pole), top: pole });
        }
        const bin = at(HALF + PAVE - 0.8, 1.45);
        b.box(bin.x, bin.z, y, 0.42, 0.42, 0.8, heading, { ...all({ cell: 'garageGreen' as CellName, tile: [0.2, 0.3] as [number, number] }), top: pole });
      }
    }
  }

  /**
   * Details on the walls that face the race route: balconies floor by floor and entrances with a canopy.
   * All of it is boxes in the same GeoBuilder, so it merges into the sector mesh and costs triangles, not
   * draw calls. Only near the route and above the phone tier.
   */
  const facadeDetails = (b: GeoBuilder, p: P2, q: P2, dir: V, len: number, h: number, groundTop: number, floor: number, kind: number, seed: number) => {
    const tx = (q.x - p.x) / len, tz = (q.z - p.z) / len;
    const rot = Math.atan2(-tz, tx);
    const side = Math.sign(dir.x * Math.sin(rot) + dir.z * Math.cos(rot)) || 1;
    const at = (u: number, out: number) => ({ x: p.x + tx * u + dir.x * out, z: p.z + tz * u + dir.z * out });
    const metal = { cell: 'metalVent' as CellName, tile: [0.4, 0.4] as [number, number] };
    const conc = { cell: 'concrete' as CellName, tile: [0.4, 0.4] as [number, number] };
    const glass = { cell: 'glassSpandrel' as CellName, tile: [0.5, 0.5] as [number, number] };
    const all = (f: { cell: CellName; tile: [number, number] }) => ({ front: f, back: f, left: f, right: f, top: f });
    const rnd2 = (k: number) => {
      const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    // balconies on housing, every other bay, from the first floor up
    const floors = Math.max(0, Math.floor((h - groundTop) / floor) - 1);
    if (kind !== K.industrial && kind !== K.small && h >= 12 && floors >= 2) {
      const bays = Math.max(1, Math.round(len / 3.4));
      for (let f = 1; f <= floors; f++) {
        for (let k = 1; k < bays; k += 3) {
          if (rnd2(f * 13 + k) < 0.25) continue;
          const u = ((k + 0.5) / bays) * len;
          if (u < 1.6 || u > len - 1.6) continue;
          const y = groundTop + f * floor;
          const c = at(u, side * 0.62);
          b.box(c.x, c.z, y, 2.7, 1.2, 0.14, rot, all(conc));
          const glazed = rnd2(f * 7 + k + 1) < 0.45;
          const rail = at(u, side * 1.16);
          b.box(rail.x, rail.z, y + 0.14, 2.7, 0.1, glazed ? 1.4 : 1.0, rot, all(glazed ? glass : metal));
          for (const sx of [-1.3, 1.3]) {
            const sp = at(u + sx, side * 0.62);
            b.box(sp.x, sp.z, y + 0.14, 0.1, 1.2, glazed ? 1.4 : 1.0, rot, all(glazed ? glass : metal));
          }
        }
      }
    }
    // roof kit: a parapet along the top and a stair head with vents, so the skyline is not a flat cut
    if (h > 9) {
      b.box(p.x + tx * (len / 2) + dir.x * 0.12, p.z + tz * (len / 2) + dir.z * 0.12, h, len, 0.34, 0.55, rot, all(conc));
      if (len > 14 && rnd2(3) < 0.7) {
        const u = len * (0.3 + rnd2(5) * 0.4);
        const c = at(u, -side * (1.6 + rnd2(6) * 1.5));
        b.box(c.x, c.z, h, 3.2, 2.6, 2.1, rot, all(conc));
        b.box(c.x, c.z, h + 2.1, 3.4, 2.8, 0.14, rot, all(metal));
        const vent = at(u + 2.6, -side * 2.2);
        b.box(vent.x, vent.z, h, 0.7, 0.7, 1.1, rot, all(metal));
      }
    }
    // entrances: a canopy on two posts every ~26 m, with a step
    if (kind !== K.industrial && h >= 9) {
      const n = Math.floor(len / 26);
      for (let k = 0; k < n; k++) {
        const u = ((k + 0.5) / n) * len + (rnd2(k) - 0.5) * 4;
        if (u < 2.4 || u > len - 2.4) continue;
        const c = at(u, side * 0.75);
        b.box(c.x, c.z, 2.6, 3.0, 1.5, 0.16, rot, all(conc));
        for (const sx of [-1.3, 1.3]) {
          const sp = at(u + sx, side * 1.35);
          b.box(sp.x, sp.z, GROUND_Y, 0.14, 0.14, 2.6 - GROUND_Y, rot, all(metal));
        }
        const st = at(u, side * 0.6);
        b.box(st.x, st.z, GROUND_Y, 2.2, 1.2, 0.25 - GROUND_Y, rot, all(conc));
      }
    }
  };
  const detailWalls = !!track && quality.level !== 'low';

  /**
   * A pitched metal roof for the low, boxy buildings (houses, shops, garages): the footprint is fitted with a
   * rectangle along its longest edge, and if the fit is good the flat roof is replaced by two slopes and two
   * gables. Half the town is low-rise, and a skyline of flat cuts is what made it read as boxes.
   */
  const pitchedRoof = (b: GeoBuilder, ring: P2[], h: number, seed: number): boolean => {
    let bestLen = 0, dx = 1, dz = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const l = Math.hypot(q.x - p.x, q.z - p.z);
      if (l > bestLen) {
        bestLen = l;
        dx = (q.x - p.x) / l;
        dz = (q.z - p.z) / l;
      }
    }
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const p of ring) {
      const u = p.x * dx + p.z * dz, w = -p.x * dz + p.z * dx;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      w0 = Math.min(w0, w);
      w1 = Math.max(w1, w);
    }
    const rectArea = (u1 - u0) * (w1 - w0);
    if (rectArea < 20 || Math.abs(area(ring)) / rectArea < 0.86) return false;
    const P = (u: number, w: number, y: number): V => v(u * dx - w * dz, y, u * dz + w * dx);
    const span = w1 - w0;
    const ridgeH = h + Math.min(2.6, span * 0.26);
    const wm = (w0 + w1) / 2;
    const over = 0.35;
    const cell: CellName = seed % 1 < 0.45 ? 'roofRed' : 'metalVent';
    const tile: [number, number] = [(u1 - u0) / 3, span / 3];
    for (const sgn of [-1, 1] as const) {
      const wEdge = sgn < 0 ? w0 - over : w1 + over;
      const nrm = v(-sgn * -dz * 0.6, 0.8, -sgn * dx * 0.6);
      b.quadFacing(nrm, P(u0 - over, wEdge, h), P(u1 + over, wEdge, h), P(u1 + over, wm, ridgeH), P(u0 - over, wm, ridgeH), cell, tile, seed);
    }
    // gables and the eaves band
    for (const end of [u0, u1] as const) {
      const o = end === u0 ? -over : over;
      const nrm = v(dx * (end === u0 ? -1 : 1), 0, dz * (end === u0 ? -1 : 1));
      b.quadFacing(nrm, P(end + o, w0, h), P(end + o, w1, h), P(end + o, wm, ridgeH), P(end + o, wm, ridgeH), 'plCornice', [span / 3, 1], seed);
    }
    return true;
  };

  // ── buildings
  let buildingCount = 0;
  const walls: YardWall[] = [];
  let premiumAt: P2 | null = null;
  /**
   * Around an arena the footprints are cut by the fight circle (plus a 2.5 m margin): a warehouse that crosses
   * the yard keeps both ends, and its cut walls follow the rim. Holes (a circle inside a courtyard) are dropped.
   */
  const cutByArena = (ring: P2[]): P2[][] => {
    if (!arena) return [ring];
    const R = arena.r + 2.5;
    let touches = false;
    for (let i = 0; i < ring.length && !touches; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((arena.x - p.x) * dx + (arena.z - p.z) * dz) / l2));
      if (Math.hypot(p.x + dx * t - arena.x, p.z + dz * t - arena.z) < R) touches = true;
    }
    if (!touches) return [ring];
    const snap = (x: number) => Math.round(x * 20) / 20;
    const SEG = 36;
    const circle: [number, number][] = Array.from({ length: SEG }, (_, k) => [snap(arena.x + Math.cos((k / SEG) * Math.PI * 2) * R), snap(arena.z + Math.sin((k / SEG) * Math.PI * 2) * R)]);
    try {
      const out = polygonClipping.difference([ring.map((p) => [snap(p.x), snap(p.z)] as [number, number])], [circle]);
      return out
        .filter((poly) => poly.length === 1)
        .map((poly) => poly[0].slice(0, -1).map(([x, z]) => ({ x, z })))
        .filter((r) => r.length >= 3 && Math.abs(area(r)) >= 25)
        .map((r) => (area(r) < 0 ? r.reverse() : r));
    } catch {
      // degenerate input: the whole building goes
      return [];
    }
  };
  for (const bl of world.buildings) {
    const [hdm, mdm, kind, colour, , , landmark, , outerF] = bl;
    let ring0 = decode(outerF);
    if (ring0.length < 3) continue;
    if (area(ring0) < 0) ring0 = ring0.reverse();
    const h = hdm / 10;
    const minH = mdm / 10;
    const base = minH > 0.5 ? minH : GROUND_Y;
    let cx0 = 0, cz0 = 0;
    for (const p of ring0) {
      cx0 += p.x;
      cz0 += p.z;
    }
    if (!inReach(cx0 / ring0.length, cz0 / ring0.length) && h < 40) continue;
    for (const ring of cutByArena(ring0)) {
      let cx = 0, cz = 0;
      for (const p of ring) {
        cx += p.x;
        cz += p.z;
      }
      cx /= ring.length;
      cz /= ring.length;
      if (landmark === 'premium') {
        premiumTower(gb(cx, cz), cx, cz);
        premiumAt = { x: cx, z: cz };
        buildingCount++;
        continue;
      }
      const fp = Math.abs(area(ring));
      const fa = facadeFor(style, kind, h, fp, colour, landmark);
      // the Ligovsky 50 yard is all dark-red brick warehouses
      if (arena && fa.main === 'brickWin' && h <= 11) fa.main = 'redWin';
      const b = gb(cx, cz);
      const bseed = rnd() + (fa.office ? 10 : 0);
      b.tint = fa.tint;
      const groundTop = minH > 0.5 || !fa.ground || h < 7 ? base : Math.min(h - 2, fa.groundH);
      const capBottom = fa.cap && h - groundTop > 6 ? h - fa.capH : h;
      const nearC = near(cx, cz, 2);
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
        if (len < 0.3) continue;
        const dir = v(dz / len, 0, -dx / len);
        if (arena && len > 3 && h > 3) {
          const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
          if (Math.hypot(mx - arena.x, mz - arena.z) < arena.r + 14 && (arena.x - mx) * dir.x + (arena.z - mz) * dir.z > 0) walls.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, nx: dir.x, nz: dir.z, h });
        }
        let lamp: LampSpace | undefined;
        if (track && nearC.d < 60) {
          const ra = near(p.x, p.z, 2), rq = near(q.x, q.z, 2);
          const mid = near((p.x + q.x) / 2, (p.z + q.z) / 2, 2);
          if (ra.i >= 0 && rq.i >= 0 && mid.d < 45 && Math.abs(ra.s - rq.s) < len * 1.5 + 4) {
            const sm = track.samples[mid.i];
            const toRoad = (sm.pos.x - (p.x + q.x) / 2) * dir.x + (sm.pos.z - (p.z + q.z) / 2) * dir.z;
            if (toRoad > 0) lamp = { s0: ra.s, s1: rq.s, perp0: Math.abs(mid.lat) - LAMP_OFF, perp1: Math.abs(mid.lat) - LAMP_OFF, spacing: LAMP_SPACING, height: LAMP_H, k: 0.55 };
          }
        }
        const eseed = bseed + ((i * 0.0713) % 1) * 0.3;
        const bays = len < fa.bay * 0.75 ? len / fa.bay : Math.max(1, Math.round(len / fa.bay));
        const band = (y0: number, y1: number, cell: CellName, rows: number) => {
          if (y1 - y0 < 0.2) return;
          b.quadFacing(dir, v(p.x, y0, p.z), v(q.x, y0, q.z), v(q.x, y1, q.z), v(p.x, y1, p.z), cell, [bays, rows], eseed, [0, 0], lamp);
        };
        if (groundTop > base && fa.groundMix && bays >= 2) {
          // shop fronts in runs of 1–3 bays along the edge
          let k = 0;
          while (k < bays) {
            const run = Math.min(bays - k, 1 + Math.floor(rnd() * 3));
            const t0 = k / bays, t1 = (k + run) / bays;
            const p0 = v(p.x + dx * t0, base, p.z + dz * t0), p1 = v(p.x + dx * t1, base, p.z + dz * t1);
            const ls = lamp && { ...lamp, s0: lamp.s0 + (lamp.s1 - lamp.s0) * t0, s1: lamp.s0 + (lamp.s1 - lamp.s0) * t1 };
            b.quadFacing(dir, p0, p1, v(p1.x, groundTop, p1.z), v(p0.x, groundTop, p0.z), pick(fa.groundMix), [run, 1], eseed + k * 0.013, [0, 0], ls);
            k += run;
          }
        } else if (groundTop > base) band(base, groundTop, fa.ground!, 1);
        const floors = Math.max(1, Math.round((capBottom - groundTop) / fa.floor));
        band(groundTop, capBottom, fa.main, floors);
        if (capBottom < h) band(capBottom, h, fa.cap!, 1);
        // details on the walls that face the route — they carry the look at eye level
        if (detailWalls && len > 7 && nearC.d < 70 && nearC.i >= 0) {
          const rp = track!.samples[nearC.i].pos;
          if (dir.x * (rp.x - p.x) + dir.z * (rp.z - p.z) > 0) facadeDetails(b, p, q, dir, len, h, groundTop, fa.floor, kind, eseed);
        }
      }
      b.tint = [1, 1, 1];
      const pitched = detailWalls && h <= 12 && fp < 900 && kind !== K.industrial && nearC.d < 160 && pitchedRoof(b, ring, h, bseed);
      if (!pitched) {
        const { pts, tris } = triangulate(ring);
        b.flatPoly(pts, tris, h, fa.roof, 6);
      }
      if (landmark) landmarkDetails(landmark, cx, cz, h);
      buildingCount++;
    }
  }

  /**
   * Apart-hotel «Premium» (Talsinskaya 9/2) after the Commons photo from the Klyazma: a glass podium, a slab of
   * orange brick with small windows, a bulging blue glass bay up the front and a glass strip on its left corner,
   * a grey upper block and a round glass crown under a ring canopy. OSM only has the 19 m circle of the crown.
   * The front faces the river (north-east of the footprint).
   */
  function premiumTower(b: GeoBuilder, cx: number, cz: number): void {
    const f = { x: 0.69, z: 0.72 };
    const r = { x: f.z, z: -f.x };
    const P = (u: number, w: number): P2 => ({ x: cx + r.x * u + f.x * w, z: cz + r.z * u + f.z * w });
    const orange = tintOf('#e39a62');
    // one wall from local (u0, w0) to (u1, w1); the outside is on the right of that direction (as on CCW footprints)
    const face = (u0: number, w0: number, u1: number, w1: number, y0: number, y1: number, cell: CellName, bay: number, floor: number, seed = 0) => {
      const p = P(u0, w0), q = P(u1, w1);
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 0.05) return;
      const dir = v((q.z - p.z) / len, 0, -(q.x - p.x) / len);
      b.quadFacing(dir, v(p.x, y0, p.z), v(q.x, y0, q.z), v(q.x, y1, q.z), v(p.x, y1, p.z), cell, [Math.max(1, Math.round(len / bay)), Math.max(1, Math.round((y1 - y0) / floor))], seed);
    };
    const roof = (pts: P2[], y: number, cell: CellName) => {
      const ring = area(pts) < 0 ? [...pts].reverse() : pts;
      const t = triangulate(ring);
      b.flatPoly(t.pts, t.tris, y, cell, 6);
    };
    const slab = (u0: number, u1: number, w0: number, w1: number, y0: number, y1: number, cell: CellName, bay: number, floor: number, top: CellName | null) => {
      // counter-clockwise in (u, w) (the map u → r, w → f keeps orientation), so every wall faces out
      const c: [number, number][] = [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];
      for (let i = 0; i < 4; i++) face(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], y0, y1, cell, bay, floor, i * 0.1);
      if (top) roof(c.map(([u, w]) => P(u, w)), y1, top);
    };
    const arc = (cu: number, cw: number, ru: number, rw: number, a0: number, a1: number, seg: number, y0: number, y1: number, cell: CellName, floor: number) => {
      const pts: [number, number][] = [];
      for (let k = 0; k <= seg; k++) {
        const a = a0 + ((a1 - a0) * k) / seg;
        pts.push([cu + Math.sin(a) * ru, cw + Math.cos(a) * rw]);
      }
      for (let k = 0; k < seg; k++) face(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], y0, y1, cell, 2.2, floor, k * 0.07);
      return pts;
    };
    // podium: glass shop fronts under an orange brick storey
    b.tint = [1, 1, 1];
    slab(-21, 21, -15, 13, GROUND_Y, 5.5, 'glassLobby', 4, 5.5, null);
    b.tint = orange;
    slab(-21, 21, -15, 13, 5.5, 11, 'plWin', 3.2, 2.8, 'roofGravel');
    // the brick slab
    b.tint = [1, 1, 1];
    slab(-11, 11, -8, 8, 11, 74, 'brickSmallWin', 3.1, 3.1, 'roofBitumen');
    // the blue glass bay bulging out of the right half of the front and round its corner, a glass strip on the left
    const bay = arc(6.5, 4, 5.2, 5.6, Math.PI / 2, -Math.PI / 2, 10, 11, 80, 'glassBlue', 3.1);
    roof(bay.map(([u, w]) => P(u, w)), 80, 'roofBitumen');
    face(-9.4, 8.15, -11.15, 8.15, 11, 74, 'glassBlue', 1.8, 3.1);
    face(-11.15, 8.15, -11.15, 5.5, 11, 74, 'glassBlue', 1.8, 3.1);
    // grey upper block with a glass band, the round glass crown and its ring canopy
    slab(-8.5, 8.5, -7, 7, 74, 79, 'concrete', 4, 5, null);
    slab(-8.5, 8.5, -7, 7, 79, 84, 'glassBlue', 2, 2.5, null);
    slab(-8.5, 8.5, -7, 7, 84, 86.5, 'concrete', 4, 2.5, 'roofBitumen');
    const crown = arc(0, 0, 8, 8, Math.PI * 2, 0, 20, 86.5, 91, 'glassBlue', 2.2);
    roof(crown.slice(0, -1).map(([u, w]) => P(u, w)), 91, 'roofBitumen');
    arc(0, 0, 11.5, 11.5, Math.PI * 2, 0, 24, 91.6, 92.4, 'metalVent', 0.8);
    const ring: P2[] = [];
    for (let k = 0; k < 24; k++) ring.push(P(Math.sin((k / 24) * Math.PI * 2) * 11.5, Math.cos((k / 24) * Math.PI * 2) * 11.5));
    roof(ring, 92.4, 'metalVent');
    lamps.push({ x: cx, y: 94, z: cz, color: '#ff2020', range: 14, intensity: 0.6 });
  }

  function landmarkDetails(kind: string, cx: number, cz: number, h: number): void {
    if (kind === 'chapel') {
      const g = new THREE.SphereGeometry(2.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 1.5, 1);
      g.translate(cx, h + 2.2, cz);
      const drum = new THREE.CylinderGeometry(2.4, 2.4, 2.2, 16, 1, true);
      drum.translate(cx, h + 1.1, cz);
      const cross = new THREE.BoxGeometry(0.16, 2.2, 0.16);
      cross.translate(cx, h + 7, cz);
      const bar = new THREE.BoxGeometry(1.1, 0.14, 0.14);
      bar.translate(cx, h + 7.4, cz);
      const gold = mergeGeometries([g, cross, bar])!;
      [g, cross, bar].forEach((x) => x.dispose());
      const goldMat = new THREE.MeshStandardMaterial({ color: '#e8b64c', metalness: 1, roughness: 0.28, envMapIntensity: 1.6 });
      const drumMat = new THREE.MeshStandardMaterial({ color: '#8e3b2e', roughness: 0.8 });
      const m1 = new THREE.Mesh(gold, goldMat);
      const m2 = new THREE.Mesh(drum, drumMat);
      m1.name = 'osm:chapel-dome';
      group.add(m1, m2);
      disposables.push(gold, drum, goldMat, drumMat);
      lamps.push({ x: cx + 6, y: 2, z: cz + 6, color: '#ffd9a0', range: 18, intensity: 0.8 });
    }
  }

  // ── street furniture: traffic lights at signalised junctions on the route, bus stops
  if (track) {
    const furnitureY = (i: number) => track.samples[i].pos.y + CURB;
    for (let k = 0; k + 1 < world.signals.length; k += 2) {
      const x = world.signals[k] / 10, z = world.signals[k + 1] / 10;
      const r = near(x, z, 2);
      if (r.i < 0) continue;
      const sm = track.samples[r.i];
      for (const side of [-1, 1]) {
        const px = sm.pos.x + sm.left.x * side * (HALF + 2.5), pz = sm.pos.z + sm.left.z * side * (HALF + 2.5);
        trafficLight(gb, px, pz, furnitureY(r.i), Math.atan2(-sm.left.x * side, -sm.left.z * side));
      }
    }
    // bus stops and kiosks: the Blender models (src/assets/street.glb), one instanced mesh per part
    const stopSpots: { x: number; y: number; z: number; rot: number }[] = [];
    const kioskSpots: { x: number; y: number; z: number; rot: number }[] = [];
    for (let k = 0; k + 1 < world.stops.length; k += 2) {
      const x = world.stops[k] / 10, z = world.stops[k + 1] / 10;
      const r = near(x, z, 2);
      if (r.i < 0 || Math.abs(((r.s % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING - LAMP_SPACING / 2) < 5) continue;
      const sm = track.samples[r.i];
      const side = Math.sign(r.lat) || 1;
      const rot = Math.atan2(-sm.left.x * side, -sm.left.z * side);
      stopSpots.push({ x: sm.pos.x + sm.left.x * side * (HALF + 3.9), y: furnitureY(r.i), z: sm.pos.z + sm.left.z * side * (HALF + 3.9), rot });
      if (stopSpots.length % 2 === 0) {
        const off = 9;
        kioskSpots.push({ x: sm.pos.x + sm.left.x * side * (HALF + 4.1) + sm.tan.x * off, y: furnitureY(r.i), z: sm.pos.z + sm.left.z * side * (HALF + 4.1) + sm.tan.z * off, rot });
      }
    }
    const streetLib = getGLTF('street');
    const placeModel = (rootName: string, spots: { x: number; y: number; z: number; rot: number }[]) => {
      const root = streetLib?.scene.getObjectByName(rootName);
      if (!root || !spots.length) return;
      root.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      const m4 = new THREE.Matrix4();
      const local = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        local.multiplyMatrices(inv, o.matrixWorld);
        const inst = new THREE.InstancedMesh(o.geometry, o.material as THREE.Material, spots.length);
        spots.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp.rot);
          m4.compose(new THREE.Vector3(sp.x, sp.y, sp.z), q, new THREE.Vector3(1, 1, 1)).multiply(local);
          inst.setMatrixAt(i, m4);
        });
        inst.name = `osm:street:${rootName}`;
        inst.castShadow = !night && !!quality.shadows;
        inst.receiveShadow = inst.castShadow;
        inst.computeBoundingSphere();
        group.add(inst);
      });
    };
    placeModel('bus_stop', stopSpots);
    placeModel('kiosk', kioskSpots);
  }

  // ── zebra crossings where footways cross the route and at signalised junctions
  if (track) {
    const at: number[] = [];
    const consider = (x: number, z: number, reach: number, shift: number) => {
      const r = near(x, z, 2);
      if (r.i < 0 || r.d > reach) return;
      const s = (((r.s + shift) % track.length) + track.length) % track.length;
      if (s < 25 || s > track.length - 25 || at.some((o) => Math.abs(o - s) < 30)) return;
      const sm = track.samples[Math.floor(s / track.spacing) % track.count];
      if (sm.pos.y > 0.3) return;
      at.push(s);
    };
    for (let k = 0; k + 1 < world.signals.length; k += 2) consider(world.signals[k] / 10, world.signals[k + 1] / 10, HALF + 6, -7);
    for (const [kind, , , flat] of world.roads) {
      if (kind < 5) continue;
      const line = decode(flat);
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], c = line[i + 1];
        const l = Math.hypot(c.x - a.x, c.z - a.z);
        for (let t = 0; t <= l; t += 1.5) {
          const x = a.x + ((c.x - a.x) * t) / (l || 1), z = a.z + ((c.z - a.z) * t) / (l || 1);
          if (near(x, z, 1).d < 1.2) consider(x, z, 1.2, 0);
        }
      }
    }
    if (at.length) {
      const pos: number[] = [];
      for (const s of at) {
        const sm = track.samples[Math.floor(s / track.spacing) % track.count];
        const y = sm.pos.y + 0.012;
        for (let lat = -HALF + 0.7; lat < HALF - 0.6; lat += 1.1) {
          const q = [
            [lat, -2],
            [lat + 0.55, -2],
            [lat + 0.55, 2],
            [lat, 2],
          ].map(([u, w]) => [sm.pos.x + sm.left.x * u + sm.tan.x * w, y, sm.pos.z + sm.left.z * u + sm.tan.z * w]);
          for (const k of [0, 2, 1, 0, 3, 2]) pos.push(...q[k]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      // double-sided: the paint is lit the same whichever way the stripe quads wind
      const m = new THREE.MeshStandardMaterial({ color: '#dcdcd6', roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.name = 'osm:zebras';
      mesh.receiveShadow = !night && !!quality.shadows;
      group.add(mesh);
      disposables.push(g, m);
    }
  }

  // ── the fountains in the Klyazma in front of the Premium hotel: jets of spray animated in the vertex shader
  let fountainTime: { value: number } | null = null;
  if (premiumAt && world.water.length) {
    const rings = world.water.flatMap(([, , polys]) => polys.map((poly) => poly.map(decode)));
    const wet = (x: number, z: number) => rings.some((r) => inside({ x, z }, r[0]) && !r.slice(1).some((hole) => inside({ x, z }, hole)));
    const f = { x: 0.69, z: 0.72 };
    let d0 = -1, d1 = -1;
    for (let d = 20; d < 260; d += 2) {
      const w = wet(premiumAt.x + f.x * d, premiumAt.z + f.z * d);
      if (w && d0 < 0) d0 = d;
      if (!w && d0 >= 0) {
        d1 = d;
        break;
      }
    }
    if (d0 >= 0 && d1 > d0) {
      const mid = (d0 + d1) / 2;
      const jets = [-9, 9].map((o) => ({ x: premiumAt!.x + f.x * mid + f.z * o, z: premiumAt!.z + f.z * mid - f.x * o }));
      const per = quality.level === 'low' ? 260 : 700;
      const pos: number[] = [], seed: number[] = [], vel: number[] = [];
      for (const j of jets) {
        for (let k = 0; k < per; k++) {
          pos.push(j.x, waterY, j.z);
          seed.push(rnd());
          const a = rnd() * Math.PI * 2, spread = rnd() * 1.3;
          vel.push(Math.cos(a) * spread, 11 + rnd() * 3.5, Math.sin(a) * spread);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      g.setAttribute('aVel', new THREE.Float32BufferAttribute(vel, 3));
      fountainTime = { value: 0 };
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { time: fountainTime, tint: { value: new THREE.Color(night ? '#9fb4d8' : '#f4f8ff') } },
        vertexShader: /* glsl */ `
          attribute float aSeed; attribute vec3 aVel; uniform float time; varying float vA;
          void main() {
            float T = 2.9;
            float t = fract(time / T + aSeed) * T;
            vec3 p = position + vec3(aVel.x * t, aVel.y * t - 4.9 * t * t, aVel.z * t);
            p.y = max(p.y, position.y);
            vA = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(2.2, 2.9, t));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = clamp((0.35 + t * 0.25) * 420.0 / -mv.z, 1.0, 48.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 tint; varying float vA;
          void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(tint, smoothstep(0.5, 0.1, d) * vA * 0.32); }`,
      });
      const pts = new THREE.Points(g, m);
      pts.name = 'osm:fountains';
      pts.frustumCulled = false;
      group.add(pts);
      disposables.push(g, m);
    }
  }

  // ── landmark models (scripts/blender/landmarks.py) and their floodlights, in model space [x, y, z, colour, range]
  const MODEL_LIGHTS: Record<string, [number, number, number, string, number][]> = {
    shch_stela: [[0, 2, -9, '#ffe2b0', 20], [0, 2, 9, '#ffe2b0', 20]],
    shch_love: [[0, 1.5, -4, '#ffd0d8', 14]],
    spb_obelisk: [[0, 3, -13, '#ffd9a0', 30], [0, 3, 13, '#ffd9a0', 30], [13, 3, 0, '#ffd9a0', 30], [-13, 3, 0, '#ffd9a0', 30]],
    spb_station_tower: [[0, 4, -10, '#ffe0b0', 26]],
  };
  const lib = getGLTF('landmarks');
  for (const [name, xdm, zdm, rotDeg] of world.models) {
    const src = lib?.scene.getObjectByName(name);
    const x = xdm / 10, z = zdm / 10, rot = (rotDeg * Math.PI) / 180;
    if (!src || !inReach(x, z) || inArena(x, z, 12)) continue;
    const obj = src.clone(true);
    obj.position.set(x, GROUND_Y, z);
    obj.rotation.set(0, rot, 0);
    obj.name = `osm:lm:${name}`;
    obj.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    obj.updateMatrixWorld(true);
    group.add(obj);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const [lx, ly, lz, color, range] of MODEL_LIGHTS[name] ?? []) {
      lamps.push({ x: x + lx * cs + lz * sn, y: GROUND_Y + ly, z: z - lx * sn + lz * cs, color, range, intensity: 1.2 });
    }
  }

  // ── illuminated signs on the facade of a building that faces the route
  if (track) for (const [label, color, topDm, ringF] of world.signs) {
    let ring = decode(ringF);
    if (area(ring) < 0) ring = ring.reverse();
    let best: { score: number; p: P2; q: P2; n: P2; len: number } | null = null;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 8) continue;
      const n = { x: (q.z - p.z) / len, z: -(q.x - p.x) / len };
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      const r = near(mx, mz, 6);
      if (r.i < 0) continue;
      const sm = track.samples[r.i].pos;
      const facing = ((sm.x - mx) * n.x + (sm.z - mz) * n.z) / (r.d || 1);
      if (facing < 0.3) continue;
      const score = Math.min(len, 60) * facing / (1 + r.d / 60);
      if (!best || score > best.score) best = { score, p, q, n, len };
    }
    if (!best) continue;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = 'bold 96px "Russo One", "Arial Black", sans-serif';
    ctx.font = font;
    const tw = Math.ceil(ctx.measureText(label).width) + 60;
    canvas.width = THREE.MathUtils.ceilPowerOfTwo(tw);
    canvas.height = 128;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.fillText(label, canvas.width / 2, 68);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.55;
    ctx.fillText(label, canvas.width / 2, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const w = Math.min(best.len * 0.8, (canvas.width / canvas.height) * 4.2);
    const h = w * (canvas.height / canvas.width);
    const g = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    const mesh = new THREE.Mesh(g, mat);
    const top = Math.max(6, topDm / 10);
    mesh.position.set((best.p.x + best.q.x) / 2 + best.n.x * 0.4, top - h / 2 - 0.8, (best.p.z + best.q.z) / 2 + best.n.z * 0.4);
    mesh.rotation.y = Math.atan2(best.n.x, best.n.z);
    mesh.renderOrder = 3;
    mesh.name = `osm:sign:${label}`;
    group.add(mesh);
    disposables.push(g, mat, tex);
    lamps.push({ x: mesh.position.x + best.n.x * 3, y: mesh.position.y, z: mesh.position.z + best.n.z * 3, color, range: Math.max(16, w), intensity: 0.8 });
  }

  // ── merge sectors
  const { material, uniforms } = createCityMaterial(night);
  disposables.push(material);
  let triangles = 0;
  for (const [key, b] of sectors) {
    if (!b.vertexCount) continue;
    const geo = b.toGeometry();
    triangles += (geo.index?.count ?? 0) / 3;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `osm:${key}`;
    mesh.matrixAutoUpdate = false;
    // by day the houses throw shadows across the streets (the sun map follows the player's car)
    mesh.castShadow = mesh.receiveShadow = !night && !!quality.shadows;
    group.add(mesh);
    disposables.push(geo);
  }

  // ── trees (OSM trees + park planting) and parked cars along side streets near the route
  {
    const cap = quality.level === 'high' ? 1400 : quality.level === 'medium' ? 520 : 300;
    const spots: { x: number; y: number; z: number; s: number; d: number }[] = [];
    const clear = HALF + PAVE + 1.5;
    for (let k = 0; k + 1 < world.trees.length; k += 2) {
      const x = world.trees[k] / 10, z = world.trees[k + 1] / 10;
      if (!inReach(x, z) || inArena(x, z, 3)) continue;
      const d = arena ? Math.hypot(x - arena.x, z - arena.z) : near(x, z, 3).d;
      if (d > clear) spots.push({ x, y: GROUND_Y, z, s: 0.8 + rnd() * 0.5, d });
    }
    for (const outer of greenAreas) {
      const a = Math.abs(area(outer));
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (const p of outer) {
        minx = Math.min(minx, p.x);
        maxx = Math.max(maxx, p.x);
        minz = Math.min(minz, p.z);
        maxz = Math.max(maxz, p.z);
      }
      const want = Math.min(40, Math.floor(a / 140));
      for (let t = 0, got = 0; t < want * 4 && got < want; t++) {
        const p = { x: minx + rnd() * (maxx - minx), z: minz + rnd() * (maxz - minz) };
        if (!inside(p, outer)) continue;
        if (!inReach(p.x, p.z) || inArena(p.x, p.z, 3)) continue;
        const d = arena ? Math.hypot(p.x - arena.x, p.z - arena.z) : near(p.x, p.z, 3).d;
        if (d < clear) continue;
        spots.push({ x: p.x, y: AREA_Y[1], z: p.z, s: 0.8 + rnd() * 0.6, d });
        got++;
      }
    }
    // Shchyolkovo's streets are lined with lindens and birches: a row behind each pavement of the route,
    // wherever no house, street or bridge is in the way (2 m occupancy grid of footprints and streets)
    if (track && style === 'shch') {
      const G = 2;
      const busy = new Set<string>();
      const mark = (x: number, z: number) => busy.add(`${Math.floor(x / G)},${Math.floor(z / G)}`);
      for (const bl of world.buildings) {
        const ring = decode(bl[8]);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const p of ring) {
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          z0 = Math.min(z0, p.z);
          z1 = Math.max(z1, p.z);
        }
        if (!inReach((x0 + x1) / 2, (z0 + z1) / 2)) continue;
        for (let x = x0 - G; x <= x1 + G; x += G) for (let z = z0 - G; z <= z1 + G; z += G) if (inside({ x, z }, ring)) for (const [ox, oz] of [[0, 0], [G, 0], [-G, 0], [0, G], [0, -G]]) mark(x + ox, z + oz);
      }
      for (const [kind, wdm, , flat] of world.roads) {
        if (kind >= 5) continue;
        const line = decode(flat);
        const hw = wdm / 20 + 1.5;
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i], c = line[i + 1];
          const l = Math.hypot(c.x - a.x, c.z - a.z);
          for (let t = 0; t <= l; t += G) {
            const px = a.x + ((c.x - a.x) * t) / (l || 1), pz = a.z + ((c.z - a.z) * t) / (l || 1);
            for (let ox = -hw; ox <= hw; ox += G) for (let oz = -hw; oz <= hw; oz += G) mark(px + ox, pz + oz);
          }
        }
      }
      // lawns by the route: lindens and shrubs scattered where the ground is free (a jittered 9 m grid)
      for (let i = 0; i < track.count; i += Math.max(1, Math.round(9 / track.spacing))) {
        const sm = track.samples[i];
        for (const side of [-1, 1]) {
          for (let lat = HALF + PAVE + 9; lat < 70; lat += 9) {
            if (rnd() < 0.45) continue;
            const x = sm.pos.x + sm.left.x * side * lat + (rnd() - 0.5) * 7, z = sm.pos.z + sm.left.z * side * lat + (rnd() - 0.5) * 7;
            if (busy.has(`${Math.floor(x / G)},${Math.floor(z / G)}`) || near(x, z, 3).d < HALF + PAVE + 4) continue;
            const shrub = rnd() < 0.3;
            spots.push({ x, y: GROUND_Y, z, s: shrub ? 0.32 + rnd() * 0.15 : 0.7 + rnd() * 0.5, d: lat });
            mark(x, z);
          }
        }
      }
      const off = HALF + PAVE + 1.8;
      const every = Math.max(1, Math.round(9.5 / track.spacing));
      for (let i = 0; i < track.count; i += every) {
        const sm = track.samples[i];
        if (sm.pos.y > 0.3) continue;
        for (const side of [-1, 1]) {
          const along = (rnd() - 0.5) * 2;
          const x = sm.pos.x + sm.left.x * side * (off + rnd() * 0.8) + sm.tan.x * along;
          const z = sm.pos.z + sm.left.z * side * (off + rnd() * 0.8) + sm.tan.z * along;
          if (busy.has(`${Math.floor(x / G)},${Math.floor(z / G)}`) || near(x, z, 2).d < off - 0.5) continue;
          spots.push({ x, y: GROUND_Y, z, s: 0.75 + rnd() * 0.45, d: 0 });
        }
      }
    }
    spots.sort((a, b) => a.d - b.d);
    const t = trees(spots.slice(0, cap), !night && !!quality.shadows);
    treeRig = t;
    group.add(t.mesh);
    disposables.push(t);

    if (quality.level !== 'low') {
      const cars: { x: number; y: number; z: number; rot: number }[] = [];
      for (const [kind, wdm, , flat] of world.roads) {
        if (kind < 2 || kind > 4 || wdm < 55) continue;
        const line = decode(flat);
        const off = wdm / 20 - 1.3;
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i], c = line[i + 1];
          const l = Math.hypot(c.x - a.x, c.z - a.z);
          if ((arena ? Math.hypot(a.x - arena.x, a.z - arena.z) - arena.r : routeDist(a.x, a.z)) > 110) continue;
          const ux = (c.x - a.x) / l, uz = (c.z - a.z) / l;
          for (let s = 4; s < l - 4; s += 6.2) {
            for (const side of [-1, 1]) {
              if (rnd() > 0.45) continue;
              const x = a.x + ux * s - uz * off * side, z = a.z + uz * s + ux * off * side;
              if (arena ? inArena(x, z, 3) : routeDist(x, z) < HALF + PAVE + 2.5) continue;
              cars.push({ x, y: STREET_Y, z, rot: Math.atan2(ux * side, uz * side) });
            }
          }
        }
      }
      const pc = parkedCars(cars.slice(0, quality.level === 'high' ? 70 : 30));
      for (const m of pc.meshes) group.add(m);
      disposables.push(pc);
    }
  }

  return {
    group,
    lamps: night ? [...lamps, ...pinkLights] : [],
    walls,
    stats: { sectors: sectors.size, buildings: buildingCount, triangles, lamps: lamps.length },
    update(t: number, camX = 0, camZ = 0) {
      uniforms.time.value = t;
      if (camX || camZ) treeRig?.setCamera(camX, camZ);
      waterTex?.offset.set(t * 0.012, t * 0.007);
      if (fountainTime) fountainTime.value = t;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
