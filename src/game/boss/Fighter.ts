import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getGLTF } from '../assets';

/**
 * Characters of the boss fight.
 *   fighter — the Funko-style Deadpool of the first version (scripts/blender/deadpool.py): rigid vinyl parts
 *             swung procedurally (a toy figure runs like one), bazooka on the right shoulder
 *   zombie  — Quaternius «Zombie» (CC0) with its own Walk / Run / Punch / Death clips
 * Both fall back to the Mixamo Xbot when their model is missing.
 */
type Clip = 'idle' | 'run' | 'walk' | 'attack' | 'death';

const ZOMBIE_CLIPS: Record<Clip, string> = { idle: 'Idle', run: 'Run', walk: 'Walk', attack: 'Punch', death: 'Death' };

interface Parts {
  torso: THREE.Object3D;
  head: THREE.Object3D | null;
  armL: THREE.Object3D | null;
  armR: THREE.Object3D | null;
  legL: THREE.Object3D | null;
  legR: THREE.Object3D | null;
}

export class Humanoid {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private clipNames: Partial<Record<Clip, string>> = {};
  private current = '';
  private materials: THREE.Material[] = [];
  readonly bazooka: THREE.Group | null = null;
  private muzzleObj: THREE.Object3D | null = null;
  private recoil = 0;
  private bazookaRestZ = 0;
  /** procedural toy animation (Deadpool) */
  private parts: Parts | null = null;
  private pose: Clip = 'idle';
  private phase = 0;
  private timeScale = 1;
  private t = 0;
  private torsoY = 0;

  constructor(kind: 'fighter' | 'zombie', shadows: boolean) {
    const deadpool = kind === 'fighter' ? getGLTF('deadpool') : undefined;
    const zombie = kind === 'zombie' ? getGLTF('zombie') : undefined;
    if (deadpool) {
      const m = deadpool.scene.clone(true);
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const src = o.material as THREE.MeshStandardMaterial;
          const mat = src.clone();
          mat.vertexColors = true;
          // the arena is lit hard (red sign lights, bloom): a darker vinyl keeps the suit red, not pink
          mat.color.setScalar(0.55);
          mat.roughness = 0.45;
          mat.metalness = 0;
          mat.envMapIntensity = 0.5;
          this.materials.push(mat);
          o.material = mat;
          o.castShadow = shadows;
          o.frustumCulled = false;
        }
      });
      const get = (n: string) => m.getObjectByName(n) ?? null;
      const torso = get('dp_torso');
      if (torso) {
        this.parts = { torso, head: get('dp_head'), armL: get('dp_arm_l'), armR: get('dp_arm_r'), legL: get('dp_leg_l'), legR: get('dp_leg_r') };
        this.torsoY = torso.position.y;
      }
      this.model = m;
      this.root.add(m);
      const baz = this.makeBazooka();
      // on the right shoulder (the figure faces +Z, its right is −X), under the big vinyl head
      baz.position.set(-0.56, 0.74, 0.08);
      baz.rotation.set(-0.04, 0.04, 0);
      this.bazookaRestZ = baz.position.z;
      (torso ?? m).add(baz);
      (this as { bazooka: THREE.Group | null }).bazooka = baz;
      return;
    }
    const gltf = zombie ?? getGLTF('Xbot');
    if (gltf) {
      const xbot = !zombie;
      // minions on the Xbot fallback use the simplified skin (same skeleton, clips from the full file)
      const m = skeletonClone((xbot && kind === 'zombie' && getGLTF('Xbot-lod')?.scene) || gltf.scene);
      if (xbot) {
        const body = new THREE.MeshStandardMaterial({ color: kind === 'fighter' ? '#1a1a1f' : '#4a7a3a', roughness: 0.55, metalness: kind === 'fighter' ? 0.55 : 0.1 });
        const suit = new THREE.MeshStandardMaterial({ color: kind === 'fighter' ? '#c41e3a' : '#2f4f2a', roughness: 0.4, metalness: 0.35 });
        this.materials.push(body, suit);
        m.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = /surface/i.test(o.name) ? suit : body;
        });
      }
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = shadows;
          o.receiveShadow = false;
          o.frustumCulled = false;
        }
      });
      // the Quaternius zombie is a 1.2 m cartoon: scale it to a grown-up
      if (zombie) m.scale.setScalar(1.45);
      this.model = m;
      this.root.add(m);
      this.mixer = new THREE.AnimationMixer(m);
      for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
      this.clipNames = zombie ? ZOMBIE_CLIPS : { idle: 'idle', run: 'run', walk: 'walk', attack: 'walk', death: 'idle' };
      if (zombie) {
        const once = this.actions.get(ZOMBIE_CLIPS.death);
        once?.setLoop(THREE.LoopOnce, 1);
        if (once) once.clampWhenFinished = true;
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
          this.bazookaRestZ = 8;
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

  play(name: Clip | string, fade = 0.15): void {
    if (this.parts) {
      this.pose = name as Clip;
      return;
    }
    const clip = this.clipNames[name as Clip] ?? name;
    if (this.current === clip || !this.mixer) return;
    const next = this.actions.get(clip) ?? this.actions.values().next().value;
    if (!next) return;
    const prev = this.actions.get(this.current);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.current = clip;
  }

  setTimeScale(k: number): void {
    this.timeScale = k;
    const a = this.actions.get(this.current);
    if (a) a.setEffectiveTimeScale(k);
  }

  kickRecoil(): void {
    this.recoil = 1;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
    this.t += dt;
    const p = this.parts;
    if (p) {
      // a vinyl toy running: legs and the free arm swing from their joints, the body bobs and leans in
      const running = this.pose === 'run' || this.pose === 'walk';
      this.phase += dt * (running ? 10.5 * this.timeScale : 0);
      const swing = running ? Math.sin(this.phase) : 0;
      const idle = running ? 0 : Math.sin(this.t * 2.2);
      const k = 1 - Math.exp(-dt * 12);
      const lerp = (o: THREE.Object3D | null, x: number, z = 0) => {
        if (!o) return;
        o.rotation.x += (x - o.rotation.x) * k;
        o.rotation.z += (z - o.rotation.z) * k;
      };
      lerp(p.legL, swing * 0.75);
      lerp(p.legR, -swing * 0.75);
      lerp(p.armL, -swing * 0.65 + idle * 0.05, 0.08);
      // the right arm holds the launcher up on the shoulder
      lerp(p.armR, -1.35 + swing * 0.08, -0.55);
      lerp(p.torso, running ? 0.14 : 0, swing * 0.05);
      lerp(p.head, running ? -0.1 : idle * 0.03, -swing * 0.04);
      p.torso.position.y = this.torsoY + (running ? Math.abs(Math.sin(this.phase)) * 0.05 : (idle + 1) * 0.006);
    }
    if (this.bazooka && this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 6);
      const kick = Math.sin(this.recoil * Math.PI);
      this.bazooka.position.z = this.bazookaRestZ - kick * (this.parts ? 0.08 : 4);
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    for (const m of this.materials) m.dispose();
    this.root.traverse((o) => {
      // shared geometries of cached models stay; only the bazooka pieces are ours
      if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh) && this.bazooka && isInside(o, this.bazooka)) o.geometry.dispose();
    });
  }
}

function isInside(o: THREE.Object3D, parent: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === parent) return true;
  return false;
}
