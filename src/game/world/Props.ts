import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackData } from './TrackData';
import { coneTexture, facadeTexture, neonSignTexture, reseed, rnd, softSpriteTexture } from './textures';

export interface PropsRig {
  group: THREE.Group;
  update(t: number): void;
  dispose(): void;
}

const NEON_SIGNS: [string, string, string | undefined][] = [
  ['МЭДКИД', '#ff2d78', 'remixxx by dj dubstep'],
  ['ТЁМНЫЙ ПРИНЦ', '#00e5ff', 'MAYHEM · live'],
  ['SQWORE', '#9b5de5', undefined],
  ['GLWZBLL', '#3a86ff', 'кардан на месте'],
  ['SEXYSWAG', '#ffd400', '2010'],
  ['8 МИЛЯ', '#ff5e3a', 'не тормози'],
];

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

  if (spec.theme === 'city') {
    // ---- buildings: 4 facade variants, instanced ----
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    // scale UVs so windows tile by world size: handled by per-instance scale via uv repeat trick is not
    // possible; instead we bake 3 height classes with different geometry UV scales.
    const per = dense ? 110 : 60;
    const m = new THREE.Matrix4();
    for (let variant = 0; variant < 4; variant++) {
      const tex = facadeTexture(variant);
      disposables.push(tex.map, tex.emissive);
      const mat = new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: '#ffffff', emissiveIntensity: 1.1, roughness: 0.75, metalness: 0.1 });
      disposables.push(mat);
      const geo = boxGeo.clone();
      // repeat windows: UV multiply by (2, 6) so tall buildings show more floors
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 5);
      disposables.push(geo);
      const inst = new THREE.InstancedMesh(geo, mat, per);
      let placed = 0, guard = 0;
      while (placed < per && guard++ < 6000) {
        const ang = rnd() * Math.PI * 2;
        const rad = 70 + rnd() * 720;
        const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
        const d = distToTrack(x, z);
        if (d < halfW + 16) continue;
        const near = d < 60;
        const h = (near ? 14 + rnd() * 40 : 30 + rnd() * 120) * (rad > 500 ? 1.4 : 1);
        const w = 12 + rnd() * 22;
        const dpt = 12 + rnd() * 22;
        const rot = new THREE.Matrix4().makeRotationY(Math.round(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.2);
        m.makeScale(w, h, dpt).premultiply(rot);
        m.setPosition(x, terrainHeight(x, z) - 0.5, z);
        inst.setMatrixAt(placed++, m);
      }
      inst.count = placed;
      inst.castShadow = quality.shadows && variant < 2;
      inst.receiveShadow = true;
      group.add(inst);
    }
    boxGeo.dispose();

    // ---- rooftop / ground details: antenna masts with red beacons ----
    const mastGeo = new THREE.CylinderGeometry(0.15, 0.25, 12, 6);
    const masts: THREE.BufferGeometry[] = [];
    const beacons: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = 120 + rnd() * 600;
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      if (distToTrack(x, z) < halfW + 20) continue;
      const y = terrainHeight(x, z) + 40 + rnd() * 90;
      masts.push(mastGeo.clone().translate(x, y, z));
      beacons.push(new THREE.Vector3(x, y + 6, z));
    }
    mastGeo.dispose();
    if (masts.length) {
      const mg = mergeGeometries(masts)!;
      masts.forEach((g) => g.dispose());
      const mm = new THREE.MeshStandardMaterial({ color: '#2a2c36', roughness: 0.6, metalness: 0.7 });
      group.add(new THREE.Mesh(mg, mm));
      disposables.push(mg, mm);
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(beacons.flatMap((b) => [b.x, b.y, b.z]), 3));
      const bm = new THREE.PointsMaterial({ color: '#ff2020', size: 2.4, sizeAttenuation: false, transparent: true, depthWrite: false });
      const pts = new THREE.Points(bg, bm);
      group.add(pts);
      disposables.push(bg, bm);
      updaters.push((t) => {
        bm.opacity = 0.5 + 0.5 * Math.round(0.5 + 0.5 * Math.sin(t * 2.5));
      });
    }

    // ---- street lights along the track with fake beams ----
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 8, 6);
    poleGeo.translate(0, 4, 0);
    const armGeo = new THREE.BoxGeometry(2.2, 0.12, 0.12);
    armGeo.translate(1.0, 8, 0);
    const headGeo = new THREE.BoxGeometry(0.9, 0.18, 0.4);
    headGeo.translate(2.0, 7.95, 0);
    const poles: THREE.BufferGeometry[] = [];
    const heads: THREE.BufferGeometry[] = [];
    const cones: THREE.BufferGeometry[] = [];
    const pools: THREE.BufferGeometry[] = [];
    // volumetric beams are big additive overdraw right at camera height — high tier only;
    // every tier gets a light pool on the asphalt instead
    const beams = quality.level === 'high';
    const step = Math.round(30 / track.spacing);
    for (let i = 0, k = 0; i < n; i += step, k++) {
      const s = track.samples[i];
      const side = k % 2 === 0 ? 1 : -1;
      const p = s.pos.clone().addScaledVector(s.left, side * (halfW + 6.4));
      const heading = Math.atan2(s.tan.x, s.tan.z) + (side > 0 ? Math.PI : 0);
      const rot = new THREE.Matrix4().makeRotationY(heading + Math.PI / 2);
      poles.push(poleGeo.clone().applyMatrix4(rot).translate(p.x, p.y, p.z));
      poles.push(armGeo.clone().applyMatrix4(rot).translate(p.x, p.y, p.z));
      heads.push(headGeo.clone().applyMatrix4(rot).translate(p.x, p.y, p.z));
      // beam: two crossed planes under the head
      const hp = new THREE.Vector3(2.0, 7.9, 0).applyMatrix4(rot).add(p);
      const pool = new THREE.PlaneGeometry(9, 9);
      pool.rotateX(-Math.PI / 2);
      pool.translate(hp.x, track.heightAt(i) + 0.05, hp.z);
      pools.push(pool);
      if (beams) for (const a of [0, Math.PI / 2]) {
        const cg = new THREE.PlaneGeometry(5, 8);
        cg.translate(0, -4, 0);
        cg.applyMatrix4(new THREE.Matrix4().makeRotationY(a + heading));
        cg.translate(hp.x, hp.y, hp.z);
        cones.push(cg);
      }
    }
    poleGeo.dispose();
    armGeo.dispose();
    headGeo.dispose();
    const pm = mergeGeometries(poles)!;
    const hm = mergeGeometries(heads)!;
    const lm = mergeGeometries(pools)!;
    poles.forEach((g) => g.dispose());
    heads.forEach((g) => g.dispose());
    pools.forEach((g) => g.dispose());
    const poleMat = new THREE.MeshStandardMaterial({ color: '#1e2028', roughness: 0.55, metalness: 0.7 });
    const headMat = new THREE.MeshBasicMaterial({ color: '#fff1d0', toneMapped: false });
    const poolTex = softSpriteTexture(1, 0);
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: '#ffdca0', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
    const poolMesh = new THREE.Mesh(lm, poolMat);
    poolMesh.renderOrder = 2;
    group.add(new THREE.Mesh(pm, poleMat), new THREE.Mesh(hm, headMat), poolMesh);
    disposables.push(pm, hm, lm, poleMat, headMat, poolMat, poolTex);
    if (beams) {
      const coneTex = coneTexture();
      const cm = mergeGeometries(cones)!;
      cones.forEach((g) => g.dispose());
      const coneMat = new THREE.MeshBasicMaterial({ map: coneTex, color: '#ffe6b0', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      group.add(new THREE.Mesh(cm, coneMat));
      disposables.push(coneTex, cm, coneMat);
    }

    // ---- neon billboards near the track ----
    const bbStep = Math.round(n / NEON_SIGNS.length);
    NEON_SIGNS.forEach((sign, k) => {
      const i = (k * bbStep + Math.round(bbStep * 0.4)) % n;
      const s = track.samples[i];
      const side = k % 2 === 0 ? 1 : -1;
      const p = s.pos.clone().addScaledVector(s.left, side * (halfW + 9.5));
      const tex = neonSignTexture(sign[0], sign[1], sign[2]);
      disposables.push(tex);
      const w = 16, h = 6;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      const frameMat = new THREE.MeshStandardMaterial({ color: '#15161c', roughness: 0.6, metalness: 0.5 });
      disposables.push(mat, frameMat);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.5), frameMat);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), frameMat);
      disposables.push(panel.geometry, frame.geometry, legs.geometry);
      const g = new THREE.Group();
      frame.position.set(0, 10.5, -0.3);
      panel.position.set(0, 10.5, 0);
      legs.position.set(0, 3.5, -0.3);
      const legs2 = legs.clone();
      legs.position.x = -w * 0.35;
      legs2.position.x = w * 0.35;
      g.add(frame, panel, legs, legs2);
      g.position.set(p.x, p.y, p.z);
      g.lookAt(s.pos.x, p.y, s.pos.z);
      group.add(g);
      // flicker one sign
      if (k === 2) updaters.push((t) => { mat.opacity = Math.sin(t * 17) > -0.9 ? 1 : 0.2; mat.transparent = true; });
    });
  }

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
