import * as THREE from 'three';
import { mergeStaticMeshes } from '../world/merge';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOSS_ENV } from '@/data/tracks';
import { ParticlePool } from './fx';
import { GeoBuilder, createCityMaterial, type CityMaterialUniforms } from '../world/city/kit';
import { BUILD, LOT_SIZE, type Archetype, type Lot } from '../world/city/buildings';
import { buildOsmCity } from '../world/osm/OsmCity';
import type { OsmWorld } from '../world/osm/types';

/**
 * The final: the yard of Ligovsky 50 in Saint Petersburg at the entrance of club 1703 (PLAN_V4, stage H).
 * Arena space is centred in the driveway east of the club door; the real loft warehouses stand around it
 * (world/osm from the Ligovsky map data), the door with the 1703 sign is on the rim straight ahead of the
 * player (−z). Without map data the old fictional plaza is built.
 */
export const ARENA_RADIUS = 58;
/** Ligovsky map frame: centre of the fight (one radius from the door, into the driveway) and the club door (OSM node 6471066191 «1703») */
const LIG50 = { centre: [44.6, 52.9] as const, door: [-10.4, 34.6] as const };

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function pavingTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#1a1b20';
  ctx.fillRect(0, 0, 512, 512);
  const tile = 64;
  for (let y = 0; y < 512; y += tile) {
    for (let x = 0; x < 512; x += tile) {
      const v = 22 + Math.random() * 14;
      ctx.fillStyle = `rgb(${v},${v + 1},${v + 5})`;
      ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      // wear
      for (let i = 0; i < 25; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
        ctx.fillRect(x + Math.random() * tile, y + Math.random() * tile, 3, 3);
      }
    }
  }
  // grout lines
  ctx.strokeStyle = '#0c0d11';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 512; i += tile) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // roughness: puddles = low roughness blobs
  const [rc, rctx] = canvas(512, 512);
  rctx.fillStyle = '#b0b0b0';
  rctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 10; i++) {
    const g = rctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, '#606060');
    g.addColorStop(0.7, '#707070');
    g.addColorStop(1, '#b0b0b0');
    rctx.save();
    rctx.translate(Math.random() * 512, Math.random() * 512);
    rctx.scale(30 + Math.random() * 60, 20 + Math.random() * 40);
    rctx.fillStyle = g;
    rctx.beginPath(); rctx.arc(0, 0, 1, 0, Math.PI * 2); rctx.fill();
    rctx.restore();
  }
  // grout is rougher
  rctx.strokeStyle = '#e0e0e0';
  rctx.lineWidth = 3;
  for (let i = 0; i <= 512; i += tile) {
    rctx.beginPath(); rctx.moveTo(i, 0); rctx.lineTo(i, 512); rctx.stroke();
    rctx.beginPath(); rctx.moveTo(0, i); rctx.lineTo(512, i); rctx.stroke();
  }
  const rough = new THREE.CanvasTexture(rc);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, rough };
}

function hazardTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#7a7a7e';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#d9a21b';
  for (let x = -64; x < 256; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 64); ctx.lineTo(x + 24, 64); ctx.lineTo(x + 48, 40); ctx.lineTo(x + 24, 40);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 120; i++) ctx.fillRect(Math.random() * 256, Math.random() * 64, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function neonSign(text: string, color: string, w: number, h: number): THREE.Mesh {
  const [c, ctx] = canvas(1024, 256);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.font = 'bold 150px "Russo One", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 40;
  ctx.fillStyle = color;
  ctx.fillText(text, 512, 132);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.font = 'bold 130px "Russo One", Impact, sans-serif';
  ctx.fillText(text, 512, 132);
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  return m;
}

export interface Arena {
  group: THREE.Group;
  lights: THREE.Light[];
  sun: THREE.DirectionalLight;
  /** obstacles as circles (x, z, r) for movement collision */
  obstacles: { x: number; z: number; r: number }[];
  update(dt: number, t: number, camPos: THREE.Vector3): void;
  dispose(): void;
}

export function buildArena(scene: THREE.Scene, quality: { shadows: boolean; low: boolean }, world?: OsmWorld): Arena {
  const env = BOSS_ENV;
  const group = new THREE.Group();
  const disposables: THREE.Texture[] = [];
  const disposers: (() => void)[] = [];
  let yardFrame: THREE.Group | null = null;
  const obstacles: Arena['obstacles'] = [];

  let cityUniforms: CityMaterialUniforms | null = null;
  scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
  scene.background = new THREE.Color(env.skyTop);

  // ---- sky dome ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(env.skyTop) },
      mid: { value: new THREE.Color(env.skyBottom) },
      hor: { value: new THREE.Color(env.horizon) },
    },
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = mix(hor, mid, smoothstep(-0.02, 0.12, h)); c = mix(c, top, smoothstep(0.12, 0.6, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
  group.add(sky);

  // stars
  const starGeo = new THREE.BufferGeometry();
  const sv: number[] = [];
  for (let i = 0; i < 700; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = Math.abs(v.y) * 0.9 + 0.1;
    v.normalize().multiplyScalar(850);
    sv.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#cfd8ff', size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
  group.add(stars);

  // ---- lights ----
  const sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
  sun.position.set(-40, 90, -30);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 250;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#4a2a5a', '#14161e', 0.9);
  group.add(hemi);
  // rim from the neon signs
  const fill = new THREE.DirectionalLight('#2ee6ff', 0.35);
  fill.position.set(60, 30, 40);
  group.add(fill);

  // ---- ground ----
  const pav = pavingTextures();
  disposables.push(pav.map, pav.rough);
  pav.map.repeat.set(24, 24);
  pav.rough.repeat.set(24, 24);
  const groundMat = new THREE.MeshStandardMaterial({ map: pav.map, roughnessMap: pav.rough, roughness: 1, metalness: 0.15, envMapIntensity: 0.6 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(ARENA_RADIUS + 14, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // outer dark asphalt + water beyond
  if (!world) {
    const outer = new THREE.Mesh(new THREE.RingGeometry(ARENA_RADIUS + 14, 400, 64), new THREE.MeshStandardMaterial({ color: '#0a0b10', roughness: 0.9, metalness: 0.1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    group.add(outer);
    const water = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshStandardMaterial({ color: '#06080f', roughness: 0.25, metalness: 0.6, envMapIntensity: 1.2 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -1.5;
    group.add(water);
  }

  // central plaza inlay: big concentric ring markings (emissive faint)
  const ringMat = new THREE.MeshBasicMaterial({ color: '#2a2f3d', transparent: true, opacity: 0.55, depthWrite: false });
  for (const r of [12, 26, 44]) {
    const rg = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r + 0.25, 128), ringMat);
    rg.rotation.x = -Math.PI / 2;
    rg.position.y = 0.02;
    group.add(rg);
  }

  // ---- barriers around the arena (hazard striped concrete) ----
  const hz = hazardTexture();
  disposables.push(hz);
  const barrierMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.85, metalness: 0.05 });
  const barrierGeo = new RoundedBoxGeometry(6.2, 1.2, 0.7, 2, 0.08);
  const nB = Math.round((Math.PI * 2 * (ARENA_RADIUS + 2)) / 6.3);
  const barriers = new THREE.InstancedMesh(barrierGeo, barrierMat, nB);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * Math.PI * 2;
    const r = ARENA_RADIUS + 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 0.6, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
    barriers.setMatrixAt(i, m4);
  }
  barriers.castShadow = true;
  barriers.receiveShadow = true;
  group.add(barriers);
  // neon strip on barriers
  const strip = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS + 2, 0.06, 6, 160), new THREE.MeshBasicMaterial({ color: env.neonA }));
  strip.rotation.x = Math.PI / 2;
  strip.position.y = 1.25;
  group.add(strip);

  // ---- lamp posts ----
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 9, 8).translate(0, 4.5, 0);
  const armGeo = new THREE.BoxGeometry(2.2, 0.12, 0.12).translate(-1.0, 9, 0);
  const poleMerged = mergeGeometries([poleGeo, armGeo])!;
  const poleMat = new THREE.MeshStandardMaterial({ color: '#23252d', roughness: 0.6, metalness: 0.7 });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
  const lampGeo = new THREE.BoxGeometry(0.8, 0.14, 0.3).translate(-2.0, 8.95, 0);
  const nP = 12;
  const poles = new THREE.InstancedMesh(poleMerged, poleMat, nP);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, nP);
  for (let i = 0; i < nP; i++) {
    const a = (i / nP) * Math.PI * 2 + 0.13;
    const r = ARENA_RADIUS - 4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(i, m4);
    lamps.setMatrixAt(i, m4);
    // lamp point lights only above the phone tier: every light is paid per lit pixel
    if (i % 3 === 0 && !quality.low) {
      const pl = new THREE.PointLight('#ffd9a0', 12, 34, 1.9);
      pl.position.set(Math.cos(a) * (r - 2), 8.5, Math.sin(a) * (r - 2));
      group.add(pl);
    }
  }
  poles.castShadow = true;
  group.add(poles, lamps);

  // ---- containers (cover) ----
  const contMat = [
    new THREE.MeshStandardMaterial({ color: '#8a2a2a', roughness: 0.7, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: '#1f4d7a', roughness: 0.7, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: '#4d6b2a', roughness: 0.7, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: '#8a6a2a', roughness: 0.7, metalness: 0.4 }),
  ];
  const contGeo = new RoundedBoxGeometry(12, 2.9, 2.6, 2, 0.06);
  // corrugation: fake with a normal-ish darker stripe texture
  const ribs = new THREE.BoxGeometry(12.02, 0.12, 2.62);
  const ribMat = new THREE.MeshStandardMaterial({ color: '#0e0f13', roughness: 0.8 });
  const stacks: [number, number, number, number][] = [
    [38, 18, 0.5, 2], [-40, 15, -0.4, 1], [27, -31, 1.2, 2], [-26, -36, 0.3, 1], [44, -10, 2.1, 1],
  ];
  stacks.forEach(([x, z, rot, layers], si) => {
    for (let l = 0; l < layers; l++) {
      const c = new THREE.Mesh(contGeo, contMat[(si + l) % contMat.length]);
      c.position.set(x + (l ? 0.6 : 0), 1.45 + l * 2.95, z + (l ? 0.3 : 0));
      c.rotation.y = rot + (l ? 0.05 : 0);
      c.castShadow = true;
      c.receiveShadow = true;
      group.add(c);
      for (const yy of [0.9, 1.45, 2.0]) {
        const rb = new THREE.Mesh(ribs, ribMat);
        rb.position.set(0, yy - 1.45, 0);
        c.add(rb);
      }
    }
    obstacles.push({ x, z, r: 6.4 });
  });

  if (world) {
    // ---- Ligovsky 50: the real loft warehouses, Moskovsky station tracks and Galeria around the yard ----
    const [cx, cz] = LIG50.centre;
    const dx = LIG50.door[0] - cx, dz = LIG50.door[1] - cz;
    const yard = buildOsmCity(null, world, { level: quality.low ? 'low' : 'medium' }, { arena: { x: cx, z: cz, r: ARENA_RADIUS, reach: quality.low ? 170 : 320 } });
    const frame = new THREE.Group();
    frame.name = 'arena:lig50';
    yard.group.position.set(-cx, 0, -cz);
    frame.add(yard.group);
    // turn the map so the club door is straight ahead of the player's start (arena −z)
    frame.rotation.y = Math.atan2(dx, -dz);
    // added after the static merge below: its sectors stay separate meshes for frustum culling
    yardFrame = frame;
    yard.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (o.name.startsWith('osm:') && mat && 'color' in mat && !o.name.startsWith('osm:lm')) mat.color.set('#6a6e7a');
    });
    disposers.push(() => yard.dispose());
    const doorDist = Math.hypot(dx, dz);
    // the club door: a lit portal, the 1703 sign over it and the stage Madkid plays on
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 0.4), new THREE.MeshStandardMaterial({ color: '#1a0f10', emissive: '#ff2a3a', emissiveIntensity: 0.35, roughness: 0.4 }));
    door.position.set(0, 1.7, -doorDist - 0.6);
    group.add(door);
    const doorLight = new THREE.PointLight('#ff3040', 60, 30, 1.6);
    doorLight.position.set(0, 4.5, -doorDist + 3);
    group.add(doorLight);
    const stage = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 6), new THREE.MeshStandardMaterial({ color: '#16171c', roughness: 0.6, metalness: 0.3 }));
    deck.position.y = 0.6;
    stage.add(deck);
    const trussMat = new THREE.MeshStandardMaterial({ color: '#8a8f99', roughness: 0.35, metalness: 0.9 });
    for (const sx of [-7.6, 7.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7, 0.45), trussMat);
      post.position.set(sx, 3.5, -2.6);
      stage.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.45, 0.45), trussMat);
    beam.position.set(0, 7, -2.6);
    stage.add(beam);
    const speakerMat = new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.8 });
    for (const sx of [-6.2, 6.2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.2, 1.4), speakerMat);
      sp.position.set(sx, 2.8, 1.2);
      stage.add(sp);
    }
    stage.position.set(0, 0, -doorDist + 9);
    group.add(stage);
    for (const ox of [-6, 0, 6]) obstacles.push({ x: ox, z: -doorDist + 9, r: 3.4 });
  } else {
    // ---- cranes (silhouettes) ----
    const craneMat = new THREE.MeshStandardMaterial({ color: '#15161c', roughness: 0.8, metalness: 0.5 });
    for (const [x, z] of [[-120, -60], [130, -20], [40, -140]]) {
      const cr = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.BoxGeometry(4, 60, 4), craneMat);
      tower.position.y = 30;
      const jib = new THREE.Mesh(new THREE.BoxGeometry(50, 2.5, 2.5), craneMat);
      jib.position.set(18, 61, 0);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 4), craneMat);
      counter.position.set(-10, 60, 0);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
      beacon.position.set(0, 63, 0);
      cr.add(tower, jib, counter, beacon);
      cr.position.set(x, 0, z);
      cr.rotation.y = Math.random() * Math.PI * 2;
      group.add(cr);
    }

    // ---- the embankment around the plaza: Neon City kit buildings (shared city material) ----
    {
      let seed = 7331;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const builders = new Map<string, GeoBuilder>();
      const gb = (x: number, z: number) => {
        const k = `${Math.sign(x)},${Math.sign(z)}`;
        let b = builders.get(k);
        if (!b) builders.set(k, (b = new GeoBuilder()));
        return b;
      };
      const row = (from: number, to: number, line: number, axis: 'x' | 'z', rot: number, pick: () => Archetype, y0 = 0) => {
        for (let t = from; t < to; ) {
          const arch = pick();
          const [lmin, lmax, depth] = LOT_SIZE[arch];
          const len = lmin + rnd() * (lmax - lmin);
          const mid = t + len / 2;
          const back = depth / 2;
          const lot: Lot = axis === 'x'
            ? { cx: mid, cz: line + (rot === 0 ? -back : back), y0, rot, len, depth, seed: rnd() }
            : { cx: line + (rot === Math.PI / 2 ? -back : back), cz: mid, y0, rot, len, depth, seed: rnd() };
          BUILD[arch](gb(lot.cx, lot.cz), lot, rnd);
          t += len + 3 + rnd() * 6;
        }
      };
      // north: stalinka front with towers behind; the MEDKID sign hangs on the middle facade
      row(-250, 250, -118, 'x', 0, () => (rnd() < 0.8 ? 'stalinka' : 'brick5'));
      row(-300, 300, -175, 'x', 0, () => (rnd() < 0.45 ? 'tower' : 'panel9'));
      // west / east sides facing the plaza
      row(-110, 70, -122, 'z', Math.PI / 2, () => (rnd() < 0.6 ? 'stalinka' : 'panel9'));
      row(-110, 70, 122, 'z', -Math.PI / 2, () => (rnd() < 0.6 ? 'stalinka' : 'panel9'));
      // far bank across the water
      row(-320, 320, 250, 'x', Math.PI, () => (rnd() < 0.6 ? 'stalinka' : 'panel9'));
      const city = createCityMaterial(true);
      // the arena is lit hard (sign lights, moon): keep the facades in the dark
      city.material.color.set('#565a66');
      for (const b of builders.values()) {
        const mesh = new THREE.Mesh(b.toGeometry(), city.material);
        mesh.name = 'arena:city';
        group.add(mesh);
      }
      cityUniforms = city.uniforms;
    }
  }

  // ---- neon signs ----
  const signs: THREE.Mesh[] = [];
  const s1 = neonSign('МЭДКИД', '#ff1e3c', 44, 11);
  const s2 = neonSign('ТЁМНЫЙ ПРИНЦ', '#2ee6ff', 52, 12);
  const s3 = neonSign('SEXYSWAG 2010', '#ff2d78', 40, 10);
  if (world) {
    // over the club roof, and on the warehouses left and right of the yard
    s1.position.set(0, 21, -ARENA_RADIUS - 16);
    s2.position.set(-ARENA_RADIUS - 22, 18, -18);
    s2.rotation.y = 1.2;
    s3.position.set(ARENA_RADIUS + 22, 16, -20);
    s3.rotation.y = -1.2;
    const club = neonSign('1703', '#ff2a3a', 9, 2.4);
    club.position.set(0, 6.4, -Math.hypot(LIG50.door[0] - LIG50.centre[0], LIG50.door[1] - LIG50.centre[1]) + 0.2);
    signs.push(club);
    group.add(club);
    disposables.push((club.material as THREE.MeshBasicMaterial).map!);
  } else {
    s1.position.set(0, 34, -120);
    s2.position.set(-96, 26, -60);
    s2.rotation.y = 0.9;
    s3.position.set(100, 22, -54);
    s3.rotation.y = -0.9;
  }
  for (const s of [s1, s2, s3]) {
    signs.push(s);
    group.add(s);
    disposables.push((s.material as THREE.MeshBasicMaterial).map!);
  }
  const signLight = new THREE.PointLight('#ff1e3c', 250, 220, 1.4);
  signLight.position.set(0, world ? 20 : 30, world ? -ARENA_RADIUS - 6 : -100);
  group.add(signLight);
  if (!quality.low) {
    const signLight2 = new THREE.PointLight('#2ee6ff', 160, 200, 1.4);
    signLight2.position.set(world ? -ARENA_RADIUS - 10 : -70, 22, world ? -18 : -45);
    group.add(signLight2);
  }

  // ---- sweeping spotlights ----
  const beamMat = new THREE.MeshBasicMaterial({ color: '#7fb8ff', transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beams: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(14, 260, 16, 1, true), beamMat);
    b.geometry.translate(0, 130, 0);
    const a = (i / 3) * Math.PI * 2 + 0.7;
    b.position.set(Math.cos(a) * (ARENA_RADIUS + 25), 0, Math.sin(a) * (ARENA_RADIUS + 25));
    group.add(b);
    beams.push(b);
  }

  // ---- rain ----
  const rain = new ParticlePool(1400, false);
  (rain.points.material as THREE.ShaderMaterial).depthWrite = false;
  group.add(rain.points);
  const rainColor = new THREE.Color('#9fc4ff');

  // static dressing → one mesh per material (beams sweep, the scanning sign flickers)
  mergeStaticMeshes(group, new Set<THREE.Object3D>([...beams, s1]));
  if (yardFrame) group.add(yardFrame);
  scene.add(group);

  let rainT = 0;
  return {
    group,
    lights: [sun, hemi, fill],
    sun,
    obstacles,
    update(dt, t, camPos) {
      beams.forEach((b, i) => {
        b.rotation.z = Math.sin(t * 0.25 + i * 2.1) * 0.5;
        b.rotation.x = Math.cos(t * 0.19 + i * 1.3) * 0.45;
      });
      // rain around camera
      rainT += dt;
      const n = Math.min(60, Math.floor(dt * 900));
      for (let i = 0; i < n; i++) {
        rain.emit({ x: camPos.x, y: camPos.y + 18, z: camPos.z, spread: 70, vy: -22, vx: 1.5, life: 1.1, size0: 0.55, size1: 0.45, color: rainColor, fade: 0.45 });
      }
      rain.update(dt);
      (s1.material as THREE.MeshBasicMaterial).opacity = 0.9;
      if (cityUniforms) cityUniforms.time.value = t;
      sun.target.position.set(camPos.x, 0, camPos.z);
      sun.position.set(camPos.x - 40, 90, camPos.z - 30);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      for (const t of disposables) t.dispose();
      for (const d of disposers) d();
      rain.dispose();
      scene.fog = null;
      scene.background = null;
    },
  };
}
