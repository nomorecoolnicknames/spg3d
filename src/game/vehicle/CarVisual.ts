import * as THREE from 'three';
import type { CarSpec } from '../types';
import { getGLTF } from '../assets';
import { softSpriteTexture } from '../world/textures';

/**
 * Visual car built from the optimized GLB: auto-fit to spec.length, +Z forward,
 * paint applied to detected body materials, wheels found by name or geometry and
 * re-pivoted so they can spin/steer, brake lights, headlights (player), nitro flames.
 */
export interface CarVisual {
  root: THREE.Group;
  /** spin pivots (rotate .x) */
  wheels: THREE.Object3D[];
  /** steer pivots (rotate .y) — front wheels only */
  steer: THREE.Object3D[];
  wheelRadius: number;
  setPaint(color: string): void;
  setBrake(on: boolean): void;
  setHeadlights(on: boolean): void;
  setNitro(on: boolean, t: number): void;
  setReverse(on: boolean): void;
  dispose(): void;
}

const PAINT_EXCLUDE = /glass|window|tire|tyre|wheel|rubber|interior|chrome|light|badge|grille|carbon|mirror|plate|engine|seat|belt|brake|calliper|caliper|emis|nickel|black/i;
const BRAKE_RE = /red_glass|glassred|lightglass_red|light_red|brake|tail|rearlight|LightGlassNormal_OuterRed/i;
const HEAD_RE = /lightglassnormal_clear|light_clear|headlight|lightd|lightemissive|^lighta|lighta_material/i;

let flameTex: THREE.Texture | null = null;

export function createCarVisual(spec: CarSpec, color: string, opts: { player: boolean; shadows: boolean; night: boolean }): CarVisual {
  const root = new THREE.Group();
  const gltf = getGLTF(spec.model);
  const disposables: (THREE.Material | THREE.BufferGeometry | THREE.Texture)[] = [];
  const paintMats: THREE.MeshStandardMaterial[] = [];
  const brakeMats: THREE.MeshStandardMaterial[] = [];
  const headMats: THREE.MeshStandardMaterial[] = [];
  const wheels: THREE.Object3D[] = [];
  const steer: THREE.Object3D[] = [];
  let wheelRadius = 0.34;

  if (gltf) {
    const model = gltf.scene.clone(true);
    // clone materials so paint/brake state is per car
    const matMap = new Map<THREE.Material, THREE.Material>();
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cloned = mats.map((m) => {
          const existing = matMap.get(m);
          if (existing) return existing;
          const c = m.clone();
          matMap.set(m, c);
          disposables.push(c);
          return c;
        });
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
        o.castShadow = opts.shadows;
        o.receiveShadow = false;
        o.frustumCulled = true;
      }
    });

    // --- fit: longest horizontal axis = forward, scale to spec.length, ground at y=0 ---
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    let size = box.getSize(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(model);
    if (size.x > size.z) model.rotation.y = Math.PI / 2;
    model.rotation.y += spec.rotateY ?? 0;
    holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(holder);
    size = box.getSize(new THREE.Vector3());
    const sc = spec.length / Math.max(0.001, size.z);
    holder.scale.setScalar(sc);
    holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(holder);
    const center = box.getCenter(new THREE.Vector3());
    holder.position.set(-center.x, -box.min.y + (spec.offsetY ?? 0), -center.z);
    holder.updateMatrixWorld(true);
    root.add(holder);
    size = box.getSize(new THREE.Vector3());

    // --- materials: paint / brake / head detection ---
    const areaByMat = new Map<THREE.MeshStandardMaterial, number>();
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial)) continue;
        const name = (m.name || o.name || '').toLowerCase();
        if (BRAKE_RE.test(name)) brakeMats.push(m);
        else if (HEAD_RE.test(name)) headMats.push(m);
        const explicit = spec.paintMaterials.some((p) => name.includes(p.toLowerCase()));
        if (explicit) {
          if (!paintMats.includes(m)) paintMats.push(m);
        } else if (spec.paintMaterials.length === 0 && !PAINT_EXCLUDE.test(name)) {
          areaByMat.set(m, (areaByMat.get(m) ?? 0) + tris);
        }
      }
    });
    if (paintMats.length === 0) {
      // heuristic: the two largest non-excluded, non-dark, non-transparent materials
      const ranked = [...areaByMat.entries()]
        .filter(([m]) => !m.transparent && m.opacity > 0.9 && m.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.08)
        .sort((a, b) => b[1] - a[1]);
      const top = ranked[0]?.[1] ?? 0;
      for (const [m, area] of ranked) if (area > top * 0.35 && paintMats.length < 3) paintMats.push(m);
    }
    for (const m of paintMats) {
      m.metalness = 0.45;
      m.roughness = 0.3;
      m.envMapIntensity = 0.9;
    }
    for (const m of brakeMats) {
      m.emissive = new THREE.Color('#ff1a1a');
      m.emissiveIntensity = 0.6;
      m.toneMapped = true;
    }
    for (const m of headMats) {
      m.emissive = new THREE.Color('#eaf4ff');
      m.emissiveIntensity = opts.night ? 1.6 : 0.2;
    }

    // --- wheels: the optimizer tags each wheel's materials as `spgwheel_<i>` ---
    const candidates: THREE.Object3D[] = [];
    const byWheel = new Map<string, THREE.Object3D[]>();
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const wm = mats.find((m) => m.name.startsWith('spgwheel_'));
      if (wm) {
        const arr = byWheel.get(wm.name) ?? [];
        arr.push(o);
        byWheel.set(wm.name, arr);
      }
    });
    for (const arr of byWheel.values()) candidates.push(...arr);
    // group candidates into 4 corners by local center
    const corners = new Map<string, { objs: THREE.Object3D[]; c: THREE.Vector3; r: number }>();
    holder.updateMatrixWorld(true);
    for (const o of candidates) {
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty()) continue;
      const c = b.getCenter(new THREE.Vector3());
      const s = b.getSize(new THREE.Vector3());
      root.worldToLocal(c);
      const key = `${c.x > 0 ? 'L' : 'R'}${c.z > 0 ? 'F' : 'B'}`;
      const e = corners.get(key);
      if (e) {
        e.objs.push(o);
        e.c.lerp(c, 0.5);
      } else corners.set(key, { objs: [o], c, r: Math.max(s.y, s.z) / 2 });
    }
    if (corners.size === 4) {
      for (const [key, e] of corners) {
        wheelRadius = e.r;
        const steerPivot = new THREE.Group();
        const spinPivot = new THREE.Group();
        steerPivot.position.copy(e.c);
        steerPivot.add(spinPivot);
        root.add(steerPivot);
        for (const o of e.objs) spinPivot.attach(o);
        wheels.push(spinPivot);
        if (key.endsWith('F')) steer.push(steerPivot);
      }
    }

    // --- nitro flames + exhaust glow ---
    if (!flameTex) flameTex = softSpriteTexture(1, 0);
    const flameMat = new THREE.SpriteMaterial({ map: flameTex, color: '#66ccff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95 });
    disposables.push(flameMat);
    const flames: THREE.Sprite[] = [];
    for (const sx of [-0.3, 0.3]) {
      for (let k = 0; k < 4; k++) {
        const sp = new THREE.Sprite(flameMat);
        sp.position.set(sx, 0.32, -spec.length / 2 - 0.2 - k * 0.32);
        sp.scale.setScalar(0.5 - k * 0.09);
        sp.visible = false;
        root.add(sp);
        flames.push(sp);
      }
    }
    let nitroOn = false;

    // --- headlights (spotlights, player only) ---
    const lights: THREE.SpotLight[] = [];
    if (opts.player && opts.night) {
      for (const sx of [-0.6, 0.6]) {
        const spot = new THREE.SpotLight('#dfefff', 40, 70, 0.42, 0.55, 1.4);
        spot.position.set(sx, 0.75, spec.length / 2 - 0.3);
        const tgt = new THREE.Object3D();
        tgt.position.set(sx * 1.6, -0.3, spec.length / 2 + 30);
        root.add(tgt);
        spot.target = tgt;
        spot.castShadow = false;
        root.add(spot);
        lights.push(spot);
      }
    }
    // reverse light glow (small)
    const revMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.04), revMat);
    rev.position.set(0, 0.7, -spec.length / 2 - 0.02);
    rev.visible = false;
    root.add(rev);
    disposables.push(revMat, rev.geometry);

    const vis: CarVisual = {
      root,
      wheels,
      steer,
      wheelRadius,
      setPaint(c) {
        for (const m of paintMats) m.color.set(c);
      },
      setBrake(on) {
        for (const m of brakeMats) m.emissiveIntensity = on ? 4.0 : 0.6;
      },
      setHeadlights(on) {
        for (const l of lights) l.visible = on;
        for (const m of headMats) m.emissiveIntensity = on ? 1.6 : 0.2;
      },
      setNitro(on, t) {
        if (on !== nitroOn) {
          nitroOn = on;
          for (const f of flames) f.visible = on;
        }
        if (on) {
          flames.forEach((f, i) => {
            const k = i % 4;
            const j = 0.85 + 0.35 * Math.sin(t * 60 + i * 1.7);
            f.scale.setScalar((0.55 - k * 0.1) * j);
            f.material.opacity = 0.9 - k * 0.18;
          });
        }
      },
      setReverse(on) {
        rev.visible = on;
      },
      dispose() {
        for (const d of disposables) d.dispose();
        for (const l of lights) l.dispose();
      },
    };
    vis.setPaint(color);
    return vis;
  }

  // no model loaded: simple placeholder box so the game never shows nothing
  const geo = new THREE.BoxGeometry(spec.length * 0.42, 0.9, spec.length);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.6;
  root.add(mesh);
  disposables.push(geo, mat);
  return {
    root,
    wheels,
    steer,
    wheelRadius,
    setPaint(c) {
      mat.color.set(c);
    },
    setBrake() {},
    setHeadlights() {},
    setNitro() {},
    setReverse() {},
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
