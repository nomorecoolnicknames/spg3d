import * as THREE from 'three';
import { cityAtlas, type CellName } from './atlas';

/** street-space coordinates of a quad for lamp lighting (see aLamp) */
export interface LampSpace {
  /** along-street coordinate at p0/p3 and at p1/p2 */
  s0: number;
  s1: number;
  /** distance from the lamp line at p0/p1 and at p2/p3 */
  perp0: number;
  perp1: number;
  spacing: number;
  height: number;
  /** strength (0 = unlit) */
  k: number;
}

/**
 * Geometry kit for the city: every surface is a quad that tiles one atlas module (bays × floors).
 * Per-vertex attributes:
 *   position, normal
 *   uv      tile coordinates (1 unit = one module), fract() picks the texel inside the cell
 *   aCell   atlas cell rect [u, v, su, sv]
 *   aLamp   street-lamp lighting in street space: [s along the street (m), distance from the lamp
 *           line (m), lamp spacing (m), strength]; aLampH = lamp height. The shader lights the
 *           fragment from the nearest lamp analytically — quads are huge, so per-vertex baking
 *           could never show a light pool, but s interpolates exactly along a street-aligned quad.
 *   aSeed   per-building random, drives which windows are lit
 * Everything a sector contains merges into one BufferGeometry → one draw call.
 */
export class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  cell: number[] = [];
  lamp: number[] = [];
  lampH: number[] = [];
  seed: number[] = [];
  tintArr: number[] = [];
  idx: number[] = [];
  /** albedo multiplier for the quads added next (plaster colours of real buildings); glass stays untinted */
  tint: [number, number, number] = [1, 1, 1];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /**
   * Quad p0 (bottom-left) → p1 (bottom-right) → p2 (top-right) → p3 (top-left), seen from the front.
   * `tiles` = [modules across, modules up]; `start` offsets the tile grid (e.g. to align floors).
   */
  quad(
    p0: THREE.Vector3Like,
    p1: THREE.Vector3Like,
    p2: THREE.Vector3Like,
    p3: THREE.Vector3Like,
    cellName: CellName,
    tiles: [number, number],
    seed = 0,
    start: [number, number] = [0, 0],
    lamp?: LampSpace,
  ): void {
    const c = cityAtlas().cell(cellName);
    const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
    const bx = p3.x - p0.x, by = p3.y - p0.y, bz = p3.z - p0.z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const base = this.vertexCount;
    const corners = [p0, p1, p2, p3];
    const tuv = [
      [start[0], start[1]],
      [start[0] + tiles[0], start[1]],
      [start[0] + tiles[0], start[1] + tiles[1]],
      [start[0], start[1] + tiles[1]],
    ];
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(nx, ny, nz);
      this.uv.push(tuv[i][0], tuv[i][1]);
      this.cell.push(c[0], c[1], c[2], c[3]);
      if (lamp) {
        this.lamp.push(i === 0 || i === 3 ? lamp.s0 : lamp.s1, i < 2 ? lamp.perp0 : lamp.perp1, lamp.spacing, lamp.k);
        this.lampH.push(lamp.height);
      } else {
        this.lamp.push(0, 0, 1, 0);
        this.lampH.push(0);
      }
      this.seed.push(seed);
      this.tintArr.push(this.tint[0], this.tint[1], this.tint[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Horizontal polygon (already triangulated) with world-space tiling: uv = (x, z) / tile. Overlapping
   * pieces at the same height render identical texels, so street crossings and joints never flicker.
   */
  flatPoly(pts: { x: number; z: number }[], tris: number[][], y: number, cellName: CellName, tile: number, seed = 0): void {
    const c = cityAtlas().cell(cellName);
    const base = this.vertexCount;
    for (const p of pts) {
      this.pos.push(p.x, y, p.z);
      this.nrm.push(0, 1, 0);
      this.uv.push(p.x / tile, -p.z / tile);
      this.cell.push(c[0], c[1], c[2], c[3]);
      this.lamp.push(0, 0, 1, 0);
      this.lampH.push(0);
      this.seed.push(seed);
      this.tintArr.push(this.tint[0], this.tint[1], this.tint[2]);
    }
    // ShapeUtils returns clockwise triangles in x/z-as-x/y; seen from above (+y) they must be flipped
    for (const t of tris) {
      const [a, b, d] = t;
      const ax = pts[a].x, az = pts[a].z;
      const cross = (pts[b].x - ax) * (pts[d].z - az) - (pts[b].z - az) * (pts[d].x - ax);
      if (cross > 0) this.idx.push(base + a, base + d, base + b);
      else this.idx.push(base + a, base + b, base + d);
    }
  }

  /** quad whose winding is fixed up so its normal points along `dir` (mirrors the tile direction if flipped) */
  quadFacing(
    dir: THREE.Vector3Like,
    p0: THREE.Vector3Like,
    p1: THREE.Vector3Like,
    p2: THREE.Vector3Like,
    p3: THREE.Vector3Like,
    cellName: CellName,
    tiles: [number, number],
    seed = 0,
    start: [number, number] = [0, 0],
    lamp?: LampSpace,
  ): void {
    const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
    const bx = p3.x - p0.x, by = p3.y - p0.y, bz = p3.z - p0.z;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (nx * dir.x + ny * dir.y + nz * dir.z >= 0) this.quad(p0, p1, p2, p3, cellName, tiles, seed, start, lamp);
    else this.quad(p1, p0, p3, p2, cellName, tiles, seed, start, lamp && { ...lamp, s0: lamp.s1, s1: lamp.s0 });
  }

  /**
   * Axis-aligned-in-local-space box: centre (cx, cz) on the ground at y0, size (w along local x,
   * d along local z, h), rotated by `rot` around y. `faces` chooses the module per side:
   * front = local +z, back = −z, left = −x, right = +x, top.
   */
  box(
    cx: number,
    cz: number,
    y0: number,
    w: number,
    d: number,
    h: number,
    rot: number,
    faces: Partial<Record<'front' | 'back' | 'left' | 'right' | 'top', { cell: CellName; tile: [number, number]; start?: [number, number] }>>,
    seed = 0,
  ): void {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (lx: number, ly: number, lz: number) => ({ x: cx + lx * cs + lz * sn, y: y0 + ly, z: cz - lx * sn + lz * cs });
    const hw = w / 2, hd = d / 2;
    const f = faces;
    if (f.front) this.quad(P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), f.front.cell, f.front.tile, seed, f.front.start);
    if (f.back) this.quad(P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), f.back.cell, f.back.tile, seed + 0.37, f.back.start);
    if (f.right) this.quad(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), f.right.cell, f.right.tile, seed + 0.61, f.right.start);
    if (f.left) this.quad(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), f.left.cell, f.left.tile, seed + 0.83, f.left.start);
    if (f.top) this.quad(P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), P(-hw, h, -hd), f.top.cell, f.top.tile, seed);
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCell', new THREE.Float32BufferAttribute(this.cell, 4));
    g.setAttribute('aLamp', new THREE.Float32BufferAttribute(this.lamp, 4));
    g.setAttribute('aLampH', new THREE.Float32BufferAttribute(this.lampH, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.seed, 1));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tintArr, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface CityMaterialUniforms {
  /** fraction of windows lit (0 by day) */
  litRatio: { value: number };
  /** window light strength */
  windowGain: { value: number };
  /** signs / shops / LEDs */
  signGain: { value: number };
  /** street lamp strength and colour */
  lampGain: { value: number };
  lampColor: { value: THREE.Color };
  time: { value: number };
}

export function createCityMaterial(night: boolean): { material: THREE.MeshStandardMaterial; uniforms: CityMaterialUniforms } {
  const atlas = cityAtlas();
  const uniforms: CityMaterialUniforms = {
    litRatio: { value: night ? 0.3 : 0 },
    windowGain: { value: night ? 1.1 : 0 },
    signGain: { value: night ? 1.2 : 0.3 },
    lampGain: { value: night ? 0.6 : 0 },
    lampColor: { value: new THREE.Color('#ffc58a') },
    time: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, envMapIntensity: 0.45 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { tAtlas: { value: atlas.albedo }, tEmis: { value: atlas.emissive } });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aCell;
attribute vec4 aLamp;
attribute float aLampH;
attribute float aSeed;
attribute vec3 aTint;
varying vec3 vTint;
varying vec4 vCell;
varying vec2 vTile;
varying vec4 vLamp;
varying float vLampUp;
varying float vSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
	vCell = aCell;
	vTile = uv;
	vLamp = aLamp;
	vLampUp = (modelMatrix * vec4(transformed, 1.0)).y - aLampH;
	vSeed = aSeed;
	vTint = aTint;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tAtlas, tEmis;
uniform float litRatio, windowGain, signGain, lampGain, time;
uniform vec3 lampColor;
varying vec4 vCell;
varying vec2 vTile;
varying vec4 vLamp;
varying float vLampUp;
varying float vSeed;
varying vec3 vTint;
float cityHash(vec2 p) { return fract(sin(dot(p, vec2(41.37, 289.91))) * 43758.5453); }
vec4 cityEmis;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 cf = fract(vTile);
	cf.y = 1.0 - cf.y;
	vec2 auv = vCell.xy + cf * vCell.zw;
	vec2 gdx = dFdx(vTile) * vCell.zw;
	vec2 gdy = dFdy(vTile) * vCell.zw;
	vec4 alb = textureGrad(tAtlas, auv, gdx, gdy);
	cityEmis = textureGrad(tEmis, auv, gdx, gdy);
	diffuseColor.rgb *= alb.rgb * mix(vTint, vec3(1.0), cityEmis.r);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
	roughnessFactor = mix(roughnessFactor, 0.12, cityEmis.r);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
	{
		// aSeed = random in [0,1) (+10 on office curtain walls: whole floors light together, dimmer)
		float office = step(9.5, vSeed);
		float sd = fract(vSeed);
		vec2 wid = floor(vTile) + vec2(sd * 131.0, sd * 71.0);
		wid.x = mix(wid.x, sd * 131.0, office);
		float h = cityHash(wid);
		float lit = step(h, litRatio * mix(1.0, 0.7, office));
		vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.86, 0.62), cityHash(wid + 7.1));
		vec3 cool = vec3(0.62, 0.78, 1.0);
		vec3 wc = mix(warm, cool, step(0.86, cityHash(wid + 3.3)));
		float win = lit * (0.55 + 0.45 * cityHash(wid + 1.9));
		// far away a window is a pixel or less: per-window on/off would sparkle as the camera moves,
		// so fade to the average glow once a module shrinks below ~3 px
		float farW = smoothstep(0.25, 0.6, length(fwidth(vTile)));
		win = mix(win, litRatio * 0.75, farW);
		wc = mix(wc, vec3(1.0, 0.8, 0.55), farW);
		totalEmissiveRadiance += cityEmis.r * win * windowGain * mix(1.0, 0.45, office) * wc;
		totalEmissiveRadiance += cityEmis.g * signGain * diffuseColor.rgb * 2.0;
		if (vLamp.w > 0.0) {
			// nearest lamp along the street: horizontal offset, height difference, distance from the lamp line
			float along = (fract(vLamp.x / vLamp.z) - 0.5) * vLamp.z;
			float d2 = along * along + vLampUp * vLampUp + vLamp.y * vLamp.y;
			// lamps throw light down: little reaches above the lamp head
			float fall = 1.0 / (1.0 + d2 * 0.07) * (1.0 - smoothstep(100.0, 380.0, d2)) * (1.0 - smoothstep(-1.0, 5.0, vLampUp));
			totalEmissiveRadiance += diffuseColor.rgb * lampColor * (vLamp.w * lampGain * 1.3 * fall);
		}
	}`,
      );
  };
  mat.customProgramCacheKey = () => 'spg-city';
  return { material: mat, uniforms };
}
