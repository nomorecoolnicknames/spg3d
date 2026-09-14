import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackData } from './TrackData';
import { createRoadMaterial } from './RoadMaterial';
import { barrierTexture, checkerTexture, curbTexture, groundTexture, reseed, rnd } from './textures';

export interface TrackMesh {
  group: THREE.Group;
  road: THREE.Mesh;
  /** terrain height query (world) */
  terrainHeight: (x: number, z: number) => number;
  dispose(): void;
}

/**
 * Builds road ribbon (with elevation), shoulders, corner curbs, barriers, start line and a
 * terrain heightfield that follows the road near it and rolls away from it.
 */
export function buildTrackMesh(track: TrackData, quality: { shadows: boolean; low?: boolean }): TrackMesh {
  const spec = track.spec;
  const env = spec.env;
  const group = new THREE.Group();
  const n = track.count;
  const halfW = track.halfW;
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const track_ = track;

  // ---- road ----
  const roadGeo = ribbon(track, -halfW, halfW, 0.0, (i) => i * track.spacing / (halfW * 2));
  const roadMat = createRoadMaterial(env, { wetness: env.wet ? 0.85 : spec.theme === 'snow' ? 0.25 : 0, lineColor: spec.theme === 'snow' ? '#c9d6e4' : '#d8d8d8', low: !!quality.low });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.name = 'road';
  road.receiveShadow = true;
  group.add(road);
  disposables.push(roadGeo, roadMat);

  // ---- shoulders (gravel / sand / snow); the city builds pavements instead ----
  if (spec.theme !== 'city') {
    const shoulderColor = spec.theme === 'desert' ? '#a3693f' : '#dfe8f0';
    const shoulderTex = groundTexture(shoulderColor, 30);
    disposables.push(shoulderTex);
    const shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderTex, roughness: 0.95, metalness: 0 });
    disposables.push(shoulderMat);
    for (const side of [-1, 1] as const) {
      const g = ribbon(track, side * halfW, side * (halfW + 4.5), -0.06, (i) => i * track.spacing / 6, true, side > 0 ? -0.25 : 0, side > 0 ? 0 : -0.25);
      const m = new THREE.Mesh(g, shoulderMat);
      m.name = 'shoulder';
      m.receiveShadow = true;
      group.add(m);
      disposables.push(g);
    }
  }

  // ---- curbs on the inside of corners ----
  const curbTex = curbTexture(env.curbA, env.curbB);
  disposables.push(curbTex);
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6, metalness: 0.05 });
  disposables.push(curbMat);
  const curbGeos: THREE.BufferGeometry[] = [];
  let runStart = -1;
  const isCurb = (i: number) => Math.abs(track.samples[i].curv) > 0.006;
  for (let i = 0; i <= n; i++) {
    const c = i < n && isCurb(i);
    if (c && runStart < 0) runStart = i;
    if ((!c || i === n) && runStart >= 0) {
      const len = i - runStart;
      if (len > 8) {
        const side = Math.sign(track.samples[runStart + Math.floor(len / 2)].curv); // inside = direction of turn
        const g = ribbonRange(track, runStart, i, side * (halfW - 0.05), side * (halfW + 1.1), 0.045, (k) => k * track.spacing / 1.2, side < 0);
        curbGeos.push(g);
      }
      runStart = -1;
    }
  }
  if (curbGeos.length) {
    const merged = mergeGeometries(curbGeos)!;
    curbGeos.forEach((g) => g.dispose());
    const curbs = new THREE.Mesh(merged, curbMat);
    curbs.receiveShadow = true;
    group.add(curbs);
    disposables.push(merged);
  }

  // ---- barriers ----
  const barrierOff = halfW + track.runoff + 0.6;
  const barrierTex = barrierTexture(env.barrierColor, spec.theme === 'city' ? '#ffd400' : '#e8e8e8', '#111');
  barrierTex.repeat.set(1, 1);
  disposables.push(barrierTex);
  const barrierMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.7, metalness: 0.15, side: THREE.DoubleSide });
  disposables.push(barrierMat);
  for (const side of [-1, 1] as const) {
    const g = wall(track, side * barrierOff, 1.05, side < 0, 0.16);
    const m = new THREE.Mesh(g, barrierMat);
    m.castShadow = quality.shadows;
    m.receiveShadow = true;
    group.add(m);
    disposables.push(g);
  }
  // neon strip on top of the barriers (city) or reflector posts (others)
  if (spec.theme === 'city') {
    for (const side of [-1, 1] as const) {
      const g = wall(track, side * barrierOff, 0.08, side < 0, 0, 1.05);
      const mat = new THREE.MeshBasicMaterial({ color: side > 0 ? env.neonA : env.neonB, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(g, mat);
      group.add(m);
      disposables.push(g, mat);
    }
  } else {
    const postGeo = new THREE.BoxGeometry(0.12, 1.3, 0.12);
    const reflGeo = new THREE.BoxGeometry(0.14, 0.14, 0.05);
    const posts: THREE.BufferGeometry[] = [];
    const refls: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i += Math.round(18 / track.spacing)) {
      for (const side of [-1, 1] as const) {
        const s = track.samples[i];
        const p = s.pos.clone().addScaledVector(s.left, side * (barrierOff + 0.6));
        const rot = new THREE.Matrix4().makeRotationY(Math.atan2(s.tan.x, s.tan.z));
        const pg = postGeo.clone().applyMatrix4(rot).translate(p.x, p.y + 0.6, p.z);
        posts.push(pg);
        const rg = reflGeo.clone().applyMatrix4(rot).translate(p.x, p.y + 1.15, p.z);
        refls.push(rg);
      }
    }
    postGeo.dispose();
    reflGeo.dispose();
    const pm = mergeGeometries(posts)!;
    const rm = mergeGeometries(refls)!;
    posts.forEach((g) => g.dispose());
    refls.forEach((g) => g.dispose());
    const pMat = new THREE.MeshStandardMaterial({ color: '#d8d8d8', roughness: 0.6 });
    const rMat = new THREE.MeshBasicMaterial({ color: env.neonB, toneMapped: false });
    group.add(new THREE.Mesh(pm, pMat), new THREE.Mesh(rm, rMat));
    disposables.push(pm, rm, pMat, rMat);
  }

  // ---- start / finish line + gantry ----
  const chk = checkerTexture();
  disposables.push(chk);
  const startGeo = ribbonRange(track, 0, 3, -halfW, halfW, 0.03, (k) => k * 0.5);
  const startMat = new THREE.MeshBasicMaterial({ map: chk });
  group.add(new THREE.Mesh(startGeo, startMat));
  disposables.push(startGeo, startMat);
  {
    const s0 = track.samples[2];
    const heading = Math.atan2(s0.tan.x, s0.tan.z);
    const gantry = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: '#22242c', roughness: 0.5, metalness: 0.7 });
    const beamMat = new THREE.MeshStandardMaterial({ color: '#15161c', roughness: 0.5, metalness: 0.6 });
    const pg = new THREE.BoxGeometry(0.5, 7.5, 0.5);
    const bg = new THREE.BoxGeometry(halfW * 2 + 6, 1.3, 1.2);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pg, postMat);
      p.position.set(side * (halfW + 2.5), 3.75, 0);
      p.castShadow = quality.shadows;
      gantry.add(p);
    }
    const beam = new THREE.Mesh(bg, beamMat);
    beam.position.set(0, 7.2, 0);
    beam.castShadow = quality.shadows;
    gantry.add(beam);
    // lights strip under the beam
    const lg = new THREE.BoxGeometry(halfW * 2 + 5, 0.18, 0.3);
    const lm = new THREE.MeshBasicMaterial({ color: env.neonA, toneMapped: false });
    const lights = new THREE.Mesh(lg, lm);
    lights.position.set(0, 6.5, 0.5);
    gantry.add(lights);
    gantry.position.copy(s0.pos);
    gantry.rotation.y = heading;
    group.add(gantry);
    disposables.push(pg, bg, lg, postMat, beamMat, lm);
  }

  // ---- terrain heightfield (the city has its own ground) ----
  let terrainHeight = (_x: number, _z: number): number => -0.55;
  if (spec.theme !== 'city') {
    const size = track.bounds.span * 2.4 + 500;
    const segs = quality.low ? 120 : 240;
    const cx = (track.bounds.minX + track.bounds.maxX) / 2;
    const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
    const amp = spec.theme === 'desert' ? 26 : 16;
    const coarse: THREE.Vector3[] = [];
    for (let i = 0; i < n; i += 4) coarse.push(track.samples[i].pos);
    const distAndHeight = (x: number, z: number): [number, number] => {
      let best = Infinity, by = 0;
      for (const p of coarse) {
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < best) {
          best = d;
          by = p.y;
        }
      }
      return [Math.sqrt(best), by];
    };
    reseed(5);
    const terrainNoise = (x: number, z: number): number => {
      const a = Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009 - 0.7);
      const b = Math.sin(x * 0.027 - z * 0.019) * 0.5;
      const c = Math.sin((x + z) * 0.05) * 0.2;
      return (a + b + c) * amp + amp * 0.4;
    };
    // a gorge crossing the track (the road spans it on a bridge — world/features/Canyon.ts)
    const gorge = spec.features?.gorge;
    const gc = gorge ? track.samples[Math.round(gorge.at * n) % n] : null;
    const gt = gc ? new THREE.Vector2(gc.tan.x, gc.tan.z).normalize() : null;
    terrainHeight = (x: number, z: number): number => {
      const [d, ry] = distAndHeight(x, z);
      // flat band wide enough to always contain a vertex ring, then blend into the hills
      const t = THREE.MathUtils.smoothstep(d, halfW + 14, halfW + 80);
      let h = THREE.MathUtils.lerp(ry - 0.55, terrainNoise(x, z) - 0.6, t);
      if (gorge && gc && gt) {
        const dx = x - gc.pos.x, dz = z - gc.pos.z;
        const lateral = -dx * gt.y + dz * gt.x;
        const along = dx * gt.x + dz * gt.y + Math.sin(lateral * 0.018) * Math.min(1, Math.abs(lateral) / 60) * 14;
        h -= gorge.depth * (1 - THREE.MathUtils.smoothstep(Math.abs(along), gorge.half * 0.35, gorge.half));
      }
      return h;
    };
    const tg = new THREE.PlaneGeometry(size, size, segs, segs);
    tg.rotateX(-Math.PI / 2);
    const pos = tg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
      pos.setXYZ(i, x, terrainHeight(x, z), z);
    }
    tg.computeVertexNormals();
    const gTex = groundTexture(env.groundColor, spec.theme === 'snow' ? 14 : 34);
    gTex.repeat.set(size / 18, size / 18);
    disposables.push(gTex);
    const gMat = new THREE.MeshStandardMaterial({ map: gTex, roughness: spec.theme === 'snow' ? 0.7 : 0.98, metalness: 0, color: '#ffffff' });
    const terrain = new THREE.Mesh(tg, gMat);
    terrain.name = 'terrain';
    terrain.receiveShadow = true;
    group.add(terrain);
    disposables.push(tg, gMat);
  }
  void track_;

  return {
    group,
    road,
    terrainHeight,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Ribbon between two lateral offsets, following the samples (closed). */
function ribbon(
  track: TrackData,
  latA: number,
  latB: number,
  yOff: number,
  vAt: (i: number) => number,
  flip = false,
  dropA = 0,
  dropB = 0,
): THREE.BufferGeometry {
  return ribbonRange(track, 0, track.count, latA, latB, yOff, vAt, flip, true, dropA, dropB);
}

function ribbonRange(
  track: TrackData,
  from: number,
  to: number,
  latA: number,
  latB: number,
  yOff: number,
  vAt: (k: number) => number,
  flip = false,
  closed = false,
  dropA = 0,
  dropB = 0,
): THREE.BufferGeometry {
  const n = track.count;
  const v: number[] = [], uv: number[] = [], idx: number[] = [], nrm: number[] = [];
  const len = to - from;
  for (let k = 0; k <= len; k++) {
    const i = (from + k) % n;
    const s = track.samples[i];
    const a = s.pos.clone().addScaledVector(s.left, latA);
    const b = s.pos.clone().addScaledVector(s.left, latB);
    v.push(a.x, a.y + yOff + dropA, a.z, b.x, b.y + yOff + dropB, b.z);
    nrm.push(0, 1, 0, 0, 1, 0);
    const vv = vAt(k);
    uv.push(0, vv, 1, vv);
  }
  // winding: decide from the actual geometry so the ribbon always faces up (lat order varies)
  const bx = v[3] - v[0], bz = v[5] - v[2], cx = v[6] - v[0], cz = v[8] - v[2];
  const ny = bz * cx - bx * cz; // y of (B−A)×(C−A) for triangle (a, a+1, a+2)
  const flipFinal = ny <= 0;
  void flip;
  for (let k = 0; k < len; k++) {
    const a = k * 2;
    if (!flipFinal) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  void closed;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical wall along the track at a lateral offset. */
function wall(track: TrackData, lat: number, height: number, faceLeft: boolean, thicknessTop = 0, yBase = 0): THREE.BufferGeometry {
  const n = track.count;
  const v: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const s = track.samples[i];
    const b = s.pos.clone().addScaledVector(s.left, lat);
    const inward = Math.sign(-lat);
    v.push(b.x, b.y + yBase, b.z, b.x + s.left.x * inward * thicknessTop, b.y + yBase + height, b.z + s.left.z * inward * thicknessTop);
    const u = (k * track.spacing) / 4;
    uv.push(u, 0, u, 1);
  }
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    if (faceLeft) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export { rnd };
