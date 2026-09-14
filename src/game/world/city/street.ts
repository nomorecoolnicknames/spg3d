import * as THREE from 'three';
import type { CellName } from './atlas';
import type { GeoBuilder } from './kit';
import { getGLTF } from '../../assets';
import { CARS } from '@/data/cars';

/**
 * Street furniture. Boxy pieces (bus stops, kiosks, traffic lights, billboards) go into the sector
 * builders with the city material; trees and parked cars are instanced (one draw call per kind).
 */
type B = (x: number, z: number) => GeoBuilder;
const all = (cell: CellName, tile: [number, number], start?: [number, number]) => ({ front: { cell, tile, start }, back: { cell, tile, start }, left: { cell, tile, start }, right: { cell, tile, start } });

/** bus stop shelter facing the street along `rot` (local +z = street side) */
export function busStop(gb: B, x: number, z: number, y: number, rot: number): void {
  const b = gb(x, z);
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const P = (lx: number, lz: number) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
  // back panel with an ad, roof slab, two posts
  const back = P(0, -0.9);
  b.box(back.x, back.z, y, 4.6, 0.12, 2.5, rot, { front: { cell: 'adStop', tile: [1, 1] }, back: { cell: 'adRival1', tile: [1, 1] }, left: { cell: 'metalVent', tile: [0.1, 1] }, right: { cell: 'metalVent', tile: [0.1, 1] } });
  b.box(x, z, y + 2.5, 5, 2.2, 0.16, rot, { ...all('metalVent', [1, 0.1]), top: { cell: 'roofBitumen', tile: [1, 1] } });
  for (const s of [-1, 1]) {
    const p = P(s * 2.3, 0.9);
    b.box(p.x, p.z, y, 0.12, 0.12, 2.5, rot, all('metalVent', [0.05, 1]));
  }
  const bench = P(0, -0.4);
  b.box(bench.x, bench.z, y + 0.42, 3, 0.45, 0.08, rot, { ...all('garageRust', [0.5, 0.05]), top: { cell: 'garageRust', tile: [1, 0.2] } });
}

/** newspaper / shawarma kiosk */
export function kiosk(gb: B, x: number, z: number, y: number, rot: number, kind: number): void {
  const b = gb(x, z);
  const front: CellName = kind % 2 === 0 ? 'kioskWall' : 'shopShawarma';
  b.box(x, z, y, 3.2, 2.4, 2.7, rot, { front: { cell: front, tile: [1, 1] }, back: { cell: 'corrGrey', tile: [1, 1] }, left: { cell: 'corrGrey', tile: [0.6, 1] }, right: { cell: 'corrGrey', tile: [0.6, 1] }, top: { cell: 'roofBitumen', tile: [1, 1] } });
  b.box(x, z, y + 2.7, 3.6, 2.8, 0.14, rot, { ...all('metalVent', [1, 0.1]), top: { cell: 'metalVent', tile: [1, 1] } });
}

/** traffic light on a pole; the lamp box shows the flashing amber of a city at night */
export function trafficLight(gb: B, x: number, z: number, y: number, rot: number): void {
  const b = gb(x, z);
  b.box(x, z, y, 0.2, 0.2, 3.4, rot, all('metalVent', [0.05, 1]));
  b.box(x, z, y + 3.4, 0.45, 0.35, 1.1, rot, { front: { cell: 'shopHardware', tile: [0.1, 0.12], start: [0.5, 0.78] }, back: { cell: 'metalVent', tile: [0.2, 0.3] }, left: { cell: 'metalVent', tile: [0.1, 0.3] }, right: { cell: 'metalVent', tile: [0.1, 0.3] }, top: { cell: 'metalVent', tile: [0.1, 0.1] } });
}

/** double-sided billboard on two legs */
export function billboard(gb: B, x: number, z: number, y: number, rot: number, art: CellName, height = 7): void {
  const b = gb(x, z);
  const cs = Math.cos(rot), sn = Math.sin(rot);
  for (const s of [-1, 1]) b.box(x + s * 3 * cs, z - s * 3 * sn, y, 0.35, 0.35, height, rot, all('metalVent', [0.1, 2]));
  b.box(x, z, y + height, 10, 0.4, 4.2, rot, { front: { cell: art, tile: [1, 1] }, back: { cell: art === 'adRival1' ? 'adRival2' : 'adRival1', tile: [1, 1] }, left: { cell: 'metalVent', tile: [0.1, 1] }, right: { cell: 'metalVent', tile: [0.1, 1] }, top: { cell: 'metalVent', tile: [1, 0.1] } });
}

/** low-poly deciduous trees, one instanced mesh */
export function trees(points: { x: number; y: number; z: number; s: number }[]): { mesh: THREE.InstancedMesh; dispose(): void } {
  const crown = new THREE.IcosahedronGeometry(2.4, 0);
  crown.translate(0, 5.4, 0);
  const crown2 = new THREE.IcosahedronGeometry(1.7, 0);
  crown2.translate(0.9, 6.6, 0.4);
  const trunk = new THREE.CylinderGeometry(0.14, 0.22, 4.4, 5);
  trunk.translate(0, 2.2, 0);
  const paint = (g: THREE.BufferGeometry, c: THREE.Color, jitter: number) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = 1 - jitter + Math.random() * jitter;
      col[i * 3] = c.r * k;
      col[i * 3 + 1] = c.g * k;
      col[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const geo = mergeTrees([paint(crown, new THREE.Color('#1f3a22'), 0.35), paint(crown2, new THREE.Color('#2a4a26'), 0.35), paint(trunk, new THREE.Color('#2b2119'), 0.2)]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, points.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  points.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.x * 0.37 + p.z * 0.11);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * (0.9 + ((i * 7) % 5) * 0.05), p.s));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = points.length;
  mesh.name = 'city:trees';
  mesh.computeBoundingSphere();
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

function mergeTrees(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    p.computeVertexNormals();
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nrm.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Parked cars along side streets: the far LOD of the real car models, un-skinned, one instanced
 * mesh per model. Colours are per instance (they tint the whole body — fine at night, at a distance).
 */
export function parkedCars(spots: { x: number; y: number; z: number; rot: number }[]): { meshes: THREE.InstancedMesh[]; dispose(): void } {
  const meshes: THREE.InstancedMesh[] = [];
  const disposables: { dispose(): void }[] = [];
  const models = CARS.filter((c) => c.id !== 'bolide').map((c) => c.model);
  const palette = ['#8a8f96', '#2b2e33', '#6b1f22', '#e8e6e0', '#1e3a5f', '#4a5a3c', '#9b7a45'].map((c) => new THREE.Color(c));
  models.forEach((model, mi) => {
    const gltf = getGLTF(model);
    if (!gltf) return;
    let body: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && /body_LOD3/.test(o.name)) body = o;
    });
    if (!body) return;
    const src = body as THREE.Mesh;
    const mine = spots.filter((_, i) => i % models.length === mi);
    if (!mine.length) return;
    const geo = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv'] as const) if (src.geometry.attributes[k]) geo.setAttribute(k, src.geometry.attributes[k]);
    geo.setIndex(src.geometry.index);
    const srcMat = src.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({ map: srcMat.map, roughnessMap: srcMat.roughnessMap, metalnessMap: srcMat.metalnessMap, roughness: 1, metalness: 1, alphaTest: srcMat.alphaTest });
    const inst = new THREE.InstancedMesh(geo, mat, mine.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    mine.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, palette[(i * 3 + mi) % palette.length]);
    });
    inst.name = `city:parked:${model}`;
    inst.computeBoundingSphere();
    meshes.push(inst);
    disposables.push(geo, mat);
  });
  return {
    meshes,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
