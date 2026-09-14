import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getGLTF } from '../assets';

/**
 * Humanoid built from the Mixamo Xbot GLB (idle / run / walk clips). Used for the
 * player fighter (red/black suit + bazooka) and the green minions.
 */
let eyesGeo: THREE.BufferGeometry | null = null;
function zombieEyes(): THREE.BufferGeometry {
  if (!eyesGeo) {
    const l = new THREE.SphereGeometry(0.035, 6, 6).translate(-0.045, 0.1, 0.11);
    const r = new THREE.SphereGeometry(0.035, 6, 6).translate(0.045, 0.1, 0.11);
    eyesGeo = mergeGeometries([l, r])!;
    l.dispose();
    r.dispose();
  }
  return eyesGeo;
}

export class Humanoid {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  private materials: THREE.Material[] = [];
  readonly bazooka: THREE.Group | null = null;
  private muzzleObj: THREE.Object3D | null = null;
  private recoil = 0;

  constructor(kind: 'fighter' | 'zombie', shadows: boolean) {
    const gltf = getGLTF('Xbot');
    if (gltf) {
      // minions use the simplified skin (same skeleton, clips from the full file)
      const m = skeletonClone((kind === 'zombie' && getGLTF('Xbot-lod')?.scene) || gltf.scene);
      const body = new THREE.MeshStandardMaterial({ color: kind === 'fighter' ? '#1a1a1f' : '#4a7a3a', roughness: 0.55, metalness: kind === 'fighter' ? 0.55 : 0.1 });
      const suit = new THREE.MeshStandardMaterial({ color: kind === 'fighter' ? '#c41e3a' : '#2f4f2a', roughness: 0.4, metalness: 0.35 });
      this.materials.push(body, suit);
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          // Xbot has two meshes: "Beta_Joints" (dark) and "Beta_Surface" (light). Surface → suit colour.
          o.material = /surface/i.test(o.name) ? suit : body;
          o.castShadow = shadows;
          o.receiveShadow = false;
          o.frustumCulled = false;
        }
      });
      // minion eyes glow
      if (kind === 'zombie') {
        const eyeM = new THREE.MeshBasicMaterial({ color: '#ff2020', toneMapped: false });
        this.materials.push(eyeM);
        const head = m.getObjectByName('mixamorig:Head') ?? m.getObjectByName('mixamorigHead');
        if (head) head.add(new THREE.Mesh(zombieEyes(), eyeM)); // both eyes in one draw call
      }
      this.model = m;
      this.root.add(m);
      this.mixer = new THREE.AnimationMixer(m);
      for (const clip of gltf.animations) {
        const a = this.mixer.clipAction(clip);
        this.actions.set(clip.name, a);
      }
      this.play(kind === 'fighter' ? 'idle' : 'walk');
      if (kind === 'fighter') {
        const hand = m.getObjectByName('mixamorig:RightHand') ?? m.getObjectByName('mixamorigRightHand');
        const baz = this.makeBazooka();
        if (hand) {
          // hand bone space is in centimetres (Mixamo): scale down the launcher
          baz.scale.setScalar(140);
          baz.position.set(10, 4, 8);
          baz.rotation.set(-0.3, 1.45, 1.6);
          hand.add(baz);
        } else {
          baz.position.set(0.32, 1.25, 0.3);
          this.root.add(baz);
        }
        (this as { bazooka: THREE.Group | null }).bazooka = baz;
      }
    } else {
      // fallback capsule
      const g = new THREE.CapsuleGeometry(0.3, 1.1, 4, 8);
      const mat = new THREE.MeshStandardMaterial({ color: kind === 'fighter' ? '#c41e3a' : '#4a7a3a' });
      this.materials.push(mat);
      const me = new THREE.Mesh(g, mat);
      me.position.y = 0.9;
      this.model = me;
      this.root.add(me);
    }
  }

  private makeBazooka(): THREE.Group {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#23252b', metalness: 0.8, roughness: 0.35 });
    const olive = new THREE.MeshStandardMaterial({ color: '#3a3f2e', roughness: 0.7, metalness: 0.3 });
    const red = new THREE.MeshBasicMaterial({ color: '#ff3040', toneMapped: false });
    this.materials.push(dark, olive, red);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 1.1, 14), olive);
    tube.rotation.x = Math.PI / 2;
    const muzzleRing = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.14, 14), dark);
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.z = 0.55;
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 14), dark);
    rear.rotation.x = Math.PI / 2;
    rear.position.z = -0.55;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.05), dark);
    grip.position.set(0, -0.12, 0.05);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.05), dark);
    trigger.position.set(0, -0.11, -0.18);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.06), dark);
    sight.position.set(0, 0.1, 0.1);
    const sightDot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), red);
    sightDot.position.set(0, 0.14, 0.13);
    g.add(tube, muzzleRing, rear, grip, trigger, sight, sightDot);
    const muzzle = new THREE.Object3D();
    muzzle.position.z = 0.62;
    g.add(muzzle);
    this.muzzleObj = muzzle;
    return g;
  }

  /** world-space muzzle position (falls back to chest height) */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.muzzleObj) return this.muzzleObj.getWorldPosition(out);
    return this.root.getWorldPosition(out).add(new THREE.Vector3(0, 1.3, 0));
  }

  play(name: string, fade = 0.15): void {
    if (this.current === name || !this.mixer) return;
    const next = this.actions.get(name) ?? this.actions.values().next().value;
    if (!next) return;
    const prev = this.actions.get(this.current);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.current = name;
  }

  setTimeScale(k: number): void {
    const a = this.actions.get(this.current);
    if (a) a.setEffectiveTimeScale(k);
  }

  kickRecoil(): void {
    this.recoil = 1;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
    if (this.bazooka && this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 6);
      this.bazooka.position.z = 8 - Math.sin(this.recoil * Math.PI) * 4;
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    for (const m of this.materials) m.dispose();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh)) o.geometry.dispose();
    });
  }
}
