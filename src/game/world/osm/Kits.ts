import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { LAMP_GLSL, lampUniforms } from '../../render/LampField';
import type { CityMaterialUniforms } from '../city/kit';

/**
 * Blender building kits and hero buildings (docs/KITS.md).
 *
 * Kits are facade modules — a window bay, a loggia, an entrance, a cornice — authored per architectural style in
 * scripts/blender/kits/*.py. OsmCity lays them along every wall of the buildings near the race route, floor by
 * floor, instead of a flat quad with a painted facade. Heroes are whole modelled landmarks
 * (scripts/blender/heroes/*.py) that replace the extrusion of their OSM footprint.
 *
 * Both are converted into one vertex format — position, normal, albedo, material kind, window seed — and merged
 * per map sector with a single material, so a sector full of modelled houses is still one draw call.
 */
export const KIND: Record<string, number> = { wall: 0, wall2: 1, trim: 2, glass: 3, frame: 4, metal: 5, roof: 6, dark: 7, sign: 8, gold: 9, glass2: 10 };
const TINTED = new Set([KIND.wall, KIND.wall2]);

export interface KitPiece {
  name: string;
  role: string;
  w: number;
  h: number;
  weight: number;
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  kind: Float32Array;
  idx: Uint32Array;
}

export interface Kit {
  name: string;
  bay: number;
  floor: number;
  ground: number;
  cap: number;
  corner: number;
  pieces: Map<string, KitPiece>;
  roles: Map<string, KitPiece[]>;
  /** optional named module families (the brick kit has 'house' and 'warehouse') */
  families: Record<string, string[]>;
}

export interface Hero {
  id: number;
  ids: number[];
  name: string;
  piece: KitPiece;
}

export interface KitLibrary {
  kits: Map<string, Kit>;
  /** OSM way id (every part id) → hero */
  heroes: Map<number, Hero>;
}

interface KitManifest {
  kit: string;
  bay: number;
  floor: number;
  ground: number;
  cap: number;
  corner: number;
  families?: Record<string, string[]>;
  modules: Record<string, { w: number; h: number; role: string; weight?: number }>;
}

interface HeroManifest {
  map: string;
  heroes: { id: number; ids?: number[]; name: string }[];
}

const KIT_GLBS = import.meta.glob<string>('/src/assets/kits/*.glb', { query: '?url', import: 'default', eager: true });
const KIT_JSON = import.meta.glob<KitManifest>('/src/assets/kits/*.json', { import: 'default', eager: true });
const HERO_GLBS = import.meta.glob<string>('/src/assets/heroes/*.glb', { query: '?url', import: 'default', eager: true });
const HERO_JSON = import.meta.glob<HeroManifest>('/src/assets/heroes/*.json', { import: 'default', eager: true });

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function loadGlb(url: string): Promise<THREE.Group | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (g) => resolve(g.scene),
      undefined,
      (err) => {
        console.error('kit load failed', url, err);
        resolve(null);
      },
    );
  });
}

/**
 * Bake every mesh under `root` into module space with albedo and kind per vertex. Module space is the frame the
 * root sits in (roots are authored at the origin): the root's own transform is kept, because a root that is itself
 * a mesh carries the dequantization scale there once the GLB is meshopt-compressed.
 */
function bakePiece(root: THREE.Object3D, name: string, role: string, w: number, h: number, weight: number): KitPiece {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4();
  if (root.parent) inv.copy(root.parent.matrixWorld).invert();
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], kind: number[] = [], idx: number[] = [];
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry as THREE.BufferGeometry;
    const P = g.getAttribute('position');
    if (!P) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    nm.getNormalMatrix(m);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : P.count, materialIndex: 0 }];
    const N = g.getAttribute('normal');
    const C = g.getAttribute('color');
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const k = KIND[(mat?.name ?? '').toLowerCase()] ?? KIND.wall;
      const base = mat?.color ?? new THREE.Color(1, 1, 1);
      const remap = new Map<number, number>();
      const vert = (i: number) => {
        const hit = remap.get(i);
        if (hit !== undefined) return hit;
        const out = pos.length / 3;
        v.fromBufferAttribute(P, i).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        if (N) v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        else v.set(0, 0, 1);
        nrm.push(v.x, v.y, v.z);
        const cr = C ? C.getX(i) : 1, cg = C ? C.getY(i) : 1, cb = C ? C.getZ(i) : 1;
        col.push(base.r * cr, base.g * cg, base.b * cb);
        kind.push(k);
        remap.set(i, out);
        return out;
      };
      for (let t = grp.start; t < grp.start + grp.count; t++) idx.push(vert(g.index ? g.index.getX(t) : t));
    }
  });
  return { name, role, w, h, weight, pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col), kind: new Float32Array(kind), idx: new Uint32Array(idx) };
}

let kitsLoad: Promise<Map<string, Kit>> | null = null;
const heroLoads = new Map<string, Promise<Map<number, Hero>>>();

function loadKits(): Promise<Map<string, Kit>> {
  if (kitsLoad) return kitsLoad;
  kitsLoad = (async () => {
    const out = new Map<string, Kit>();
    for (const [path, url] of Object.entries(KIT_GLBS)) {
      const man = KIT_JSON[path.replace(/\.glb$/, '.json')];
      if (!man) continue;
      const scene = await loadGlb(url);
      if (!scene) continue;
      const kit: Kit = { name: man.kit, bay: man.bay, floor: man.floor, ground: man.ground, cap: man.cap, corner: man.corner, pieces: new Map(), roles: new Map(), families: man.families ?? {} };
      for (const [mod, info] of Object.entries(man.modules)) {
        const root = scene.getObjectByName(`${man.kit}__${mod}`);
        if (!root) continue;
        const piece = bakePiece(root, mod, info.role, info.w, info.h, info.weight ?? 1);
        if (!piece.idx.length) continue;
        kit.pieces.set(mod, piece);
        const list = kit.roles.get(info.role) ?? [];
        list.push(piece);
        kit.roles.set(info.role, list);
      }
      if (kit.pieces.size) out.set(kit.name, kit);
    }
    return out;
  })();
  return kitsLoad;
}

function loadHeroes(map: string): Promise<Map<number, Hero>> {
  const hit = heroLoads.get(map);
  if (hit) return hit;
  const p = (async () => {
    const out = new Map<number, Hero>();
    const url = HERO_GLBS[`/src/assets/heroes/${map}.glb`];
    const man = HERO_JSON[`/src/assets/heroes/${map}.json`];
    if (!url || !man) return out;
    const scene = await loadGlb(url);
    if (!scene) return out;
    for (const h of man.heroes) {
      const root = scene.getObjectByName(`hero__${h.id}`);
      if (!root) continue;
      const piece = bakePiece(root, h.name, 'hero', 0, 0, 1);
      if (!piece.idx.length) continue;
      const hero: Hero = { id: h.id, ids: h.ids?.length ? h.ids : [h.id], name: h.name, piece };
      for (const id of hero.ids) out.set(id, hero);
    }
    return out;
  })();
  heroLoads.set(map, p);
  return p;
}

const libraries = new Map<string, KitLibrary>();

/** kits (shared) and the map's heroes, loaded with the map */
export async function loadKitLibrary(map: string): Promise<KitLibrary> {
  const have = libraries.get(map);
  if (have) return have;
  const [kits, heroes] = await Promise.all([loadKits(), loadHeroes(map)]);
  const lib = { kits, heroes };
  libraries.set(map, lib);
  return lib;
}

export function getKitLibrary(map: string): KitLibrary | undefined {
  return libraries.get(map);
}

/** a typed array that grows by doubling (a sector of kit geometry is millions of numbers: no JS arrays) */
class Grow<T extends Float32Array | Int8Array | Uint8Array | Uint16Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  reserve(k: number): T {
    if (this.n + k > this.a.length) {
      const b = new (this.a.constructor as new (len: number) => T)(Math.max(this.a.length * 2, this.n + k));
      b.set(this.a);
      this.a = b;
    }
    return this.a;
  }
  /** an exact-size copy of what was written */
  done(): T {
    return this.a.slice(0, this.n) as T;
  }
}

/**
 * Growing vertex buffers for one cell of kit geometry, in a compact format (33 bytes a vertex): position float ×3,
 * normal int8 ×3, albedo uint8 ×3 (linear), material kind uint8, window seed uint16, level of detail float ×3
 * (building centre x/z and radius; a negative radius never gives way to the flat facade — heroes).
 */
export class KitBuilder {
  private pos = new Grow(new Float32Array(1 << 14));
  private nrm = new Grow(new Int8Array(1 << 14));
  private col = new Grow(new Uint8Array(1 << 14));
  private kind = new Grow(new Uint8Array(1 << 12));
  private seed = new Grow(new Uint16Array(1 << 12));
  private lod = new Grow(new Float32Array(1 << 14));
  private idx = new Grow(new Uint32Array(1 << 14));
  /** some vertices never swap to the flat facade (a hero is in this cell) */
  hasFixed = false;

  get vertexCount(): number {
    return this.pos.n / 3;
  }

  get triangleCount(): number {
    return this.idx.n / 3;
  }

  /**
   * Level of detail of the vertices added since the last tag: the building's centre and radius, and whether it
   * gives way to the flat facade in the distance (heroes never do).
   */
  tagLod(cx: number, cz: number, r: number, farSwap: boolean): void {
    const k = this.vertexCount * 3 - this.lod.n;
    if (k <= 0) return;
    const a = this.lod.reserve(k);
    const rr = farSwap ? Math.max(0, r) : -1;
    for (let i = this.lod.n; i < this.lod.n + k; i += 3) {
      a[i] = cx;
      a[i + 1] = cz;
      a[i + 2] = rr;
    }
    this.lod.n += k;
    if (!farSwap) this.hasFixed = true;
  }

  /**
   * Append a piece transformed by `m` (module space → world); walls take the building tint. `bendX` may move each
   * vertex along the module's x before the transform (the mitred corners of a wall).
   */
  add(piece: KitPiece, m: THREE.Matrix4, tint: readonly [number, number, number], seed: number, bendX?: (x: number, z: number) => number): void {
    const e = m.elements;
    const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
    const base = this.vertexCount;
    const P = piece.pos, N = piece.nrm, C = piece.col, K = piece.kind;
    const nv = P.length / 3;
    const pos = this.pos.reserve(nv * 3), nrm = this.nrm.reserve(nv * 3), col = this.col.reserve(nv * 3);
    const kind = this.kind.reserve(nv), sd = this.seed.reserve(nv);
    const seed16 = Math.round(Math.max(0, Math.min(1, seed)) * 65535);
    for (let i = 0; i < nv; i++) {
      const y = P[i * 3 + 1], z = P[i * 3 + 2];
      const x = bendX ? bendX(P[i * 3], z) : P[i * 3];
      const o = this.pos.n + i * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      let ox = nm[0] * nx + nm[3] * ny + nm[6] * nz, oy = nm[1] * nx + nm[4] * ny + nm[7] * nz, oz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      ox /= l;
      oy /= l;
      oz /= l;
      nrm[o] = Math.round(ox * 127);
      nrm[o + 1] = Math.round(oy * 127);
      nrm[o + 2] = Math.round(oz * 127);
      const k = K[i];
      const tinted = TINTED.has(k);
      for (let c = 0; c < 3; c++) col[o + c] = Math.round(Math.max(0, Math.min(1, C[i * 3 + c] * (tinted ? tint[c] : 1))) * 255);
      kind[this.kind.n + i] = k;
      sd[this.seed.n + i] = seed16;
    }
    this.pos.n += nv * 3;
    this.nrm.n += nv * 3;
    this.col.n += nv * 3;
    this.kind.n += nv;
    this.seed.n += nv;
    // a mirrored transform would flip the winding
    const flip = m.determinant() < 0;
    const I = piece.idx;
    const idx = this.idx.reserve(I.length);
    const o = this.idx.n;
    for (let t = 0; t < I.length; t += 3) {
      idx[o + t] = base + I[t];
      idx[o + t + 1] = base + (flip ? I[t + 2] : I[t + 1]);
      idx[o + t + 2] = base + (flip ? I[t + 1] : I[t + 2]);
    }
    this.idx.n += I.length;
  }

  toGeometry(): THREE.BufferGeometry {
    this.tagLod(0, 0, 0, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.done(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.done(), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.done(), 3, true));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind.done(), 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed.done(), 1, true));
    g.setAttribute('aLod', new THREE.BufferAttribute(this.lod.done(), 3));
    const idx = this.idx.done();
    g.setIndex(this.vertexCount > 65535 ? new THREE.BufferAttribute(idx, 1) : new THREE.BufferAttribute(Uint16Array.from(idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Facade level of detail, per building and entirely on the GPU: a modelled facade is drawn while the building
 * (its centre and radius) is within `near` of the eye, the old flat facade beyond that. Both carry the same
 * centre and radius and test the same expression with opposite outcomes, so exactly one of them is ever drawn;
 * the other collapses to a point. The eye is set by the scene every frame (it is not `cameraPosition`, so the
 * shadow pass swaps at the same place).
 */
export interface KitLod {
  near: { value: number };
  eye: { value: THREE.Vector2 };
}

const LOD_DECL = 'uniform float kitNear;\nuniform vec2 kitEye;';

/** shadows of kit geometry, with the same level-of-detail collapse as the colour pass */
export function createKitDepthMaterial(lod: KitLod): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial();
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { kitNear: lod.near, kitEye: lod.eye });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aLod;\n${LOD_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tif (aLod.z >= 0.0 && distance(aLod.xy, kitEye) - aLod.z > kitNear) transformed = vec3(0.0);');
  };
  mat.customProgramCacheKey = () => 'spg-kit-depth';
  return mat;
}

/** the city material drawing only the flat facades of kit buildings that are beyond the kit distance */
export function createFarFacadeMaterial(base: THREE.MeshStandardMaterial, lod: KitLod): THREE.MeshStandardMaterial {
  const mat = base.clone();
  mat.onBeforeCompile = (sh, renderer) => {
    base.onBeforeCompile(sh, renderer);
    Object.assign(sh.uniforms, { kitNear: lod.near, kitEye: lod.eye });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aLodC;\n${LOD_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tif (distance(aLodC.xy, kitEye) - aLodC.z <= kitNear) transformed = vec3(0.0);');
  };
  mat.customProgramCacheKey = () => 'spg-city-far';
  return mat;
}

/**
 * The one material for kit and hero geometry: albedo from the vertices, roughness/metalness per kind, glass
 * that mirrors the sky by day and lights up flat by flat at night (the city material's window uniforms), shop
 * signs that glow, and the nearest street lamps lighting the walls.
 */
export function createKitMaterial(city: CityMaterialUniforms, lod: KitLod): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.9 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lampUniforms, { litRatio: city.litRatio, windowGain: city.windowGain, signGain: city.signGain, lampGain: city.lampGain, kitNear: lod.near, kitEye: lod.eye });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aKind;\nattribute float aSeed;\nattribute vec3 aLod;\n${LOD_DECL}\nvarying float vKind;\nvarying float vSeed;\nvarying vec3 vKitWorld;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvKind = aKind;\n\tvSeed = aSeed;\n\tif (aLod.z >= 0.0 && distance(aLod.xy, kitEye) - aLod.z > kitNear) transformed = vec3(0.0);')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvKitWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vKind;
varying float vSeed;
varying vec3 vKitWorld;
uniform float litRatio, windowGain, signGain, lampGain;
${LAMP_GLSL}
float kitHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
bool kitIs(float k) { return abs(vKind - k) < 0.5; }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = kitIs(${KIND.glass.toFixed(1)}) ? 0.06 : kitIs(${KIND.glass2.toFixed(1)}) ? 0.1 : kitIs(${KIND.metal.toFixed(1)}) ? 0.42 : kitIs(${KIND.gold.toFixed(1)}) ? 0.25 : kitIs(${KIND.frame.toFixed(1)}) ? 0.5 : kitIs(${KIND.trim.toFixed(1)}) ? 0.7 : kitIs(${KIND.sign.toFixed(1)}) ? 0.45 : 0.88;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = kitIs(${KIND.metal.toFixed(1)}) ? 0.75 : kitIs(${KIND.gold.toFixed(1)}) ? 1.0 : kitIs(${KIND.glass.toFixed(1)}) || kitIs(${KIND.glass2.toFixed(1)}) ? 0.3 : 0.0;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
	if (kitIs(${KIND.glass.toFixed(1)}) || kitIs(${KIND.glass2.toFixed(1)})) {
		// by day street-level glass would mirror the dark lower half of the sky map: give it the soft grey-blue of
		// the street and sky it really reflects, stronger at grazing angles, plus a hint of the room behind
		float kitFres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
		totalEmissiveRadiance += vec3(0.42, 0.5, 0.6) * (0.05 + 0.3 * kitFres) * (1.0 - min(1.0, windowGain));
	}
	if (kitIs(${KIND.glass.toFixed(1)})) {
		// a flat is a bay × floor: every piece carries its own seed, so windows light one module at a time
		// (the cell also runs along the wall, so a hero — one seed for the whole building — is not lit in bands)
		float kitBay = floor(vKitWorld.x / 3.2) * 0.37 + floor(vKitWorld.z / 3.2) * 0.61;
		float lit = step(1.0 - litRatio, kitHash(vec2(vSeed * 7.13 + kitBay, floor(vKitWorld.y / 3.0))));
		vec3 warm = mix(vec3(1.0, 0.78, 0.48), vec3(0.75, 0.85, 1.0), step(0.8, kitHash(vec2(vSeed, 3.7))));
		totalEmissiveRadiance += warm * lit * windowGain * 0.9;
	}
	if (kitIs(${KIND.sign.toFixed(1)})) totalEmissiveRadiance += diffuseColor.rgb * signGain * 1.3;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
	if (lampGain > 0.0) {
		vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
		for (int i = 0; i < SPG_LAMPS; i++) {
			if (spgLampPos[i].w <= 0.0) continue;
			vec3 Lw = spgLampPos[i].xyz - vKitWorld;
			float d = length(Lw);
			float fall = 1.0 - smoothstep(spgLampPos[i].w * 0.3, spgLampPos[i].w, d);
			reflectedLight.directDiffuse += diffuseColor.rgb * spgLampCol[i] * fall * fall * max(dot(nW, Lw / d), 0.0) * 1.6;
		}
	}`,
      );
  };
  mat.customProgramCacheKey = () => 'spg-kit';
  return mat;
}

/** one wall of a footprint: ring edge p → q, outward normal (nx, nz), from the ground to the eaves */
export interface WallSpec {
  px: number;
  pz: number;
  qx: number;
  qz: number;
  nx: number;
  nz: number;
  base: number;
  top: number;
  tint: readonly [number, number, number];
  /** 0..1, stable per building */
  seed: number;
  /** wall index in the ring (variety between walls of one building) */
  wall: number;
  /** restrict pieces to a named family of the kit */
  family?: string;
  /**
   * tan(half the turn) of the footprint at the q and p ends: > 0 on an outside corner, < 0 on an inside one.
   * The corner strips are mitred by it, so cornices and quoins of neighbouring walls meet instead of leaving a notch.
   */
  turnQ?: number;
  turnP?: number;
  shops: boolean;
  entrances: boolean;
}

const hash01 = (a: number, b: number, c: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

function pickWeighted(list: KitPiece[], r: number): KitPiece {
  let total = 0;
  for (const p of list) total += p.weight;
  let acc = r * total;
  for (const p of list) {
    acc -= p.weight;
    if (acc <= 0) return p;
  }
  return list[list.length - 1];
}

/**
 * Lay a kit along one wall: corner strips at both ends, bays across, a ground-floor row (entrances, shops,
 * ground bays), typical floors with a consistent module per column (staircase columns above entrances) and the
 * cap/cornice row, every piece stretched to fill the wall exactly. Returns false if the wall is too small for
 * the kit (the caller keeps its flat facade there).
 */
export function layoutWall(b: KitBuilder, kit: Kit, w: WallSpec): boolean {
  const dx = w.px - w.qx, dz = w.pz - w.qz;
  const len = Math.hypot(dx, dz);
  const H = w.top - w.base;
  if (len < kit.bay * 0.55 || H < 2.2) return false;
  // a kit with module families (brick: house / warehouse) uses the requested one, or its first; pieces that are
  // in no family are shared by all
  const famName = w.family ?? Object.keys(kit.families)[0];
  const fam = famName ? new Set(kit.families[famName] ?? []) : null;
  const listed = new Set(Object.values(kit.families).flat());
  const inFamily = (p: KitPiece) => !fam || fam.has(p.name) || !listed.has(p.name);
  const role = (r: string) => (kit.roles.get(r) ?? []).filter(inFamily);
  const floors = role('floor'), grounds = role('ground'), entrances = role('entrance'), shops = role('shop'), stairs = role('stair'), caps = role('cap'), corners = role('corner'), blanks = role('blank');
  if (!floors.length && !grounds.length) return false;

  // module x runs from q to p along the wall (left to right seen from the street), y up, z out of the wall
  const ux = dx / len, uz = dz / len;
  const m = new THREE.Matrix4();
  const place = (piece: KitPiece, u: number, y: number, width: number, height: number, seed: number, bendX?: (x: number, z: number) => number) => {
    const sx = width / Math.max(0.05, piece.w), sy = height / Math.max(0.05, piece.h);
    m.set(ux * sx, 0, w.nx, w.qx + ux * u, 0, sy, 0, y, uz * sx, 0, w.nz, w.qz + uz * u, 0, 0, 0, 1);
    b.add(piece, m, w.tint, seed, bendX);
  };

  const cw = corners.length ? Math.min(kit.corner, len * 0.12) : 0;
  const inner = len - 2 * cw;
  const bays = Math.max(1, Math.round(inner / kit.bay));
  const bw = inner / bays;

  // rows: ground, typical floors, cap
  let groundH = Math.min(kit.ground, H);
  let capH = caps.length && H > groundH + kit.floor * 0.7 + kit.cap * 0.5 ? kit.cap : 0;
  let floorBand = H - groundH - capH;
  let nFloors = Math.max(0, Math.round(floorBand / kit.floor));
  if (nFloors === 0) {
    groundH = H - capH;
    floorBand = 0;
  }
  if (groundH < 0.5) {
    groundH = 0;
    capH = 0;
    floorBand = H;
    nFloors = Math.max(1, Math.round(H / kit.floor));
  }
  const floorH = nFloors ? floorBand / nFloors : 0;
  const rowY = (f: number) => w.base + groundH + f * floorH;

  // ground row plan: an entrance every ~5 bays on housing, shops on commercial walls
  const doorBays = new Set<number>();
  if (w.entrances && entrances.length && bays >= 3) {
    const every = 4 + Math.floor(hash01(w.seed, w.wall, 1) * 3);
    for (let i = Math.floor(every / 2); i < bays - 1; i += every) doorBays.add(i);
  }
  const seedAt = (col: number, row: number) => hash01(w.seed * 13.1 + w.wall, col, row);
  for (let col = 0; col < bays; col++) {
    const u = cw + col * bw;
    if (groundH > 0) {
      let piece: KitPiece | undefined;
      if (doorBays.has(col)) piece = pickWeighted(entrances, seedAt(col, 90));
      else if (w.shops && shops.length && seedAt(col, 91) < 0.6) piece = pickWeighted(shops, seedAt(col, 92));
      else if (grounds.length) piece = pickWeighted(grounds, seedAt(col, 93));
      else if (floors.length) piece = pickWeighted(floors, seedAt(col, 93));
      if (piece) place(piece, u, w.base, bw, groundH, seedAt(col, 0));
    }
    // one module per column keeps the facade architectural; a few columns swap every other floor
    const colPiece = doorBays.has(col) && stairs.length ? pickWeighted(stairs, seedAt(col, 94)) : pickWeighted(floors.length ? floors : blanks, seedAt(col, 95));
    const altPiece = floors.length > 1 && seedAt(col, 96) < 0.25 ? pickWeighted(floors, seedAt(col, 97)) : colPiece;
    for (let f = 0; f < nFloors; f++) {
      const piece = bays === 1 && blanks.length && inner < kit.bay * 0.8 ? blanks[0] : f % 2 ? altPiece : colPiece;
      place(piece, u, rowY(f), bw, floorH, seedAt(col, f + 1));
    }
    if (capH > 0) place(pickWeighted(caps, seedAt(col, 98)), u, w.base + H - capH, bw, capH, 0);
  }
  if (cw > 0) {
    const corner = corners[0];
    // the cornice runs round the corner: the cap row's corner cell is a cap, not the vertical strip
    const capCorner = caps.length ? caps[0] : corner;
    for (const atQ of [true, false]) {
      const u = atQ ? 0 : len - cw;
      const t = Math.max(-1, Math.min(1.5, (atQ ? w.turnQ : w.turnP) ?? 0));
      // mitre: at the corner line a vertex z out of the wall moves z·t past it, at the inner edge of the cell not at all
      const bend = (piece: KitPiece, width: number) => {
        if (Math.abs(t) < 0.02) return undefined;
        const sx = width / Math.max(0.05, piece.w);
        return (x: number, z: number) => {
          const a = x / Math.max(0.05, piece.w);
          const shift = Math.max(z * t, -0.9 * width);
          return x + (atQ ? -shift * (1 - a) : shift * a) / sx;
        };
      };
      if (groundH > 0) place(corner, u, w.base, cw, groundH, 0, bend(corner, cw));
      for (let f = 0; f < nFloors; f++) place(corner, u, rowY(f), cw, floorH, 0, bend(corner, cw));
      if (capH > 0) place(capCorner, u, w.base + H - capH, cw, capH, 0, bend(capCorner, cw));
    }
  }
  return true;
}

/** a hero sits on its footprint centroid, modelled in map metres (Blender X = map x, −Y = map z) */
export function placeHero(b: KitBuilder, hero: Hero, cx: number, cz: number, y: number): void {
  const m = new THREE.Matrix4().makeTranslation(cx, y, cz);
  b.add(hero.piece, m, [1, 1, 1], (hero.id % 997) / 997);
}
