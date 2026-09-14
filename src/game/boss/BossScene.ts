import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { SceneController, Viewport } from '../Viewport';
import type { BossHUD, BossParams, SceneCallbacks, SpgSnapshot } from '../types';
import { buildArena, ARENA_RADIUS, type Arena } from './Arena';
import { BossMech } from './BossMech';
import { Humanoid } from './Fighter';
import { LightPool, ParticlePool, Ring, Shaker } from './fx';
import { input } from '../input/Input';
import { audio } from '../audio';
import { getTexture } from '../assets';
import { S } from '@/data/strings';

const PHYS_DT = 1 / 120;
const PLAYER_SPEED = 7.5;
const SPRINT_SPEED = 11;
const RELOAD = 1.1;
const ROCKET_DMG = 4.5;

interface Rocket {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  fromBoss: boolean;
}

interface Minion {
  h: Humanoid;
  pos: THREE.Vector3;
  hp: number;
  attackT: number;
  dead: boolean;
}

interface Pickup {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  t: number;
}

export class BossScene implements SceneController {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  private vp!: Viewport;
  private arena!: Arena;
  private mech!: BossMech;
  private fighter!: Humanoid;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private pmrem: THREE.Texture | null = null;
  private fire!: ParticlePool;
  private smoke!: ParticlePool;
  private lights!: LightPool;
  private shaker = new Shaker();
  private slamRing!: Ring;
  private telegraphRing!: Ring;
  private laserBeam!: THREE.Mesh;
  private laserTele!: THREE.Line;
  private reticle!: THREE.Sprite;
  private rockets: Rocket[] = [];
  private rocketGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.7, 8);
  private rocketMat = new THREE.MeshStandardMaterial({ color: '#d8d8dc', roughness: 0.4, metalness: 0.6 });
  private bossRocketMat = new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.5, metalness: 0.7, emissive: '#ff2020', emissiveIntensity: 1.5 });
  private minions: Minion[] = [];
  private pickups: Pickup[] = [];
  private pickupGeo = new THREE.BoxGeometry(0.5, 0.16, 0.16);
  private pickupMat = new THREE.MeshBasicMaterial({ color: '#33ff77', toneMapped: false });

  // state
  private t = 0;
  private acc = 0;
  private paused = false;
  private intro = 2.6;
  private introTotal = 2.6;
  private playerPos = new THREE.Vector3(0, 0, 42);
  private playerYaw = Math.PI;
  private camYaw = Math.PI;
  private camPitch = 0.12;
  private camPos = new THREE.Vector3();
  private playerHP = 100;
  private bossHP = 100;
  private phase: 1 | 2 | 3 = 1;
  private reload = 1;
  private mechPos = new THREE.Vector3(0, 0, -20);
  private mechYaw = 0;
  private mechSpeed = 0;
  private volleyT = 2.5;
  private volleyQueue = 0;
  private volleyTick = 0;
  private coreT = 0;
  private laserState: 'idle' | 'charge' | 'fire' = 'idle';
  private laserT = 0;
  private laserCd = 6;
  private laserTarget = new THREE.Vector3();
  private laserDir = new THREE.Vector3();
  private slamState: 'idle' | 'tele' | 'air' | 'wave' = 'idle';
  private slamT = 0;
  private slamCd = 5;
  private slamJump = 0;
  private waveR = 0;
  private waveHit = false;
  private minionT = 4;
  private stagger = 0;
  private dying = 0;
  private won = false;
  private dead = false;
  private message: string | null = null;
  private messageT = 0;
  private hitFlash = 0;
  private hudT = 0;
  private timer = 0;
  private god = false;
  private disposed = false;
  private stepPhase = 0;
  private autopilotStrafe = 1;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();

  constructor(
    public params: BossParams,
    public cb: SceneCallbacks,
  ) {}

  start(vp: Viewport): void {
    this.vp = vp;
    const q = vp.quality;
    const pm = new THREE.PMREMGenerator(vp.renderer);
    this.pmrem = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.pmrem;
    this.scene.environmentIntensity = 0.4;
    this.arena = buildArena(this.scene, { shadows: q.shadows });
    this.mech = new BossMech(getTexture('madkidFace'), q.shadows);
    this.mech.root.position.copy(this.mechPos);
    this.scene.add(this.mech.root);
    this.fighter = new Humanoid('fighter', q.shadows);
    this.scene.add(this.fighter.root);
    this.fire = new ParticlePool(900, true);
    this.smoke = new ParticlePool(700, false);
    this.scene.add(this.fire.points, this.smoke.points);
    this.lights = new LightPool(this.scene, 6);
    this.slamRing = new Ring('#ff7a1a', 0.08);
    this.telegraphRing = new Ring('#ff2038', 0.05);
    this.scene.add(this.slamRing.mesh, this.telegraphRing.mesh);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#ff2a3a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.laserBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 1, 10, 1, true), beamMat);
    this.laserBeam.visible = false;
    this.scene.add(this.laserBeam);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.laserTele = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#ff2038', transparent: true, opacity: 0.8 }));
    this.laserTele.visible = false;
    this.scene.add(this.laserTele);
    const retTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d')!;
      ctx.strokeStyle = '#ff3b4a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(16, 16, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(14, 14, 4, 4);
      const t = new THREE.CanvasTexture(c);
      return t;
    })();
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: retTex, depthTest: false, transparent: true, toneMapped: false }));
    this.reticle.scale.setScalar(0.9);
    this.reticle.renderOrder = 10;
    this.scene.add(this.reticle);

    this.camera.aspect = vp.width / vp.height;
    this.camera.updateProjectionMatrix();
    this.buildComposer();
    input.reset();
    input.pointerLockWanted = true;
    audio.duckMusic(0.4, 0.5);
    audio.loop('rain', true, 0.4);
    audio.loop('mech-idle', true, 0.35);
    window.setTimeout(() => !this.disposed && audio.play('mech-roar'), 600);
    this.fighter.root.position.copy(this.playerPos);
    const k = window.__spg.knobs;
    k.setBossHP = (n: unknown) => {
      this.bossHP = Math.max(0.5, Math.min(100, Number(n)));
      this.checkPhase();
    };
    k.setPhase = (p: unknown) => {
      const ph = Number(p);
      this.bossHP = ph === 3 ? 30 : ph === 2 ? 60 : 100;
      this.checkPhase();
    };
    k.skipIntro = () => {
      this.intro = 0;
    };
    k.killMinions = () => {
      for (const m of this.minions) this.killMinion(m, false);
    };
    k.godMode = (on: unknown) => {
      this.god = !!on;
    };
    this.sendHUD();
  }

  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!this.vp.quality.bloom) return;
    const c = new EffectComposer(this.vp.renderer);
    c.setPixelRatio(this.vp.quality.pixelRatio);
    c.setSize(this.vp.width, this.vp.height);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.vp.width, this.vp.height), 0.6, 0.55, 0.8);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  targetFps(): number | undefined {
    return this.paused ? 0 : undefined;
  }

  retry(): void {
    if (!this.dead) return;
    this.dead = false;
    this.playerHP = 100;
    this.playerPos.set(0, 0, 42);
    this.playerYaw = Math.PI;
    this.camYaw = Math.PI;
    this.bossHP = this.phase === 3 ? 33 : this.phase === 2 ? 66 : 100;
    for (const m of this.minions) this.killMinion(m, false);
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets = [];
    this.laserState = 'idle';
    this.laserBeam.visible = false;
    this.laserTele.visible = false;
    this.slamState = 'idle';
    this.slamRing.stop();
    this.telegraphRing.stop();
    this.volleyT = 3;
    this.laserCd = 6;
    this.slamCd = 5;
    this.mechPos.set(0, 0, -20);
    this.say(S.boss.phaseMsg[this.phase - 1]);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  private say(text: string): void {
    this.message = text;
    this.messageT = 2.6;
  }

  private checkPhase(): void {
    const want: 1 | 2 | 3 = this.bossHP <= 33 ? 3 : this.bossHP <= 66 ? 2 : 1;
    if (want > this.phase) {
      this.phase = want;
      this.stagger = 1.3;
      audio.play('boss-phase');
      audio.play('mech-roar');
      this.cb.onEvent({ type: 'boss-phase', phase: want });
      this.say(S.boss.phaseMsg[want - 1]);
      if (want >= 2) this.minionT = 1.5;
      this.lights.flash(this.mech.worldPos(this.mech.anchors.chest, this.tmp), '#ff2038', 300, 1.2, 60);
      for (let i = 0; i < 40; i++) this.fire.emit({ x: this.mechPos.x, y: 9, z: this.mechPos.z, spread: 6, speed: 12, life: 1, size0: 1.5, size1: 0.2, color: 0xff6a2a, drag: 2 });
    }
  }

  // ---------------------------------------------------------------- update
  update(dt: number): void {
    if (this.disposed || this.paused) return;
    this.t += dt;
    const foot = input.foot();
    if (this.intro > 0) {
      this.intro -= dt;
      this.updateIntroCamera();
      this.mech.pose(dt, 0, this.t);
      this.mech.aim(this.playerPos, dt);
      this.fighter.update(dt);
      this.arena.update(dt, this.t, this.camera.position);
      this.hudTick(dt);
      return;
    }
    if (this.dead) {
      this.fighter.update(dt);
      this.arena.update(dt, this.t, this.camera.position);
      this.hudTick(dt);
      return;
    }
    // look
    this.camYaw += foot.lookX;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + foot.lookY, -0.5, 0.75);
    this.timer += dt;
    this.acc += dt;
    let steps = 0;
    const maxSteps = this.vp.maxDt > 0.1 || this.vp.timeScale !== 1 ? 240 : 8;
    while (this.acc >= PHYS_DT && steps < maxSteps) {
      this.step(PHYS_DT, foot);
      this.acc -= PHYS_DT;
      steps++;
    }
    if (steps === maxSteps) this.acc = 0;
    // visuals
    this.fighter.root.position.copy(this.playerPos);
    this.fighter.root.rotation.y = this.playerYaw;
    this.fighter.update(dt);
    this.mech.root.position.copy(this.mechPos);
    this.mech.root.position.y = this.slamJump;
    this.mech.root.rotation.y = this.mechYaw;
    this.mech.aim(this.tmp.copy(this.playerPos).setY(1.2), dt);
    this.mech.pose(dt, this.dying > 0 ? 0 : this.mechSpeed, this.t, { stagger: this.stagger > 0 ? Math.sin(Math.min(1, this.stagger / 1.3) * Math.PI) : 0, collapse: this.dying > 0 ? Math.min(1, this.dying / 2.2) : 0, aimArmR: this.volleyQueue > 0 ? 1 : 0.35 });
    this.updateCamera(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
    this.lights.update(dt);
    this.slamRing.update(dt);
    this.telegraphRing.update(dt);
    this.shaker.update(dt);
    this.arena.update(dt, this.t, this.camera.position);
    for (const p of this.pickups) {
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.6 + Math.sin(this.t * 3 + p.t) * 0.12;
    }
    // cigar smoke
    if (Math.random() < dt * 12) {
      const cp = this.mech.worldPos(this.mech.anchors.cigar, this.tmp);
      this.smoke.emit({ x: cp.x, y: cp.y, z: cp.z, vy: 1.2, spread: 0.2, speed: 0.6, life: 2.2, size0: 0.3, size1: 1.6, color: 0x8a8a90, fade: 0.35, drag: 0.5 });
    }
    if (this.bloom) this.bloom.strength = 0.6 + (this.laserState === 'fire' ? 0.25 : 0);
    this.hudTick(dt);
  }

  private hudTick(dt: number): void {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 1.8);
    if (this.messageT > 0) {
      this.messageT -= dt;
      if (this.messageT <= 0) this.message = null;
    }
    this.hudT += dt;
    if (this.hudT > 0.05) {
      this.hudT = 0;
      this.sendHUD();
    }
  }

  private updateIntroCamera(): void {
    const k = 1 - this.intro / this.introTotal;
    const ang = 2.2 + k * 1.6;
    const r = 34 - k * 6;
    const target = this.tmp.set(this.mechPos.x, 8, this.mechPos.z);
    this.camera.position.set(this.mechPos.x + Math.sin(ang) * r, 6 + k * 6, this.mechPos.z + Math.cos(ang) * r);
    this.camera.lookAt(target);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.reticle.visible = false;
  }

  private updateCamera(dt: number): void {
    const back = 4.6, up = 2.1, side = 0.75;
    const dir = this.tmp.set(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const right = this.tmp2.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const pivot = this.tmp3.copy(this.playerPos).add(new THREE.Vector3(0, 1.55, 0)).addScaledVector(right, -side);
    const want = pivot.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, up * 0.35, 0));
    // keep above ground
    want.y = Math.max(0.6, want.y);
    // keep outside the arena barrier
    const rr = Math.hypot(want.x, want.z);
    if (rr > ARENA_RADIUS + 1) want.multiplyScalar((ARENA_RADIUS + 1) / rr);
    this.camPos.lerp(want, 1 - Math.exp(-dt * 18));
    this.camera.position.copy(this.camPos).add(this.shaker.offset);
    const look = pivot.clone().addScaledVector(dir, 30);
    this.camera.lookAt(look);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    // reticle at the aim point
    const aim = this.aimPoint();
    this.reticle.position.copy(aim);
    this.reticle.visible = true;
    const d = aim.distanceTo(this.camera.position);
    this.reticle.scale.setScalar(0.03 * d);
  }

  /** where the rocket goes: ray from the camera pivot along the view, hitting mech, ground or 60 m */
  private aimPoint(): THREE.Vector3 {
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const origin = this.playerPos.clone().add(new THREE.Vector3(0, 1.5, 0));
    // mech as a capsule from y=0..14 radius 4.5 around mechPos
    const toM = this.mechPos.clone().sub(origin);
    const tAlong = toM.dot(dir);
    if (tAlong > 0) {
      const closest = origin.clone().addScaledVector(dir, tAlong);
      const dy = THREE.MathUtils.clamp(closest.y, 0, 14);
      const dist = Math.hypot(closest.x - this.mechPos.x, closest.z - this.mechPos.z, (closest.y - dy) * 0.6);
      if (dist < 4.8) return closest;
    }
    if (dir.y < -0.02) {
      const tg = -origin.y / dir.y;
      if (tg < 80) return origin.addScaledVector(dir, tg).setY(0.1);
    }
    return origin.addScaledVector(dir, 60);
  }

  // ---------------------------------------------------------------- simulation
  private step(dt: number, foot: ReturnType<typeof input.foot>): void {
    const auto = window.__spg?.autopilot;
    // ---- player movement ----
    let fwd = foot.forward, strafe = foot.strafe, fire = foot.fire, sprint = foot.sprint;
    if (auto) {
      const a = this.autopilot();
      fwd = a.fwd;
      strafe = a.strafe;
      fire = a.fire;
      sprint = a.sprint;
      this.camYaw = a.yaw;
      this.camPitch = a.pitch;
    }
    const speed = sprint ? SPRINT_SPEED : PLAYER_SPEED;
    const mvx = Math.sin(this.camYaw) * fwd + Math.cos(this.camYaw) * strafe;
    const mvz = Math.cos(this.camYaw) * fwd - Math.sin(this.camYaw) * strafe;
    const ml = Math.hypot(mvx, mvz);
    const moving = ml > 0.05;
    if (moving) {
      this.playerPos.x += (mvx / Math.max(1, ml)) * speed * dt;
      this.playerPos.z += (mvz / Math.max(1, ml)) * speed * dt;
      const wantYaw = Math.atan2(mvx, mvz);
      let d = wantYaw - this.playerYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.playerYaw += d * Math.min(1, dt * 14);
    } else {
      // face the camera direction while idle so the launcher points where you look
      let d = this.camYaw - this.playerYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.playerYaw += d * Math.min(1, dt * 6);
    }
    this.fighter.play(moving ? 'run' : 'idle');
    this.fighter.setTimeScale(moving ? (sprint ? 1.5 : 1.1) : 1);
    this.constrain(this.playerPos, 0.5);
    // ---- firing ----
    this.reload = Math.min(1, this.reload + dt / RELOAD);
    if (fire && this.reload >= 1) {
      this.reload = 0;
      const muzzle = this.fighter.muzzle(new THREE.Vector3());
      const aim = this.aimPoint();
      const dir = aim.sub(muzzle).normalize();
      this.spawnRocket(muzzle, dir.multiplyScalar(70), false);
      this.fighter.kickRecoil();
      audio.play('rocket-launch');
      this.shaker.add(0.12);
      this.lights.flash(muzzle, '#ffb060', 40, 0.15, 12);
    }
    // ---- rockets ----
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      if (!r.fromBoss) r.vel.y -= 4 * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmp.copy(r.vel).normalize());
      // trail
      this.fire.emit({ x: r.pos.x, y: r.pos.y, z: r.pos.z, life: 0.35, size0: r.fromBoss ? 0.9 : 0.6, size1: 0.1, color: r.fromBoss ? 0xff4030 : 0xffb060, spread: 0.1 });
      if (Math.random() < 0.6) this.smoke.emit({ x: r.pos.x, y: r.pos.y, z: r.pos.z, life: 1.1, size0: 0.35, size1: 1.4, color: 0x777780, fade: 0.4, spread: 0.15, speed: 0.6 });
      let boom = false;
      if (r.fromBoss) {
        const dp = r.pos.distanceTo(this.tmp.copy(this.playerPos).setY(1.0));
        if (dp < 1.7) {
          this.damagePlayer(15);
          boom = true;
        }
        if (r.pos.y <= 0.05 || r.age > 6) boom = true;
      } else {
        // mech capsule hit
        const cy = THREE.MathUtils.clamp(r.pos.y - this.slamJump, 0, 14);
        const dm = Math.hypot(r.pos.x - this.mechPos.x, r.pos.z - this.mechPos.z, (r.pos.y - this.slamJump - cy) * 0.6);
        if (dm < 4.2 && this.dying === 0) {
          const core = this.mech.worldPos(this.mech.anchors.core, this.tmp);
          const dc = r.pos.distanceTo(core);
          const coreHit = this.coreT > 0 && dc < 2.2;
          this.damageBoss(coreHit ? ROCKET_DMG * 3 : ROCKET_DMG, coreHit);
          boom = true;
        }
        for (const m of this.minions) {
          if (!m.dead && r.pos.distanceTo(this.tmp.copy(m.pos).setY(1)) < 1.4) boom = true;
        }
        if (r.pos.y <= 0.05 || r.age > 4) boom = true;
        if (boom) {
          // splash
          for (const m of this.minions) {
            const d = r.pos.distanceTo(this.tmp.copy(m.pos).setY(1));
            if (!m.dead && d < 5) {
              m.hp -= 20 * (1 - d / 6);
              if (m.hp <= 0) this.killMinion(m, true);
            }
          }
          if (r.pos.distanceTo(this.tmp.copy(this.playerPos).setY(1)) < 3) this.damagePlayer(5);
        }
      }
      if (boom) {
        this.explode(r.pos, r.fromBoss ? 1.0 : 1.2);
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
    // ---- boss ----
    if (this.dying > 0) {
      this.dying += dt;
      if (Math.random() < dt * 9) {
        const p = this.tmp.set(this.mechPos.x + (Math.random() - 0.5) * 9, 3 + Math.random() * 9, this.mechPos.z + (Math.random() - 0.5) * 6);
        this.explode(p, 1.6);
        audio.play('explosion', { gain: 0.6, pitch: (Math.random() - 0.5) * 6 });
      }
      if (this.dying > 4.6 && !this.won) {
        this.won = true;
        audio.play('boss-dead');
        this.explode(this.tmp.set(this.mechPos.x, 6, this.mechPos.z), 4);
        this.shaker.add(1.2);
        window.setTimeout(() => {
          if (!this.disposed) this.cb.onFinish({ kind: 'boss', won: true, time: this.timer, reward: 30000 });
        }, 3500);
      }
      return;
    }
    this.stepBoss(dt);
    this.stepMinions(dt);
    // ---- pickups ----
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.pos.distanceTo(this.playerPos) < 1.6) {
        this.playerHP = Math.min(100, this.playerHP + 25);
        audio.play('pickup');
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
    // stagger decay
    if (this.stagger > 0) this.stagger = Math.max(0, this.stagger - dt);
  }

  private constrain(p: THREE.Vector3, r: number): void {
    const d = Math.hypot(p.x, p.z);
    const max = ARENA_RADIUS - 1.5 - r;
    if (d > max) {
      p.x *= max / d;
      p.z *= max / d;
    }
    for (const o of this.arena.obstacles) {
      const dx = p.x - o.x, dz = p.z - o.z;
      const dd = Math.hypot(dx, dz);
      if (dd < o.r + r && dd > 0.001) {
        p.x = o.x + (dx / dd) * (o.r + r);
        p.z = o.z + (dz / dd) * (o.r + r);
      }
    }
    // mech feet
    const mx = p.x - this.mechPos.x, mz = p.z - this.mechPos.z;
    const md = Math.hypot(mx, mz);
    if (md < 4.2 + r && md > 0.001) {
      p.x = this.mechPos.x + (mx / md) * (4.2 + r);
      p.z = this.mechPos.z + (mz / md) * (4.2 + r);
    }
    p.y = 0;
  }

  private stepBoss(dt: number): void {
    const toP = this.tmp.set(this.playerPos.x - this.mechPos.x, 0, this.playerPos.z - this.mechPos.z);
    const dist = toP.length();
    toP.normalize();
    // face the player
    const wantYaw = Math.atan2(toP.x, toP.z);
    let d = wantYaw - this.mechYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.mechYaw += THREE.MathUtils.clamp(d, -1.2 * dt, 1.2 * dt);
    // walk toward the player, keep some distance
    const walkSpeed = this.phase === 3 ? 3.8 : 2.5;
    const busy = this.stagger > 0 || this.laserState !== 'idle' || this.slamState !== 'idle';
    if (!busy && dist > 16) {
      this.mechPos.addScaledVector(toP, walkSpeed * dt);
      this.mechSpeed = walkSpeed;
    } else this.mechSpeed = 0;
    const mr = Math.hypot(this.mechPos.x, this.mechPos.z);
    if (mr > ARENA_RADIUS - 8) this.mechPos.multiplyScalar((ARENA_RADIUS - 8) / mr);
    // footsteps
    if (this.mechSpeed > 0) {
      const ph = this.t * (1.4 + this.mechSpeed * 0.55);
      const step = Math.floor(ph / Math.PI);
      if (step !== this.stepPhase) {
        this.stepPhase = step;
        const foot = this.mech.anchors.feet[step % 2];
        const fp = this.mech.worldPos(foot, this.tmp2);
        audio.play('mech-step', { gain: 0.8 });
        this.shaker.add(0.25);
        for (let i = 0; i < 14; i++) this.smoke.emit({ x: fp.x, y: 0.3, z: fp.z, spread: 2.5, speed: 3, vy: 1.5, life: 1.4, size0: 1.2, size1: 3.5, color: 0x55535a, fade: 0.4, drag: 1.5 });
      }
    }
    if (this.stagger > 0) return;
    // ---- volleys ----
    this.volleyT -= dt;
    if (this.volleyT <= 0 && this.volleyQueue === 0 && this.laserState === 'idle' && this.slamState === 'idle') {
      this.volleyQueue = this.phase === 3 ? 8 : 6;
      this.volleyTick = 0;
      this.volleyT = this.phase === 3 ? 3.2 : this.phase === 2 ? 4.5 : 3.6;
    }
    if (this.volleyQueue > 0) {
      this.volleyTick -= dt;
      if (this.volleyTick <= 0) {
        this.volleyTick = 0.15;
        this.volleyQueue--;
        const useRack = this.volleyQueue % 2 === 0 && this.mech.anchors.shoulderRack.length > 0;
        const src = useRack ? this.mech.anchors.shoulderRack[this.volleyQueue % this.mech.anchors.shoulderRack.length] : this.mech.anchors.rocketPod[0];
        const from = this.mech.worldPos(src, new THREE.Vector3());
        // lead the target slightly + spread
        const target = this.playerPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 1, (Math.random() - 0.5) * 5));
        const dir = target.sub(from);
        const len = dir.length();
        dir.normalize();
        // arc: add upward component for far targets
        dir.y += Math.min(0.45, len / 120);
        dir.normalize();
        this.spawnRocket(from, dir.multiplyScalar(24), true);
        audio.play('rocket-launch', { gain: 0.5, pitch: -4 });
        this.lights.flash(from, '#ff6030', 60, 0.2, 20);
        if (this.volleyQueue === 0) {
          this.coreT = 3.0;
          this.mech.setCore(true);
          audio.play('core-open');
          this.say(S.boss.core);
        }
      }
    }
    if (this.coreT > 0) {
      this.coreT -= dt;
      if (this.coreT <= 0) this.mech.setCore(false);
    }
    // ---- laser (phase 2+) ----
    if (this.phase >= 2) {
      if (this.laserState === 'idle') {
        this.laserCd -= dt;
        if (this.laserCd <= 0 && this.volleyQueue === 0 && this.slamState === 'idle') {
          this.laserState = 'charge';
          this.laserT = 1.2;
          this.laserTarget.copy(this.playerPos);
          audio.play('laser-charge');
          this.say(S.boss.laser);
          this.laserTele.visible = true;
        }
      } else if (this.laserState === 'charge') {
        this.laserT -= dt;
        this.laserTarget.lerp(this.playerPos, Math.min(1, dt * 3));
        const eye = this.mech.worldPos(this.mech.anchors.eye, this.tmp2);
        const pos = this.laserTele.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, eye.x, eye.y, eye.z);
        pos.setXYZ(1, this.laserTarget.x, 0.2, this.laserTarget.z);
        pos.needsUpdate = true;
        if (this.laserT <= 0) {
          this.laserState = 'fire';
          this.laserT = 2.2;
          this.laserTele.visible = false;
          this.laserBeam.visible = true;
          this.laserDir.copy(this.laserTarget).sub(eye).normalize();
          audio.play('laser-fire');
          audio.loop('laser-beam', true, 0.8);
        }
      } else {
        this.laserT -= dt;
        const eye = this.mech.worldPos(this.mech.anchors.eye, this.tmp2);
        // sweep toward the player with limited angular speed
        const want = this.tmp3.copy(this.playerPos).setY(0.5).sub(eye).normalize();
        const maxTurn = 0.55 * dt;
        const ang = this.laserDir.angleTo(want);
        if (ang > 1e-4) this.laserDir.lerp(want, Math.min(1, maxTurn / ang)).normalize();
        // beam to the ground
        const len = this.laserDir.y < -0.01 ? Math.min(140, -eye.y / this.laserDir.y) : 140;
        const end = eye.clone().addScaledVector(this.laserDir, len);
        this.laserBeam.position.copy(eye).add(end).multiplyScalar(0.5);
        this.laserBeam.scale.set(1, len, 1);
        this.laserBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.laserDir);
        // impact fx + damage: distance from player to the beam segment
        this.fire.emit({ x: end.x, y: 0.3, z: end.z, spread: 1.2, speed: 6, vy: 3, life: 0.5, size0: 1.0, size1: 0.2, color: 0xff5040 });
        const pp = this.tmp.copy(this.playerPos).setY(1);
        const seg = end.clone().sub(eye);
        const tt = THREE.MathUtils.clamp(pp.clone().sub(eye).dot(seg) / seg.lengthSq(), 0, 1);
        const closest = eye.clone().addScaledVector(seg, tt);
        if (closest.distanceTo(pp) < 2.0) this.damagePlayer(22 * dt, true);
        if (this.laserT <= 0) {
          this.laserState = 'idle';
          this.laserBeam.visible = false;
          this.laserCd = this.phase === 3 ? 7 : 9;
          audio.loop('laser-beam', false);
        }
      }
    }
    // ---- slam (phase 3) ----
    if (this.phase === 3) {
      if (this.slamState === 'idle') {
        this.slamCd -= dt;
        if (this.slamCd <= 0 && this.volleyQueue === 0 && this.laserState === 'idle') {
          this.slamState = 'tele';
          this.slamT = 1.1;
          this.telegraphRing.start(this.mechPos, 2, 30, 26);
          this.say(S.boss.slam);
          audio.play('laser-charge', { pitch: -7 });
        }
      } else if (this.slamState === 'tele') {
        this.slamT -= dt;
        if (this.slamT <= 0) {
          this.slamState = 'air';
          this.slamT = 0;
        }
      } else if (this.slamState === 'air') {
        this.slamT += dt;
        this.slamJump = Math.sin(Math.min(1, this.slamT / 0.9) * Math.PI) * 5;
        if (this.slamT >= 0.9) {
          this.slamJump = 0;
          this.slamState = 'wave';
          this.waveR = 0;
          this.waveHit = false;
          this.slamRing.start(this.mechPos, 1, 30, 14);
          audio.play('slam');
          this.shaker.add(1.0);
          for (let i = 0; i < 60; i++) this.smoke.emit({ x: this.mechPos.x, y: 0.4, z: this.mechPos.z, spread: 6, speed: 14, vy: 3, life: 1.6, size0: 1.5, size1: 4.5, color: 0x5a5660, fade: 0.5, drag: 1.2 });
        }
      } else {
        this.waveR += 14 * dt;
        const dp = Math.hypot(this.playerPos.x - this.mechPos.x, this.playerPos.z - this.mechPos.z);
        if (!this.waveHit && Math.abs(dp - this.waveR) < 2.2) {
          this.waveHit = true;
          this.damagePlayer(35);
        }
        if (this.waveR > 30) {
          this.slamState = 'idle';
          this.slamCd = 7;
        }
      }
    }
  }

  private stepMinions(dt: number): void {
    if (this.phase >= 2) {
      this.minionT -= dt;
      const alive = this.minions.filter((m) => !m.dead).length;
      if (this.minionT <= 0 && alive <= 2) {
        this.minionT = 18;
        for (let i = 0; i < 4 && this.minions.filter((m) => !m.dead).length < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = ARENA_RADIUS - 6;
          const h = new Humanoid('zombie', this.vp.quality.shadows);
          const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
          h.root.position.copy(pos);
          this.scene.add(h.root);
          this.minions.push({ h, pos, hp: 20, attackT: 0, dead: false });
          audio.play('zombie-groan', { gain: 0.5, pitch: (Math.random() - 0.5) * 6 });
        }
      }
    }
    for (const m of this.minions) {
      if (m.dead) continue;
      const to = this.tmp.set(this.playerPos.x - m.pos.x, 0, this.playerPos.z - m.pos.z);
      const d = to.length();
      to.normalize();
      if (d > 1.5) m.pos.addScaledVector(to, 3.2 * dt);
      this.constrain(m.pos, 0.4);
      m.h.root.position.copy(m.pos);
      m.h.root.rotation.y = Math.atan2(to.x, to.z);
      m.h.update(dt);
      m.attackT -= dt;
      if (d < 1.8 && m.attackT <= 0) {
        m.attackT = 0.8;
        this.damagePlayer(6);
      }
    }
  }

  private killMinion(m: Minion, loot: boolean): void {
    if (m.dead) return;
    m.dead = true;
    this.scene.remove(m.h.root);
    m.h.dispose();
    if (loot) {
      audio.play('zombie-dead', { gain: 0.6 });
      for (let i = 0; i < 16; i++) this.fire.emit({ x: m.pos.x, y: 1, z: m.pos.z, spread: 0.6, speed: 5, life: 0.6, size0: 0.6, size1: 0.1, color: 0x66ff66 });
      if (Math.random() < 0.35) {
        const g = new THREE.Group();
        const a = new THREE.Mesh(this.pickupGeo, this.pickupMat);
        const b = new THREE.Mesh(this.pickupGeo, this.pickupMat);
        b.rotation.z = Math.PI / 2;
        g.add(a, b);
        g.position.copy(m.pos).setY(0.6);
        this.scene.add(g);
        this.pickups.push({ mesh: g, pos: m.pos.clone(), t: Math.random() * 6 });
      }
    }
    this.minions = this.minions.filter((x) => x !== m);
  }

  private spawnRocket(pos: THREE.Vector3, vel: THREE.Vector3, fromBoss: boolean): void {
    const mesh = new THREE.Mesh(this.rocketGeo, fromBoss ? this.bossRocketMat : this.rocketMat);
    mesh.position.copy(pos);
    if (fromBoss) mesh.scale.setScalar(1.8);
    this.scene.add(mesh);
    this.rockets.push({ mesh, pos: pos.clone(), vel: vel.clone(), age: 0, fromBoss });
  }

  private explode(p: THREE.Vector3, size: number): void {
    for (let i = 0; i < 26 * size; i++) this.fire.emit({ x: p.x, y: p.y, z: p.z, spread: 0.5 * size, speed: 9 * size, life: 0.55 * size, size0: 1.4 * size, size1: 0.2, color: i % 3 ? 0xffa030 : 0xff4020, drag: 2 });
    for (let i = 0; i < 12 * size; i++) this.smoke.emit({ x: p.x, y: p.y, z: p.z, spread: 0.8 * size, speed: 4 * size, vy: 2, life: 1.8 * size, size0: 1.2 * size, size1: 4 * size, color: 0x3a3a40, fade: 0.55, drag: 1.5 });
    this.lights.flash(p, '#ff9040', 120 * size, 0.35, 25 * size);
    const d = p.distanceTo(this.playerPos);
    audio.play(size > 2 ? 'explosion-big' : 'rocket-hit', { gain: Math.max(0.15, 1 - d / 80) });
    this.shaker.add(Math.max(0, 0.5 * size - d * 0.01));
  }

  private damageBoss(amount: number, core: boolean): void {
    if (this.bossHP <= 0) return;
    this.bossHP = Math.max(0, this.bossHP - amount);
    if (core) {
      audio.play('drift-score', { gain: 0.5, pitch: 5 });
      this.lights.flash(this.mech.worldPos(this.mech.anchors.core, this.tmp), '#2ee6ff', 150, 0.3, 30);
    }
    if (this.bossHP <= 0) {
      this.dying = 0.001;
      this.mech.setCore(false);
      this.laserState = 'idle';
      this.laserBeam.visible = false;
      this.laserTele.visible = false;
      audio.loop('laser-beam', false);
      audio.loop('mech-idle', false);
      audio.play('mech-roar', { pitch: -5 });
      this.cb.onEvent({ type: 'boss-dead' });
      for (const m of this.minions) this.killMinion(m, false);
      return;
    }
    this.checkPhase();
  }

  private damagePlayer(amount: number, continuous = false): void {
    if (this.dead || this.god || this.intro > 0) return;
    this.playerHP = Math.max(0, this.playerHP - amount);
    this.hitFlash = Math.min(1, this.hitFlash + (continuous ? 0.05 : 0.6));
    if (!continuous) {
      audio.play('player-hit', { gain: 0.7 });
      this.shaker.add(0.3);
    }
    if (this.playerHP <= 0) {
      this.dead = true;
      audio.play('player-dead');
      audio.loop('laser-beam', false);
      this.cb.onEvent({ type: 'player-dead' });
      this.say(S.boss.dead);
    }
  }

  /** Simple fighter autopilot for QA: orbit at range, dodge telegraphs, shoot the core. */
  private autopilot(): { fwd: number; strafe: number; fire: boolean; sprint: boolean; yaw: number; pitch: number } {
    const toM = this.tmp.set(this.mechPos.x - this.playerPos.x, 0, this.mechPos.z - this.playerPos.z);
    const dist = toM.length();
    toM.normalize();
    const yaw = Math.atan2(toM.x, toM.z);
    // aim at core/chest height
    const targetY = this.coreT > 0 ? this.mech.worldPos(this.mech.anchors.core, this.tmp2).y : 6.5;
    const pitch = Math.atan2(targetY - 1.5, dist);
    let fwd = 0, strafe = this.autopilotStrafe;
    let sprint = false;
    if (dist > 30) fwd = 1;
    else if (dist < 22) fwd = -1;
    // dodge: slam wave → run away; laser → move perpendicular fast; rockets close → sidestep
    if (this.slamState !== 'idle') {
      fwd = -1;
      sprint = true;
    }
    if (this.laserState === 'fire') sprint = true;
    if (Math.random() < 0.004) this.autopilotStrafe *= -1;
    const nearRocket = this.rockets.some((r) => r.fromBoss && r.pos.distanceTo(this.playerPos) < 7);
    if (nearRocket) sprint = true;
    // avoid minions
    for (const m of this.minions) if (!m.dead && m.pos.distanceTo(this.playerPos) < 4) fwd = -1;
    return { fwd, strafe, fire: this.reload >= 1 && dist < 70, sprint, yaw, pitch };
  }

  private sendHUD(): void {
    const hud: BossHUD = {
      kind: 'boss',
      playerHP: Math.round(this.playerHP),
      bossHP: Math.round(this.bossHP * 10) / 10,
      bossPhase: this.phase,
      bossName: S.boss.name,
      reload: this.reload,
      ammoReady: this.reload >= 1,
      minions: this.minions.filter((m) => !m.dead).length,
      coreExposed: this.coreT > 0,
      message: this.message,
      hitFlash: this.hitFlash,
      timer: this.timer,
      won: this.won,
      dead: this.dead,
      intro: this.intro > 0,
    };
    this.cb.onHUD(hud);
  }

  render(vp: Viewport): void {
    if (this.composer) this.composer.render();
    else vp.renderer.render(this.scene, this.camera);
  }

  snapshot(): Partial<SpgSnapshot> {
    return {
      playerPos: [this.playerPos.x, this.playerPos.y, this.playerPos.z],
      extra: { bossHP: this.bossHP, phase: this.phase, playerHP: this.playerHP, minions: this.minions.length, rockets: this.rockets.length, intro: this.intro > 0, dead: this.dead, won: this.won },
    };
  }

  dispose(): void {
    this.disposed = true;
    input.pointerLockWanted = false;
    audio.loop('rain', false);
    audio.loop('mech-idle', false);
    audio.loop('laser-beam', false);
    audio.duckMusic(1, 0.5);
    for (const r of this.rockets) this.scene.remove(r.mesh);
    for (const m of this.minions) m.h.dispose();
    this.fighter.dispose();
    this.mech.dispose();
    this.arena.dispose();
    this.fire.dispose();
    this.smoke.dispose();
    this.slamRing.dispose();
    this.telegraphRing.dispose();
    this.laserBeam.geometry.dispose();
    (this.laserBeam.material as THREE.Material).dispose();
    this.laserTele.geometry.dispose();
    (this.laserTele.material as THREE.Material).dispose();
    (this.reticle.material as THREE.SpriteMaterial).map?.dispose();
    this.reticle.material.dispose();
    this.rocketGeo.dispose();
    this.rocketMat.dispose();
    this.bossRocketMat.dispose();
    this.pickupGeo.dispose();
    this.pickupMat.dispose();
    this.composer?.dispose();
    this.pmrem?.dispose();
    const k = window.__spg.knobs;
    for (const n of ['setBossHP', 'setPhase', 'skipIntro', 'killMinions', 'godMode']) delete k[n];
    this.scene.clear();
  }
}
