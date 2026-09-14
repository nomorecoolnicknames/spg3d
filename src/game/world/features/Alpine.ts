import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackData } from '../TrackData';
import type { PropsRig } from '../Props';
import { createRockMaterial } from '../RockMaterial';
import { GeoBuilder, createCityMaterial } from '../city/kit';
import type { CellName } from '../city/atlas';
import { steam } from '../city/street';
import { softSpriteTexture } from '../textures';
import type { Lamp } from '../../render/LampField';

/**
 * Aurora Pass set pieces from TrackSpec.features: avalanche galleries cut into the mountain side
 * (lit ceiling, snowy roof, rock backfill), a village of log chalets with smoking chimneys, a chair
 * lift crossing high over the road, and the pass sign at the start.
 */
type V = { x: number; y: number; z: number };

export function buildAlpineFeatures(track: TrackData, terrainHeight: (x: number, z: number) => number, quality: { level: 'low' | 'medium' | 'high' }): PropsRig {
  const group = new THREE.Group();
  group.name = 'alpine-features';
  const disposables: { dispose(): void }[] = [];
  const updaters: ((t: number) => void)[] = [];
  const f = track.spec.features ?? {};
  const n = track.count;
  const halfW = track.halfW;
  const edge = halfW + track.runoff + 1.5;
  const idx = (u: number) => ((Math.round(u * n) % n) + n) % n;
  const kit = new GeoBuilder();
  const all = (cell: CellName, tile: [number, number]) => ({ front: { cell, tile }, back: { cell, tile }, left: { cell, tile }, right: { cell, tile } });
  const pools: THREE.BufferGeometry[] = [];
  const lamps: Lamp[] = [];
  const pool = (x: number, y: number, z: number, r: number) => {
    const p = new THREE.PlaneGeometry(r, r);
    p.rotateX(-Math.PI / 2);
    p.translate(x, y + 0.05, z);
    pools.push(p);
  };

  // ── avalanche galleries
  const rockPos: number[] = [];
  const rockIdx: number[] = [];
  for (const [u0, u1] of f.galleries ?? []) {
    const i0 = idx(u0), i1 = idx(u1);
    const count = (i1 - i0 + n) % n;
    const mid = track.samples[(i0 + Math.floor(count / 2)) % n];
    // the mountain is the higher side
    const hl = terrainHeight(mid.pos.x + mid.left.x * 45, mid.pos.z + mid.left.z * 45);
    const hr = terrainHeight(mid.pos.x - mid.left.x * 45, mid.pos.z - mid.left.z * 45);
    const m = hl >= hr ? 1 : -1;
    const step = Math.max(1, Math.round(6 / track.spacing));
    const H = 7;
    let rows = 0;
    const base = rockPos.length / 3;
    for (let k = 0; k < count; k += step) {
      const a = track.samples[(i0 + k) % n], b = track.samples[(i0 + Math.min(count, k + step)) % n];
      const q = (s: typeof a, o: number, dy: number): V => ({ x: s.pos.x + s.left.x * o, y: s.pos.y + dy, z: s.pos.z + s.left.z * o });
      const toRoad = { x: -a.left.x * m, y: 0, z: -a.left.z * m };
      const along = { s0: k * track.spacing, s1: (k + step) * track.spacing };
      const lamp = { s0: along.s0, s1: along.s1, perp0: edge, perp1: edge, spacing: 8, height: H - 0.6, k: 1.6 };
      // mountain wall, ceiling (lit), snowy roof, valley fascia
      kit.quadFacing(toRoad, q(a, m * edge, -0.3), q(b, m * edge, -0.3), q(b, m * edge, H), q(a, m * edge, H), 'galleryWall', [1.5, 1.75], 0, [0, 0], lamp);
      kit.quadFacing({ x: 0, y: -1, z: 0 }, q(a, m * edge, H), q(b, m * edge, H), q(b, -m * edge, H), q(a, -m * edge, H), 'tunnelCeil', [1, (edge * 2) / 6]);
      kit.quadFacing({ x: 0, y: 1, z: 0 }, q(a, m * (edge + 1), H + 0.9), q(b, m * (edge + 1), H + 0.9), q(b, -m * (edge + 0.6), H + 0.9), q(a, -m * (edge + 0.6), H + 0.9), 'roofSnow', [1, 4]);
      kit.quadFacing({ x: a.left.x * -m, y: 0, z: a.left.z * -m }, q(a, -m * (edge + 0.6), H), q(b, -m * (edge + 0.6), H), q(b, -m * (edge + 0.6), H + 0.9), q(a, -m * (edge + 0.6), H + 0.9), 'galleryWall', [1.5, 0.25]);
      // valley pillar
      const p = q(a, -m * edge, 0);
      kit.box(p.x, p.z, a.pos.y - 0.3, 0.9, 0.9, H + 0.3, Math.atan2(a.tan.x, a.tan.z), all('concrete', [0.25, 1.8]));
      if (k % (step * 2) === 0) {
        pool(a.pos.x, a.pos.y, a.pos.z, 9);
        lamps.push({ x: a.pos.x, y: a.pos.y + H - 0.4, z: a.pos.z, color: '#fff0d6', range: 14 });
      }
      // rock backfill rising from the roof into the mountain
      for (const [o, dy] of [[edge + 1, H + 0.9], [edge + 12, H + 5], [edge + 38, H + 12]] as const) {
        const v = q(a, m * o, dy);
        const ground = terrainHeight(v.x, v.z);
        rockPos.push(v.x, Math.max(v.y, o > edge + 20 ? ground + 2 : v.y), v.z);
      }
      rows++;
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < 2; c++) {
      const a = base + r * 3 + c;
      rockIdx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  }
  if (rockPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(rockPos, 3));
    g.setIndex(rockIdx);
    g.computeVertexNormals();
    const mat = createRockMaterial('#6f7f93', { snow: 1, low: quality.level === 'low' });
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'alpine:backfill';
    group.add(mesh);
    disposables.push(g, mat);
  }

  // ── village: log chalets with gable roofs on both sides of a straight
  const chimneys: V[] = [];
  if (f.village !== undefined) {
    const ic = idx(f.village);
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let h = 0; h < 9; h++) {
      const k = Math.round(((h - 4) * 22) / track.spacing);
      const s = track.samples[(ic + k + n) % n];
      const side = h % 2 === 0 ? 1 : -1;
      const off = edge + 16 + rnd() * 26;
      const cx = s.pos.x + s.left.x * side * off, cz = s.pos.z + s.left.z * side * off;
      const w = 8 + rnd() * 3, d = 9 + rnd() * 3, wallH = 5.4;
      const rot = Math.atan2(-s.left.x * side, -s.left.z * side) + (rnd() - 0.5) * 0.3;
      let y = Infinity;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) y = Math.min(y, terrainHeight(cx + dx * w * 0.5, cz + dz * d * 0.5));
      y -= 0.4;
      kit.box(cx, cz, y, w, d, wallH, rot, { front: { cell: 'woodWin', tile: [2, 2] }, back: { cell: 'woodWall', tile: [2, 2] }, left: { cell: 'woodWin', tile: [2, 2] }, right: { cell: 'woodWall', tile: [2, 2] } }, rnd());
      // gable roof along local x
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const P = (lx: number, ly: number, lz: number): V => ({ x: cx + lx * cs + lz * sn, y: y + ly, z: cz - lx * sn + lz * cs });
      const ridge = wallH + 3.4, ow = w / 2 + 0.8, od = d / 2 + 0.8;
      kit.quad(P(-ow, wallH - 0.3, od), P(ow, wallH - 0.3, od), P(ow, ridge, 0), P(-ow, ridge, 0), 'roofSnow', [2, 2]);
      kit.quad(P(ow, wallH - 0.3, -od), P(-ow, wallH - 0.3, -od), P(-ow, ridge, 0), P(ow, ridge, 0), 'roofSnow', [2, 2]);
      kit.quad(P(w / 2, wallH, d / 2), P(w / 2, wallH, -d / 2), P(w / 2, ridge - 0.2, 0), P(w / 2, ridge - 0.2, 0), 'woodWall', [2, 1]);
      kit.quad(P(-w / 2, wallH, -d / 2), P(-w / 2, wallH, d / 2), P(-w / 2, ridge - 0.2, 0), P(-w / 2, ridge - 0.2, 0), 'woodWall', [2, 1]);
      const ch = P(w * 0.25, 0, -d * 0.2);
      kit.box(ch.x, ch.z, y + wallH + 1.5, 0.9, 0.9, 3.4, rot, { ...all('redBlank', [0.3, 1]), top: { cell: 'roofBitumen', tile: [0.3, 0.3] } });
      chimneys.push({ x: ch.x, y: y + wallH + 4.9, z: ch.z });
    }
    // two lamps on the village straight
    for (const k of [-40, 40]) {
      const s = track.samples[(ic + Math.round(k / track.spacing) + n) % n];
      const p = { x: s.pos.x + s.left.x * (edge + 1.5), z: s.pos.z + s.left.z * (edge + 1.5) };
      kit.box(p.x, p.z, s.pos.y, 0.25, 0.25, 7.5, 0, all('metalVent', [0.1, 2]));
      kit.box(p.x, p.z, s.pos.y + 7.5, 0.7, 0.7, 0.4, 0, { ...all('tunnelCeil', [0.1, 0.12]), top: { cell: 'metalVent', tile: [0.1, 0.1] } });
      pool(s.pos.x + s.left.x * (halfW - 2), s.pos.y, s.pos.z + s.left.z * (halfW - 2), 11);
      lamps.push({ x: p.x, y: s.pos.y + 7.4, z: p.z, color: '#ffd8a8', range: 24 });
    }
  }

  // ── chair lift crossing the road high up
  if (f.lift !== undefined) {
    const s = track.samples[idx(f.lift)];
    const dir = new THREE.Vector3(s.left.x, 0, s.left.z).normalize();
    const tops: THREE.Vector3[] = [];
    for (let o = -180; o <= 180; o += 45) {
      const x = s.pos.x + dir.x * o, z = s.pos.z + dir.z * o;
      const ground = terrainHeight(x, z);
      const top = Math.max(ground + 13, s.pos.y + 14);
      if (Math.abs(o) > edge + 4) {
        kit.box(x, z, ground - 0.5, 1.1, 1.1, top - ground + 0.5, Math.atan2(dir.x, dir.z), all('metalVent', [0.3, 4]));
        kit.box(x, z, top, 4.2, 0.6, 0.6, Math.atan2(dir.x, dir.z) + Math.PI / 2, all('liftChair', [1, 0.2]));
      }
      tops.push(new THREE.Vector3(x, top + 0.3, z));
    }
    const cable = new THREE.BufferGeometry().setFromPoints(tops.flatMap((t, i) => (i ? [tops[i - 1], t] : [])));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(1.8);
    const cableMat = new THREE.LineBasicMaterial({ color: '#1a1d22' });
    for (const sgn of [-1, 1]) {
      const l = new THREE.LineSegments(cable, cableMat);
      l.position.copy(side).multiplyScalar(sgn);
      group.add(l);
    }
    disposables.push(cable, cableMat);
    // chairs travel along the cable: up on one side, down on the other
    const chairGeo = new THREE.BoxGeometry(1.4, 1.6, 1.1);
    chairGeo.translate(0, -1.2, 0);
    const chairMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.6 });
    const CHAIRS = 16;
    const chairs = new THREE.InstancedMesh(chairGeo, chairMat, CHAIRS);
    chairs.frustumCulled = false;
    group.add(chairs);
    disposables.push(chairGeo, chairMat);
    const m4 = new THREE.Matrix4();
    const tmp = new THREE.Vector3();
    const total = tops.length - 1;
    updaters.push((t) => {
      for (let c = 0; c < CHAIRS; c++) {
        const u = (t * 0.012 + c / CHAIRS) % 1;
        const up = c % 2 === 0;
        const pos = (up ? u : 1 - u) * total;
        const i = Math.min(total - 1, Math.floor(pos));
        tmp.lerpVectors(tops[i], tops[i + 1], pos - i).addScaledVector(side, up ? 1 : -1);
        m4.makeRotationY(Math.atan2(dir.x, dir.z)).setPosition(tmp);
        chairs.setMatrixAt(c, m4);
      }
      chairs.instanceMatrix.needsUpdate = true;
    });
  }

  // ── the pass sign over the start straight
  {
    const s = track.samples[idx(0.02)];
    const p = { x: s.pos.x - s.left.x * (edge + 3), z: s.pos.z - s.left.z * (edge + 3) };
    const rot = Math.atan2(s.tan.x, s.tan.z) + Math.PI;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const sgn of [-1, 1]) kit.box(p.x + sgn * 3 * cs, p.z - sgn * 3 * sn, s.pos.y, 0.3, 0.3, 5.5, rot, all('metalVent', [0.1, 1.5]));
    kit.box(p.x, p.z, s.pos.y + 5.5, 9, 0.3, 3.4, rot, { front: { cell: 'signPass', tile: [1, 1] }, back: { cell: 'metalVent', tile: [2, 1] }, left: { cell: 'metalVent', tile: [0.1, 1] }, right: { cell: 'metalVent', tile: [0.1, 1] }, top: { cell: 'roofSnow', tile: [2, 0.2] } });
  }

  if (kit.vertexCount) {
    const { material, uniforms } = createCityMaterial(true);
    material.color.set('#9aa3b4'); // moonlit, bluish
    const g = kit.toGeometry();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'alpine:structures';
    group.add(mesh);
    disposables.push(g, material);
    updaters.push((t) => (uniforms.time.value = t));
  }
  if (chimneys.length) {
    const smoke = steam(chimneys, quality.level === 'low' ? 6 : 12);
    group.add(smoke.points);
    disposables.push(smoke);
    updaters.push((t) => (smoke.time.value = t * 0.7));
  }
  if (pools.length) {
    const geo = mergeGeometries(pools)!;
    pools.forEach((p) => p.dispose());
    const tex = softSpriteTexture(1, 0);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#ffd8a8', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    group.add(mesh);
    disposables.push(geo, mat, tex);
  }

  return {
    group,
    lamps,
    update(t: number) {
      for (const u of updaters) u(t);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
