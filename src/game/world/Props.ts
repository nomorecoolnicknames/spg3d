import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackData } from './TrackData';
import type { Lamp } from '../render/LampField';
import { reseed, rnd } from './textures';

export interface PropsRig {
  group: THREE.Group;
  update(t: number): void;
  dispose(): void;
  /** light sources for the LampField (car and road lighting, halos) */
  lamps?: Lamp[];
}

/** Theme props placed off-track; uses the terrain height so nothing floats. */
export function buildProps(track: TrackData, terrainHeight: (x: number, z: number) => number, quality: { shadows: boolean; level: string }): PropsRig {
  const spec = track.spec;
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const n = track.count;
  const halfW = track.halfW;
  const dense = quality.level !== 'low';
  const updaters: ((t: number) => void)[] = [];

  const coarse = track.samples.filter((_, i) => i % 5 === 0);
  const distToTrack = (x: number, z: number): number => {
    let m = Infinity;
    for (const s of coarse) {
      const d = (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  };
  const cx = (track.bounds.minX + track.bounds.maxX) / 2;
  const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
  reseed(77);

  // the city theme is built by world/city/City.ts

  if (spec.theme === 'desert') {
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#8d5535', roughness: 0.95, flatShading: true });
    disposables.push(rockGeo, rockMat);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, dense ? 220 : 120);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let placed = 0, guard = 0;
    while (placed < rocks.count && guard++ < 6000) {
      const ang = rnd() * Math.PI * 2;
      const rad = 40 + rnd() * 700;
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      if (distToTrack(x, z) < halfW + 9) continue;
      const s = 1.2 + rnd() * 7;
      q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
      m.compose(new THREE.Vector3(x, terrainHeight(x, z) + s * 0.25, z), q, new THREE.Vector3(s, s * (0.5 + rnd() * 0.6), s));
      rocks.setMatrixAt(placed++, m);
    }
    rocks.count = placed;
    rocks.castShadow = quality.shadows;
    rocks.receiveShadow = true;
    group.add(rocks);
    // mesas on the horizon
    const mesaMat = new THREE.MeshStandardMaterial({ color: '#a8643c', roughness: 1, flatShading: true });
    disposables.push(mesaMat);
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
      const rad = 650 + rnd() * 500;
      const g = new THREE.CylinderGeometry(40 + rnd() * 60, 90 + rnd() * 120, 60 + rnd() * 120, 9, 1);
      disposables.push(g);
      const mesa = new THREE.Mesh(g, mesaMat);
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      mesa.position.set(x, terrainHeight(x, z) + 10, z);
      mesa.rotation.y = rnd() * 3;
      group.add(mesa);
    }
    // cacti
    const cactusGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.35, 0.42, 4.5, 7).translate(0, 2.25, 0),
      new THREE.CylinderGeometry(0.22, 0.26, 1.8, 6).rotateZ(Math.PI / 2).translate(0.6, 2.4, 0),
      new THREE.CylinderGeometry(0.22, 0.26, 1.6, 6).translate(1.3, 3.2, 0),
      new THREE.CylinderGeometry(0.22, 0.26, 1.4, 6).rotateZ(-Math.PI / 2).translate(-0.5, 3.0, 0),
      new THREE.CylinderGeometry(0.22, 0.26, 1.8, 6).translate(-1.1, 3.9, 0),
    ])!;
    const cactusMat = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 0.9 });
    disposables.push(cactusGeo, cactusMat);
    const cacti = new THREE.InstancedMesh(cactusGeo, cactusMat, dense ? 90 : 45);
    placed = 0;
    guard = 0;
    while (placed < cacti.count && guard++ < 4000) {
      const ang = rnd() * Math.PI * 2;
      const rad = 30 + rnd() * 500;
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      if (distToTrack(x, z) < halfW + 8) continue;
      m.makeRotationY(rnd() * 6);
      m.scale(new THREE.Vector3(1, 0.8 + rnd() * 0.9, 1));
      m.setPosition(x, terrainHeight(x, z), z);
      cacti.setMatrixAt(placed++, m);
    }
    cacti.count = placed;
    cacti.castShadow = quality.shadows;
    group.add(cacti);
    // power line poles along one side
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.22, 9, 6).translate(0, 4.5, 0);
    const crossGeo = new THREE.BoxGeometry(2.6, 0.14, 0.14).translate(0, 8.4, 0);
    const poles: THREE.BufferGeometry[] = [];
    const step = Math.round(40 / track.spacing);
    const wirePts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i += step) {
      const s = track.samples[i];
      const p = s.pos.clone().addScaledVector(s.left, halfW + 14);
      const y = terrainHeight(p.x, p.z);
      poles.push(poleGeo.clone().translate(p.x, y, p.z), crossGeo.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(s.tan.x, s.tan.z) + Math.PI / 2)).translate(p.x, y, p.z));
      wirePts.push(new THREE.Vector3(p.x, y + 8.4, p.z));
    }
    poleGeo.dispose();
    crossGeo.dispose();
    const pm = mergeGeometries(poles)!;
    poles.forEach((g) => g.dispose());
    const pMat = new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.9 });
    group.add(new THREE.Mesh(pm, pMat));
    disposables.push(pm, pMat);
    const wireGeo = new THREE.BufferGeometry().setFromPoints([...wirePts, wirePts[0]]);
    const wireMat = new THREE.LineBasicMaterial({ color: '#1a1410' });
    group.add(new THREE.Line(wireGeo, wireMat));
    disposables.push(wireGeo, wireMat);
  }

  if (spec.theme === 'snow') {
    const pineGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6).translate(0, 1.1, 0),
      new THREE.ConeGeometry(2.4, 3.6, 8).translate(0, 3.4, 0),
      new THREE.ConeGeometry(1.8, 3.0, 8).translate(0, 5.4, 0),
      new THREE.ConeGeometry(1.15, 2.4, 8).translate(0, 7.1, 0),
    ])!;
    const pineMat = new THREE.MeshStandardMaterial({ color: '#1b3f33', roughness: 0.95 });
    const capGeo = mergeGeometries([
      new THREE.ConeGeometry(2.42, 0.9, 8).translate(0, 4.75, 0),
      new THREE.ConeGeometry(1.82, 0.8, 8).translate(0, 6.5, 0),
      new THREE.ConeGeometry(1.17, 0.8, 8).translate(0, 7.9, 0),
    ])!;
    const capMat = new THREE.MeshStandardMaterial({ color: '#eef4fa', roughness: 0.85 });
    disposables.push(pineGeo, pineMat, capGeo, capMat);
    const count = dense ? 320 : 160;
    const pines = new THREE.InstancedMesh(pineGeo, pineMat, count);
    const caps = new THREE.InstancedMesh(capGeo, capMat, count);
    const m = new THREE.Matrix4();
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 8000) {
      const ang = rnd() * Math.PI * 2;
      const rad = 28 + rnd() * 650;
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      if (distToTrack(x, z) < halfW + 8) continue;
      const sc = 0.8 + rnd() * 1.6;
      m.makeRotationY(rnd() * 6);
      m.scale(new THREE.Vector3(sc, sc, sc));
      m.setPosition(x, terrainHeight(x, z) - 0.2, z);
      pines.setMatrixAt(placed, m);
      caps.setMatrixAt(placed, m);
      placed++;
    }
    pines.count = placed;
    caps.count = placed;
    pines.castShadow = quality.shadows;
    group.add(pines, caps);
    // rocks with snow
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#5a6470', roughness: 0.9, flatShading: true });
    disposables.push(rockGeo, rockMat);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 80);
    placed = 0;
    guard = 0;
    while (placed < 80 && guard++ < 3000) {
      const ang = rnd() * Math.PI * 2;
      const rad = 40 + rnd() * 600;
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      if (distToTrack(x, z) < halfW + 9) continue;
      const s = 1.5 + rnd() * 6;
      m.makeRotationY(rnd() * 6);
      m.scale(new THREE.Vector3(s, s * 0.6, s));
      m.setPosition(x, terrainHeight(x, z), z);
      rocks.setMatrixAt(placed++, m);
    }
    rocks.count = placed;
    group.add(rocks);
    // distant mountains
    const mtMat = new THREE.MeshStandardMaterial({ color: '#8fa3b8', roughness: 1, flatShading: true });
    disposables.push(mtMat);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
      const rad = 700 + rnd() * 500;
      const g = new THREE.ConeGeometry(120 + rnd() * 160, 160 + rnd() * 220, 7);
      disposables.push(g);
      const mt = new THREE.Mesh(g, mtMat);
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      mt.position.set(x, terrainHeight(x, z) + 40, z);
      mt.rotation.y = rnd() * 3;
      group.add(mt);
    }
  }

  return {
    group,
    update(t) {
      for (const u of updaters) u(t);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
  };
}
