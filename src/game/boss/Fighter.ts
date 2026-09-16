import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getGLTF } from '../assets';

/**
 * Characters of the boss fight.
 *   fighter — «Deadpool MMD PORT FBX» (Izann2842_o, CC BY 4.0; scripts/blender/deadpool_mmd.py): a skinned model
 *             without clips, posed procedurally — rotations of the named humanoid bones layered on the bind
 *             pose, the right hand kept on the bazooka that rides on the right shoulder
 *   zombie  — Quaternius «Zombie» (CC0) with its own Walk / Run / Punch / Death clips
 * Both fall back to the Mixamo Xbot when their model is missing.
 */
type Clip = 'idle' | 'run' | 'walk' | 'attack' | 'death';

const ZOMBIE_CLIPS: Record<Clip, string> = { idle: 'Idle', run: 'Run', walk: 'Walk', attack: 'Punch', death: 'Death' };

/** Bones renamed by scripts/blender/deadpool_mmd.py, parents before children. */
const RIG = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder_l', 'shoulder_r', 'upperarm_l', 'upperarm_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r'] as const;
type RigName = (typeof RIG)[number];

/**
 * A posed bone. `rot` is this frame's rotation away from the bind pose, in model space and including everything
 * inherited from the posed ancestors: the bone ends up oriented as rot · bind. Bones between two posed ones
 * (the extra MMD spine and neck links, twist helpers, fingers) simply follow.
 */
interface Joint {
  bone: THREE.Bone;
  parent: Joint | null;
  /** local bind rotation */
  bind: THREE.Quaternion;
  /** bind rotation in model space and its inverse */
  model: THREE.Quaternion;
  modelInv: THREE.Quaternion;
  /** bind head in model space, and relative to the parent's head (for a root: the head itself) */
  head: THREE.Vector3;
  offset: THREE.Vector3;
  rot: THREE.Quaternion;
}

/** A finger segment (bind as for Joint) and the hand it belongs to; curled about the hand's axis relative to its parent. */
interface Knuckle {
  bone: THREE.Bone;
  bind: THREE.Quaternion;
  model: THREE.Quaternion;
  modelInv: THREE.Quaternion;
  thumb: boolean;
}

interface Hand {
  knuckles: Knuckle[];
  /** curl axes (model space, bind pose): fingers and thumb turn towards the palm */
  curl: THREE.Vector3;
  thumbCurl: THREE.Vector3;
}

/** Where the launcher rides at bind pose (model space: +Z forward, +X the character's left) and the hand holds. */
const MOUNT = new THREE.Vector3(-0.2, 1.64, 0.28);
const GRIP_R = new THREE.Vector3(-0.025, -0.17, -0.05);
const GRIP_L = new THREE.Vector3(0, -0.08, 0.3);
const POLE_R = new THREE.Vector3(-0.35, -1, -0.15).normalize();
const POLE_L = new THREE.Vector3(0.6, -1, -0.1).normalize();

const LEGS = [['l', 1], ['r', -1]] as const;
/** death, per leg: [thigh, knee] once the knees buckle, then lying on his back (the left knee stays up) */
const DEATH_LEGS = { l: [-0.3, 1.25, -0.65, 1.15], r: [-0.8, 0.85, -0.12, 0.25] } as const;
/** how far in front of the model origin the heels are once the knees buckle: the pivot of the fall */
const HEELS = 0.15;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

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
  /** procedural animation (Deadpool) */
  private rig: Record<RigName, Joint> | null = null;
  private hands: { l: Hand; r: Hand } | null = null;
  private pose: Clip = 'idle';
  private phase = 0;
  private timeScale = 1;
  private t = 0;
  private move = 0;
  private running = 1;
  private aim = 0;
  private dying = 0;
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v = [0, 1, 2].map(() => new THREE.Vector3());
  private readonly offs = new THREE.Vector3();
  private readonly ik = { sh: new THREE.Vector3(), to: new THREE.Vector3(), side: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), seg: new THREE.Vector3() };
  private readonly fk = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly foreBend = { l: new THREE.Vector3(), r: new THREE.Vector3() };

  constructor(kind: 'fighter' | 'zombie', shadows: boolean) {
    const deadpool = kind === 'fighter' ? getGLTF('deadpool') : undefined;
    const zombie = kind === 'zombie' ? getGLTF('zombie') : undefined;
    const m = deadpool ? skeletonClone(deadpool.scene) : null;
    const rig = m ? findRig(m) : null;
    if (m && rig) {
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mat = (o.material as THREE.MeshStandardMaterial).clone();
          // the yard's warm night environment turns the black leather khaki at full strength; a faint glow of
          // the suit's own texture keeps the red readable in the shadow side
          mat.emissiveMap = mat.map;
          mat.emissive.setScalar(0.05);
          mat.envMapIntensity = 0.5;
          this.materials.push(mat);
          o.material = mat;
          o.castShadow = shadows;
          o.receiveShadow = false;
          o.frustumCulled = false;
        }
      });
      this.rig = rig;
      this.hands = { l: findHand(m, rig.hand_l.bone), r: findHand(m, rig.hand_r.bone) };
      // elbow flexion axes: turn the forearm (bind direction) towards the front
      for (const s of ['l', 'r'] as const) this.foreBend[s].crossVectors(rig[`hand_${s}`].offset, Z).normalize();
      this.model = m;
      this.root.add(m);
      const baz = this.makeBazooka();
      m.add(baz);
      (this as { bazooka: THREE.Group | null }).bazooka = baz;
      this.update(0);
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
    if (this.rig) {
      if (name !== 'death') this.dying = 0;
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
    if (this.bazooka && this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 6);
      if (!this.rig) this.bazooka.position.z = this.bazookaRestZ - Math.sin(this.recoil * Math.PI) * 4;
    }
    if (this.rig) this.animate(dt, Math.sin(this.recoil * Math.PI));
  }

  /** Deadpool: idle / walk / run blend by weights, attack raises the launcher into both hands, death is a one-shot fall. */
  private animate(dt: number, kick: number): void {
    const r = this.rig!;
    const [a, b, c] = this.v;
    const ease = 1 - Math.exp(-dt * 8);
    const moving = this.pose === 'run' || this.pose === 'walk';
    this.move += ((moving ? 1 : 0) - this.move) * ease;
    this.running += ((this.pose === 'walk' ? 0 : 1) - this.running) * ease;
    this.aim += ((this.pose === 'attack' ? 1 : 0) - this.aim) * ease;
    if (this.pose === 'death') this.dying = Math.min(1, this.dying + dt / 1.4);
    if (moving) this.phase += dt * (6.5 + 4 * this.running) * this.timeScale;
    const t = this.t;
    const g = this.move * (0.55 + 0.45 * this.running);
    const still = 1 - this.move;
    const s = Math.sin(this.phase);
    const cs = Math.cos(this.phase);
    const breathe = Math.sin(t * 1.8) * still;
    const shift = Math.sin(t * 0.9) * still;
    // death: the knees buckle, then he goes over backwards
    const buckle = smooth(0, 0.3, this.dying);
    const fall = smooth(0.15, 1, this.dying) ** 1.6;

    // ---- pelvis and legs
    const hips = r.hips.rot.setFromAxisAngle(Y, -0.16 * g * s);
    hips.multiply(this.q.setFromAxisAngle(Z, 0.03 * shift + 0.04 * g * cs));
    const stance = 0.05 * still + 0.07 * this.aim;
    for (const [side, sign] of LEGS) {
      const swing = sign * s;
      const forward = sign * cs;
      const [bt, bk, lt, lk] = DEATH_LEGS[side];
      const thigh = -0.72 * g * swing - 0.1 * g - 0.12 * this.aim + buckle * (bt + (lt - bt) * fall);
      const knee = 0.1 + 0.08 * this.aim + g * (0.2 + 1.15 * Math.max(0, forward) ** 1.5) + buckle * (bk + (lk - bk) * fall);
      const splay = sign * (stance + 0.02 * shift);
      r[`thigh_${side}`].rot.copy(hips).multiply(this.q.setFromAxisAngle(X, thigh)).multiply(this.q2.setFromAxisAngle(Z, splay));
      r[`shin_${side}`].rot.copy(r[`thigh_${side}`].rot).multiply(this.q.setFromAxisAngle(X, knee));
      // keep the sole near level, letting the toes push off in the run
      r[`foot_${side}`].rot.copy(r[`shin_${side}`].rot).multiply(this.q.setFromAxisAngle(X, -(thigh + knee) * (1 - 0.45 * g) + 0.25 * g * Math.max(0, -forward))).multiply(this.q2.setFromAxisAngle(Z, -splay));
    }

    // ---- torso: lean into the run, counter-rotate the shoulders, breathe, recoil
    const lean = 0.03 + g * (0.1 + 0.08 * this.running) + 0.1 * this.aim + 0.3 * buckle - 0.45 * fall;
    const spine = r.spine.rot.setFromAxisAngle(Y, 0.12 * g * s - 0.2 * this.aim);
    spine.multiply(this.q.setFromAxisAngle(X, lean - 0.07 * kick)).multiply(this.q2.setFromAxisAngle(Z, -0.03 * shift));
    r.chest.rot.copy(spine).multiply(this.q.setFromAxisAngle(X, 0.015 * breathe - 0.05 * kick));
    r.neck.rot.copy(r.chest.rot).multiply(this.q.setFromAxisAngle(X, -0.45 * lean + 0.35 * fall));
    const look = Math.sin(t * 0.37) * 0.14 * still * (1 - this.aim);
    r.head.rot.copy(r.neck.rot).multiply(this.q.setFromAxisAngle(Y, look + 0.18 * this.aim)).multiply(this.q2.setFromAxisAngle(X, -0.25 * lean + 0.25 * buckle));
    r.shoulder_l.rot.copy(r.chest.rot);
    r.shoulder_r.rot.copy(r.chest.rot).multiply(this.q.setFromAxisAngle(Z, -0.06));

    // ---- the launcher rides on the right shoulder (chest frame), kicks back along its tube, and in the fall
    // tips over to lie along the body
    const baz = this.bazooka!;
    this.jointPos(r.chest, a);
    baz.position.copy(b.subVectors(MOUNT, r.chest.head).applyQuaternion(r.chest.rot)).add(a);
    baz.quaternion.copy(r.chest.rot).multiply(this.q.setFromAxisAngle(Y, 0.2 * this.aim)).multiply(this.q2.setFromAxisAngle(X, 0.04 - 0.14 * kick - 0.06 * this.aim + 1.5 * fall));
    baz.position.add(c.set(0, 0, -0.1 * kick).applyQuaternion(baz.quaternion));

    // ---- free left arm: hangs at the side, swings against the legs, flings out in the fall
    const armSwing = 0.62 * g * s + 0.03 * Math.sin(t * 1.1) * still;
    r.upperarm_l.rot.copy(r.shoulder_l.rot).multiply(this.q.setFromAxisAngle(X, armSwing)).multiply(this.q2.setFromAxisAngle(Z, -0.72 + 0.9 * fall));
    r.forearm_l.rot.copy(r.upperarm_l.rot).multiply(this.q.setFromAxisAngle(this.foreBend.l, 0.25 + g * (0.6 + 0.6 * this.running) - 0.2 * fall));
    r.hand_l.rot.copy(r.forearm_l.rot);
    if (this.aim > 0.01) {
      // attack: the left hand comes up under the front of the tube
      const [upper, fore] = this.fk;
      upper.copy(r.upperarm_l.rot);
      fore.copy(r.forearm_l.rot);
      this.reach(r.upperarm_l, r.forearm_l, r.hand_l, b.copy(GRIP_L).applyQuaternion(baz.quaternion).add(baz.position), POLE_L);
      r.upperarm_l.rot.copy(upper.slerp(r.upperarm_l.rot, this.aim));
      r.forearm_l.rot.copy(fore.slerp(r.forearm_l.rot, this.aim));
      r.hand_l.rot.copy(r.forearm_l.rot);
    }
    // ---- right hand on the grip
    this.reach(r.upperarm_r, r.forearm_r, r.hand_r, b.copy(GRIP_R).applyQuaternion(baz.quaternion).add(baz.position), POLE_R);
    this.fist(this.hands!.r, 1.25);
    this.fist(this.hands!.l, 0.35 + 0.9 * this.aim - 0.3 * fall);

    for (const name of RIG) {
      const j = r[name];
      const local = j.parent ? this.q.copy(j.parent.rot).invert().multiply(j.rot) : this.q.copy(j.rot);
      j.bone.quaternion.copy(j.bind).multiply(this.q2.copy(j.modelInv)).multiply(local).multiply(j.model);
    }
    // whole body: run bob, idle weight shift; the fall tips him backwards about his heels onto his back
    const m = this.model;
    const tip = -1.52 * fall;
    m.rotation.x = tip;
    m.position.set(0.012 * shift, -0.01 * still + g * (0.012 - 0.04 * Math.abs(cs)) - 0.2 * buckle * (1 - fall) + HEELS * Math.sin(tip) + 0.28 * fall, HEELS * (1 - Math.cos(tip)));
  }

  /** Bends every finger segment by `angle` (the thumb by half) towards the palm. */
  private fist(hand: Hand, angle: number): void {
    for (const k of hand.knuckles) {
      this.q.setFromAxisAngle(k.thumb ? hand.thumbCurl : hand.curl, k.thumb ? angle * 0.5 : angle);
      k.bone.quaternion.copy(k.bind).multiply(this.q2.copy(k.modelInv)).multiply(this.q).multiply(k.model);
    }
  }

  /** model-space head of a posed joint */
  private jointPos(j: Joint, out: THREE.Vector3): THREE.Vector3 {
    if (!j.parent) return out.copy(j.head);
    this.jointPos(j.parent, out);
    return out.add(this.offs.copy(j.offset).applyQuaternion(j.parent.rot));
  }

  /** Two-bone IK: the wrist onto `target` (model space), the elbow bending towards `pole`. */
  private reach(upper: Joint, fore: Joint, hand: Joint, target: THREE.Vector3, pole: THREE.Vector3): void {
    const { sh, to, side, elbow, wrist, seg } = this.ik;
    this.jointPos(upper, sh);
    const l1 = fore.offset.length();
    const l2 = hand.offset.length();
    to.subVectors(target, sh);
    const d = THREE.MathUtils.clamp(to.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    to.normalize();
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    side.copy(pole).addScaledVector(to, -pole.dot(to)).normalize();
    elbow.copy(sh).addScaledVector(to, l1 * cosA).addScaledVector(side, l1 * sinA);
    wrist.copy(sh).addScaledVector(to, d);
    // turn each segment from where its parent carries it onto the solved direction (no extra twist)
    const parent = upper.parent!.rot;
    seg.copy(fore.offset).normalize().applyQuaternion(parent);
    upper.rot.setFromUnitVectors(seg, to.subVectors(elbow, sh).normalize()).multiply(parent);
    seg.copy(hand.offset).normalize().applyQuaternion(upper.rot);
    fore.rot.setFromUnitVectors(seg, to.subVectors(wrist, elbow).normalize()).multiply(upper.rot);
    hand.rot.copy(fore.rot);
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

/** The named bones of the Deadpool skin with their bind pose in model space, or null if any is missing. */
function findRig(m: THREE.Object3D): Record<RigName, Joint> | null {
  m.updateMatrixWorld(true);
  const toModel = m.matrixWorld.clone().invert();
  const mat = new THREE.Matrix4();
  const rig = {} as Record<RigName, Joint>;
  for (const name of RIG) {
    const bone = m.getObjectByName(name);
    if (!(bone instanceof THREE.Bone)) return null;
    const head = new THREE.Vector3();
    const model = new THREE.Quaternion();
    mat.multiplyMatrices(toModel, bone.matrixWorld).decompose(head, model, new THREE.Vector3());
    let parent: Joint | null = null;
    for (let p = bone.parent; p && p !== m && !parent; p = p.parent) parent = (RIG as readonly string[]).includes(p.name) ? rig[p.name as RigName] : null;
    const offset = parent ? head.clone().sub(parent.head) : head.clone();
    rig[name] = { bone, parent, bind: bone.quaternion.clone(), model, modelInv: model.clone().invert(), head, offset, rot: new THREE.Quaternion() };
  }
  return rig;
}

/** Finger chains under a hand bone: the thumb is the chain rooted nearest the wrist; the palm is on the thumb's side. */
function findHand(m: THREE.Object3D, hand: THREE.Bone): Hand {
  const toModel = m.matrixWorld.clone().invert();
  const mat = new THREE.Matrix4();
  const pos = (b: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(mat.multiplyMatrices(toModel, b.matrixWorld));
  const wrist = pos(hand);
  const chains = hand.children
    .filter((c): c is THREE.Bone => c instanceof THREE.Bone)
    .map((root) => {
      const bones = [root];
      for (let b = root.children.find((c) => c instanceof THREE.Bone); b; b = b.children.find((c) => c instanceof THREE.Bone)) bones.push(b as THREE.Bone);
      return bones;
    })
    .filter((c) => c.length > 1)
    .sort((a, b) => pos(a[0]).distanceTo(wrist) - pos(b[0]).distanceTo(wrist));
  const [thumb, ...fingers] = chains;
  const dir = new THREE.Vector3();
  for (const f of fingers) dir.add(pos(f[f.length - 1]).sub(pos(f[0])));
  dir.normalize();
  const thumbRoot = pos(thumb[0]);
  fingers.sort((a, b) => pos(a[0]).distanceTo(thumbRoot) - pos(b[0]).distanceTo(thumbRoot));
  const across = pos(fingers[0][0]).sub(pos(fingers[fingers.length - 1][0]));
  const palm = new THREE.Vector3().crossVectors(dir, across).normalize();
  if (pos(thumb[thumb.length - 1]).sub(wrist).dot(palm) < 0) palm.negate();
  const knuckles = chains.flatMap((c) =>
    c.map((bone) => {
      const model = new THREE.Quaternion();
      mat.multiplyMatrices(toModel, bone.matrixWorld).decompose(new THREE.Vector3(), model, new THREE.Vector3());
      return { bone, bind: bone.quaternion.clone(), model, modelInv: model.clone().invert(), thumb: c === thumb };
    }),
  );
  const thumbDir = pos(thumb[thumb.length - 1]).sub(thumbRoot).normalize();
  return { knuckles, curl: new THREE.Vector3().crossVectors(dir, palm).normalize(), thumbCurl: new THREE.Vector3().crossVectors(thumbDir, palm).normalize() };
}

function smooth(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
}

function isInside(o: THREE.Object3D, parent: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === parent) return true;
  return false;
}
