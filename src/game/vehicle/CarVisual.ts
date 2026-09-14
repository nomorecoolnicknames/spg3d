import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CarSpec } from '../types';
import { getGLTF } from '../assets';
import { softSpriteTexture } from '../world/textures';

/**
 * Car built from the baked GLB (scripts/build-cars.sh):
 *   body_LODn     one skinned mesh per LOD, one atlas material; COLOR_0 = paint / head / brake mask + AO
 *   glass_LODn    one mesh per LOD
 *   LOD0 60k (hero, high tier) · LOD1 40k (player) · LOD2 12k (near AI) · LOD3 3k (far AI);
 *   <model>.glb carries LOD1–3, <model>-hd.glb LOD0–1 — a request for a missing LOD takes the nearest one
 *   bones wheel_FL/FR/RL/RR spin and steer the wheels
 * → 2 draw calls per car. Car space: +Z forward, +X left, ground at y = 0.
 */
export type CarLod = 0 | 1 | 2 | 3;

export interface CarVisualOptions {
  player: boolean;
  shadows: boolean;
  night: boolean;
  lod?: CarLod;
  /** use the 2048 atlas variant if it is loaded */
  hd?: boolean;
  /** clear-coat paint (MeshPhysicalMaterial) — high quality tier */
  physical?: boolean;
  /** opaque tinted glass instead of alpha-blended (cheaper, no sorting) */
  opaqueGlass?: boolean;
  /** neon under the car (player at night) */
  underglow?: string;
  /** light streaks behind the tail lights at speed (player, medium/high) */
  trails?: boolean;
}

export interface CarVisual {
  root: THREE.Group;
  lod: CarLod;
  setPaint(color: string): void;
  setBrake(on: boolean): void;
  setHeadlights(on: boolean): void;
  setNitro(on: boolean, t: number): void;
  setWheels(spin: number, steer: number): void;
  setLod(lod: CarLod): void;
  setGhost(): void;
  /**
   * World-space extras that must not inherit the car transform (tail-light streaks): add to the
   * scene next to root. Call tick() once per frame after root's transform is updated.
   */
  extras: THREE.Object3D[];
  tick(speedKmh: number): void;
  dispose(): void;
}

const TRAIL_N = 26;

/** two additive ribbons following the tail lights in world space */
function createTrails(halfWidth: number, rearZ: number, height: number) {
  const verts = TRAIL_N * 2 * 2;
  const pos = new Float32Array(verts * 3);
  const fade = new Float32Array(verts);
  const idx: number[] = [];
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < TRAIL_N; i++) {
      const base = (r * TRAIL_N + i) * 2;
      fade[base] = fade[base + 1] = 1 - i / (TRAIL_N - 1);
      if (i < TRAIL_N - 1) idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
  geo.setIndex(idx);
  const strength = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { strength, color: { value: new THREE.Color('#ff1a2a') } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: 'attribute float aFade; varying float vF; void main(){ vF = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float strength; uniform vec3 color; varying float vF; void main(){ gl_FragColor = vec4(color * strength * vF * vF, 1.0); }',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'car:trails';
  const hist = [new Float32Array(TRAIL_N * 3), new Float32Array(TRAIL_N * 3)];
  let primed = false;
  const tmp = new THREE.Vector3();
  const up = new THREE.Vector3();
  return {
    mesh,
    tick(root: THREE.Object3D, speedKmh: number) {
      strength.value += (THREE.MathUtils.clamp((speedKmh - 90) / 90, 0, 1) * 0.9 - strength.value) * 0.1;
      mesh.visible = strength.value > 0.01;
      up.set(0, 1, 0).transformDirection(root.matrixWorld).multiplyScalar(0.05);
      for (let r = 0; r < 2; r++) {
        tmp.set(r ? halfWidth : -halfWidth, height, rearZ).applyMatrix4(root.matrixWorld);
        const h = hist[r];
        if (!primed) for (let i = 0; i < TRAIL_N; i++) h.set([tmp.x, tmp.y, tmp.z], i * 3);
        // shift once the head moved far enough, keep the head glued to the lamp
        if ((h[0] - tmp.x) ** 2 + (h[2] - tmp.z) ** 2 > 0.36) h.copyWithin(3, 0, (TRAIL_N - 1) * 3);
        h[0] = tmp.x;
        h[1] = tmp.y;
        h[2] = tmp.z;
        for (let i = 0; i < TRAIL_N; i++) {
          const o = (r * TRAIL_N + i) * 2 * 3;
          pos[o] = h[i * 3] - up.x;
          pos[o + 1] = h[i * 3 + 1] - up.y;
          pos[o + 2] = h[i * 3 + 2] - up.z;
          pos[o + 3] = h[i * 3] + up.x;
          pos[o + 4] = h[i * 3 + 1] + up.y;
          pos[o + 5] = h[i * 3 + 2] + up.z;
        }
      }
      primed = true;
      posAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

let flameTex: THREE.Texture | null = null;
let beamTex: THREE.Texture | null = null;

function headlightBeamTexture(): THREE.Texture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  // cone widening away from the car (texture v=1 at the bumper)
  const g = ctx.createRadialGradient(64, 250, 4, 64, 150, 150);
  g.addColorStop(0, 'rgba(255,248,230,0.95)');
  g.addColorStop(0.45, 'rgba(255,240,210,0.45)');
  g.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(52, 256);
  ctx.lineTo(76, 256);
  ctx.lineTo(128, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  beamTex = new THREE.CanvasTexture(c);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  return beamTex;
}

interface BodyUniforms {
  spgPaint: { value: THREE.Color };
  spgHead: { value: number };
  spgBrake: { value: number };
}

function patchBodyMaterial(mat: THREE.MeshStandardMaterial, u: BodyUniforms, physical: boolean): void {
  mat.vertexColors = false; // COLOR_0 is a mask, not a colour — read it ourselves
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.spgPaint = u.spgPaint;
    sh.uniforms.spgHead = u.spgHead;
    sh.uniforms.spgBrake = u.spgBrake;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying vec4 vSpgMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSpgMask = color;');
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 spgPaint;\nuniform float spgHead;\nuniform float spgBrake;\nvarying vec4 vSpgMask;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n\tdiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * spgPaint, vSpgMask.r);\n\tdiffuseColor.rgb *= mix(1.0, vSpgMask.a, 0.45);',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = mix(roughnessFactor, 0.3, vSpgMask.r);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor = mix(metalnessFactor, 0.45, vSpgMask.r);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * (vSpgMask.g * spgHead + vSpgMask.b * spgBrake);')
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n\treflectedLight.indirectDiffuse *= vSpgMask.a;\n\treflectedLight.indirectSpecular *= mix(1.0, vSpgMask.a, 0.7);',
      );
    if (physical) fs = fs.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n\tmaterial.clearcoat *= vSpgMask.r;');
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => (physical ? 'spg-car-physical' : 'spg-car');
  mat.needsUpdate = true;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

export function createCarVisual(spec: CarSpec, color: string, opts: CarVisualOptions): CarVisual {
  const root = new THREE.Group();
  root.name = `car:${spec.id}`;
  const gltf = (opts.hd && getGLTF(`${spec.model}-hd`)) || getGLTF(spec.model);
  const disposables: { dispose(): void }[] = [];
  const uniforms: BodyUniforms = { spgPaint: { value: new THREE.Color(color) }, spgHead: { value: opts.night ? 2.2 : 0.15 }, spgBrake: { value: 0.35 } };

  if (!gltf) {
    const geo = new THREE.BoxGeometry(spec.length * 0.42, 1.1, spec.length);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.4 });
    const box = new THREE.Mesh(geo, mat);
    box.position.y = 0.7;
    root.add(box);
    return {
      root,
      lod: 0,
      setPaint: (c) => mat.color.set(c),
      setBrake: () => {},
      setHeadlights: () => {},
      setNitro: () => {},
      setWheels: () => {},
      setLod: () => {},
      setGhost: () => {},
      extras: [],
      tick: () => {},
      dispose: () => {
        geo.dispose();
        mat.dispose();
      },
    };
  }

  const model = skeletonClone(gltf.scene);
  root.add(model);
  root.updateMatrixWorld(true);

  const bodies: THREE.Mesh[] = [];
  const glasses: THREE.Mesh[] = [];
  let bodyMat: THREE.MeshStandardMaterial | null = null;
  let glassMat: THREE.MeshStandardMaterial | null = null;
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const lod = Number(/_LOD(\d)/.exec(o.name)?.[1] ?? 0);
    o.userData.lod = lod;
    o.castShadow = opts.shadows && lod <= 2;
    o.receiveShadow = false;
    if (o.name.startsWith('body')) {
      if (!bodyMat) {
        const src = o.material as THREE.MeshStandardMaterial;
        bodyMat = opts.physical
          ? new THREE.MeshPhysicalMaterial({ map: src.map, metalnessMap: src.metalnessMap, roughnessMap: src.roughnessMap, metalness: 1, roughness: 1, alphaTest: src.alphaTest, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 })
          : new THREE.MeshStandardMaterial({ map: src.map, metalnessMap: src.metalnessMap, roughnessMap: src.roughnessMap, metalness: 1, roughness: 1, alphaTest: src.alphaTest, side: THREE.DoubleSide, envMapIntensity: 1.0 });
        patchBodyMaterial(bodyMat, uniforms, !!opts.physical);
        disposables.push(bodyMat);
      }
      o.material = bodyMat;
      bodies.push(o);
    } else if (o.name.startsWith('glass')) {
      if (!glassMat) {
        // one tint for every car: source glass colours average in indicator/tail lenses
        glassMat = new THREE.MeshStandardMaterial({
          color: '#1b2228',
          roughness: 0.04,
          metalness: opts.opaqueGlass ? 0.7 : 0.2,
          transparent: !opts.opaqueGlass,
          opacity: opts.opaqueGlass ? 1 : 0.5,
          depthWrite: !!opts.opaqueGlass,
          envMapIntensity: 1.4,
          side: THREE.DoubleSide,
        });
        disposables.push(glassMat);
      }
      o.material = glassMat;
      o.castShadow = false;
      glasses.push(o);
    }
  });

  // wheel bones: rotation expressed in car space, converted into each bone's parent space
  interface Wheel {
    bone: THREE.Bone;
    rest: THREE.Quaternion;
    parentInCar: THREE.Quaternion;
    parentInCarInv: THREE.Quaternion;
    front: boolean;
  }
  const wheels: Wheel[] = [];
  const rootInv = new THREE.Quaternion();
  root.getWorldQuaternion(rootInv).invert();
  for (const name of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
    const bones: THREE.Bone[] = [];
    model.traverse((o) => {
      if (o instanceof THREE.Bone && o.name === name) bones.push(o);
    });
    for (const bone of bones) {
      const pq = new THREE.Quaternion();
      bone.parent!.getWorldQuaternion(pq);
      const parentInCar = rootInv.clone().multiply(pq);
      wheels.push({ bone, rest: bone.quaternion.clone(), parentInCar, parentInCarInv: parentInCar.clone().invert(), front: name.includes('F') });
    }
  }

  // nitro flames
  if (!flameTex) flameTex = softSpriteTexture(1, 0);
  const flameMat = new THREE.SpriteMaterial({ map: flameTex, color: '#66ccff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  disposables.push(flameMat);
  const flames: THREE.Sprite[] = [];
  for (const sx of [-0.32, 0.32]) {
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Sprite(flameMat);
      sp.position.set(sx, 0.34, -spec.length / 2 - 0.15 - k * 0.3);
      sp.scale.setScalar(0.5 - k * 0.1);
      sp.visible = false;
      root.add(sp);
      flames.push(sp);
    }
  }
  let nitroOn = false;

  // headlight beam on the road (player at night) — replaces two per-pixel SpotLights
  let beam: THREE.Mesh | null = null;
  if (opts.player && opts.night) {
    const geo = new THREE.PlaneGeometry(7, 22);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: headlightBeamTexture(), color: '#ffe2b8', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    beam = new THREE.Mesh(geo, mat);
    beam.position.set(0, 0.06, spec.length / 2 + 10.5);
    beam.renderOrder = 3;
    root.add(beam);
    disposables.push(geo, mat);
  }

  // neon underglow: a soft additive rectangle on the road under the car
  if (opts.underglow) {
    const w = 2.6, l = spec.length + 1.2;
    const geo = new THREE.PlaneGeometry(w, l);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: flameTex ?? (flameTex = softSpriteTexture(1, 0)), color: opts.underglow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const glow = new THREE.Mesh(geo, mat);
    glow.position.y = 0.05;
    glow.renderOrder = 3;
    root.add(glow);
    disposables.push(geo, mat);
  }
  const trails = opts.trails ? createTrails(spec.length * 0.19, -spec.length / 2 + 0.1, 0.78) : null;
  if (trails) disposables.push(trails);

  const qSpin = new THREE.Quaternion();
  const qSteer = new THREE.Quaternion();
  const qCar = new THREE.Quaternion();
  const available = [...new Set(bodies.map((m) => m.userData.lod as number))].sort((a, b) => a - b);
  const resolve = (l: CarLod): CarLod => (available.find((a) => a >= l) ?? available[available.length - 1] ?? l) as CarLod;
  let currentLod: CarLod = resolve(opts.lod ?? 1);

  const vis: CarVisual = {
    root,
    get lod() {
      return currentLod;
    },
    setPaint(c) {
      uniforms.spgPaint.value.set(c);
    },
    setBrake(on) {
      uniforms.spgBrake.value = on ? 5 : 0.35;
    },
    setHeadlights(on) {
      uniforms.spgHead.value = on ? 2.2 : 0.15;
      if (beam) beam.visible = on;
    },
    setNitro(on, t) {
      if (on !== nitroOn) {
        nitroOn = on;
        for (const f of flames) f.visible = on;
      }
      if (on) {
        flames.forEach((f, i) => {
          const k = i % 3;
          f.scale.setScalar((0.55 - k * 0.12) * (0.85 + 0.3 * Math.sin(t * 60 + i * 1.7)));
        });
      }
    },
    setWheels(spin, steer) {
      qSpin.setFromAxisAngle(X, spin);
      qSteer.setFromAxisAngle(Y, steer);
      for (const w of wheels) {
        if (w.front) qCar.copy(qSteer).multiply(qSpin);
        else qCar.copy(qSpin);
        w.bone.quaternion.copy(w.parentInCarInv).multiply(qCar).multiply(w.parentInCar).multiply(w.rest);
      }
    },
    setLod(request) {
      const lod = resolve(request);
      if (lod === currentLod) return;
      currentLod = lod;
      for (const m of bodies) m.visible = m.userData.lod === lod;
      for (const m of glasses) m.visible = m.userData.lod === lod;
    },
    setGhost() {
      if (bodyMat) {
        bodyMat.alphaTest = 0;
        bodyMat.transparent = true;
        bodyMat.opacity = 0.35;
        bodyMat.depthWrite = false;
        bodyMat.needsUpdate = true;
      }
      for (const m of glasses) m.visible = false;
      for (const m of bodies) m.castShadow = false;
    },
    extras: trails ? [trails.mesh] : [],
    tick(speedKmh) {
      trails?.tick(root, speedKmh);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
  for (const m of bodies) m.visible = m.userData.lod === currentLod;
  for (const m of glasses) m.visible = m.userData.lod === currentLod;
  vis.setWheels(0, 0);
  if (beam) beam.visible = opts.night;
  return vis;
}
