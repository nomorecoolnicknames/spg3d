import type { CarInput, CarSpec } from '../types';

/**
 * Arcade bicycle-model car. Pure math (no three.js) so it runs in node for tuning.
 * Frame: heading θ, forward = (sin θ, cos θ) in xz, left = (cos θ, −sin θ).
 * Velocity in car frame: vx forward, vy left. Positive yaw = turning left.
 */
export interface Surface {
  /** grip multiplier of the surface (ice < 1) */
  grip: number;
  /** slope along the car's forward direction (rad, positive uphill) */
  slopeAlong: number;
}

const G = 9.81;

export class CarPhysics {
  x = 0;
  z = 0;
  y = 0;
  heading = 0;
  vx = 0;
  vy = 0;
  yawRate = 0;
  /** visual */
  steerAngle = 0;
  wheelSpin = 0;
  pitch = 0;
  roll = 0;
  gear = 1;
  rpm = 0.2;
  nitro = 50;
  nitroActive = false;
  drifting = false;
  slip = 0;
  scraping = false;
  wheelspin = 0;
  /** last frame's longitudinal accel (for camera/FOV) */
  accel = 0;
  private shiftTimer = 0;
  private lastGear = 1;
  readonly wheelbase: number;
  readonly width: number;
  readonly length: number;
  readonly mass: number;
  private readonly a: number;
  private readonly dragK: number;
  private readonly power: number;
  private readonly muBase: number;
  private readonly handling: number;
  private readonly driftiness: number;
  private readonly nitroMult: number;
  readonly topSpeed: number;

  constructor(readonly spec: CarSpec) {
    this.wheelbase = spec.length * 0.6;
    this.width = spec.length * 0.42;
    this.length = spec.length;
    this.mass = spec.mass;
    this.a = this.wheelbase * 0.48;
    this.power = spec.power * 1000 * 1.05;
    this.topSpeed = spec.topSpeed;
    // drag chosen so that P = k v^3 at top speed (with rolling resistance folded in)
    this.dragK = this.power / Math.pow(spec.topSpeed, 3);
    this.muBase = 1.05 * spec.grip;
    this.handling = spec.handling;
    this.driftiness = spec.driftiness;
    this.nitroMult = spec.nitro;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get forwardX(): number {
    return Math.sin(this.heading);
  }
  get forwardZ(): number {
    return Math.cos(this.heading);
  }
  get leftX(): number {
    return Math.cos(this.heading);
  }
  get leftZ(): number {
    return -Math.sin(this.heading);
  }

  place(x: number, z: number, y: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.y = y;
    this.heading = heading;
    this.vx = this.vy = this.yawRate = 0;
    this.steerAngle = 0;
    this.pitch = this.roll = 0;
    this.gear = 1;
    this.rpm = 0.2;
    this.drifting = false;
    this.slip = 0;
    this.wheelspin = 0;
  }

  /** max front-wheel lock at the current speed (also used by the AI's pure pursuit) */
  maxSteer(v: number): number {
    // the handling stat shades the lock a little; it used to scale it 1:1 and made the light cars twitchy
    const k = 0.8 + 0.2 * this.handling;
    const s = (0.55 * k) / (1 + (v / 28) * (v / 28) * 0.8);
    return Math.max(0.06 * k, s);
  }

  /** half the car's footprint measured along the unit direction (nx, nz): the rotated rectangle, not a circle */
  extentAlong(nx: number, nz: number): number {
    return (this.length / 2) * Math.abs(this.forwardX * nx + this.forwardZ * nz) + (this.width / 2) * Math.abs(this.leftX * nx + this.leftZ * nz);
  }

  /** smoothed steering input −1..1: rate-limited so digital (touch/keyboard) steering is not twitchy */
  private steerIn = 0;
  private driftT = 0;

  /**
   * Arcade handling in the spirit of NFS 2015. Grip: the car turns kinematically (bicycle geometry)
   * up to a lateral-grip limit and understeers beyond it, lateral velocity is scrubbed fast, so it
   * never slides on its own. Drift: entered with the handbrake (or a brake tap while steering hard
   * on the gas); in a drift the tyres hold the slide loosely, throttle keeps it, counter-steer or
   * lifting straightens it, part of the sideways speed carries forward so a drift is not a brake.
   */
  step(inp: CarInput, dt: number, surf: Surface, canDrive: boolean): void {
    const m = this.mass;
    const v = Math.abs(this.vx);
    const throttle = canDrive ? inp.throttle : 0;
    const brake = canDrive ? inp.brake : 0;
    const handbrake = canDrive && inp.handbrake;
    const grip = surf.grip;

    // --- steering input: slower to wind on at speed, quick to return ---
    const target = Math.max(-1, Math.min(1, inp.steer));
    const returning = Math.abs(target) < Math.abs(this.steerIn) || Math.sign(target) !== Math.sign(this.steerIn);
    const rate = returning ? 7 : 5.2 / (1 + v / 45);
    this.steerIn += Math.max(-rate * dt, Math.min(rate * dt, target - this.steerIn));
    const lock = this.maxSteer(v);
    const delta = this.steerIn * lock * (this.drifting ? 1.3 : 1);
    this.steerAngle = delta;

    // --- nitro ---
    const wantNitro = canDrive && inp.nitro && this.nitro > 0.5 && this.vx > 3;
    if (wantNitro) this.nitro = Math.max(0, this.nitro - 26 * dt);
    this.nitroActive = wantNitro && this.nitro > 0;

    // --- grip budget ---
    // arcade grip (NFS-style): ~1.5 g plus downforce, city corners of 20–30 m are taken at 80–100 km/h
    const aLat = this.muBase * grip * G * 1.45 + 0.002 * v * v;
    const L = this.wheelbase;

    // --- longitudinal forces ---
    const fzR = m * G * (this.a / L) + 0.1 * v * v;
    const tractionCap = this.muBase * grip * fzR * 1.5;
    const pEff = this.power * (this.nitroActive ? 1.55 * this.nitroMult : 1) * (this.shiftTimer > 0 ? 0.55 : 1);
    let fDrive = 0;
    if (throttle > 0 && !handbrake) {
      const raw = (throttle * pEff) / Math.max(6, Math.abs(this.vx));
      if (raw > tractionCap) {
        this.wheelspin = Math.min(1, this.wheelspin + dt * 6);
        fDrive = tractionCap * 0.92;
      } else {
        this.wheelspin = Math.max(0, this.wheelspin - dt * 4);
        fDrive = raw;
      }
    } else {
      this.wheelspin = Math.max(0, this.wheelspin - dt * 4);
    }
    let reversing = false;
    if (brake > 0 && this.vx < 0.8 && throttle < 0.05) {
      reversing = true;
      fDrive = -Math.min(brake * m * 5.5, this.vx > -12 ? m * 5.5 : 0);
    }
    const sgnV = Math.sign(this.vx);
    const fBrake = reversing ? 0 : brake * grip * m * G * 1.0 * sgnV;
    const fHand = handbrake ? m * G * 0.35 * sgnV : 0;
    const fDrag = this.dragK * this.vx * Math.abs(this.vx) + 0.013 * m * G * sgnV * Math.min(1, v);
    const fSlope = -m * G * Math.sin(surf.slopeAlong);
    const fCoast = throttle < 0.05 && !reversing ? -0.05 * m * this.vx : 0;

    // --- drift state ---
    const beta = Math.atan2(this.vy, Math.max(1, v));
    const omegaKin = (this.vx * Math.tan(delta)) / L;
    const omegaCap = aLat / Math.max(4, v);
    if (!this.drifting && this.vx > 10) {
      const hb = handbrake && Math.abs(this.steerIn) > 0.15;
      const brakeTap = brake > 0.4 && throttle > 0.3 && Math.abs(this.steerIn) > 0.55 && this.vx > 18;
      const power = this.driftiness > 1.05 && throttle > 0.9 && Math.abs(omegaKin) > omegaCap * 1.3 && this.vx > 14;
      if (hb || brakeTap || power) {
        this.drifting = true;
        this.driftT = 0;
        // initiation kick: the tail steps out towards the outside of the turn
        this.yawRate += Math.sign(this.steerIn) * 0.95 * Math.min(1, this.vx / 25);
      }
    } else if (this.drifting) {
      this.driftT += dt;
      if (this.vx < 7 || (Math.abs(beta) < 0.1 && !handbrake && this.driftT > 0.4)) this.drifting = false;
    }

    // --- yaw ---
    let omegaT: number;
    let scrub = 0;
    if (!this.drifting) {
      omegaT = Math.max(-omegaCap, Math.min(omegaCap, omegaKin));
      // asking for more than the tyres give: understeer scrubs speed
      scrub = Math.min(3, Math.max(0, Math.abs(omegaKin) / omegaCap - 1) * 2.2) * m;
    } else {
      // the drift yaw keeps the pre-arcade grip scale: with the higher cornering grip the slide over-rotated to 60°
      const cap = ((this.muBase * grip * G * 1.08 + 0.0015 * v * v) / Math.max(4, v)) * 1.9;
      // β < 0 while sliding through a left-hander (velocity right of the nose): +β·k yaws the nose back toward the velocity
      omegaT = Math.max(-cap, Math.min(cap, omegaKin * 1.7)) + this.steerIn * 0.45 * sgnV + beta * 0.35;
    }
    const kin = Math.min(1, v / 3);
    const yawResp = this.drifting ? 4.2 : 9;
    this.yawRate += (omegaT - this.yawRate) * Math.min(1, dt * yawResp);
    this.yawRate = this.yawRate * kin + omegaKin * (1 - kin);

    // --- integrate longitudinal ---
    const fDriftDrag = this.drifting ? m * G * 0.06 * Math.abs(Math.sin(beta)) * sgnV : 0;
    const ax = (fDrive - fBrake - fHand - fDrag + fSlope + fCoast - scrub * sgnV - fDriftDrag) / m;
    this.accel = ax;
    this.vx += ax * dt;

    // --- lateral: the frame turns under the velocity, the tyres pull it back in line ---
    // exact rotation: turning the frame must not add speed (the linear form pumped energy in drifts)
    {
      const dth = this.yawRate * dt, c = Math.cos(dth), sn = Math.sin(dth);
      const nvx = this.vx * c + this.vy * sn;
      this.vy = -this.vx * sn + this.vy * c;
      this.vx = nvx;
    }
    // counter-steer = steering toward the velocity, i.e. the same sign as β
    const counter = this.drifting && Math.abs(this.steerIn) > 0.05 && Math.sign(this.steerIn) === Math.sign(beta) ? 1 : 0;
    const kLat = this.drifting
      ? (1.05 + 2.2 * (1 - throttle) + counter * 2.4 - (handbrake ? 0.5 : 0)) * grip
      : 13 * grip;
    const keep = Math.exp(-Math.max(0.3, kLat) * dt);
    const lost = Math.abs(this.vy) * (1 - keep);
    this.vy *= keep;
    if (this.drifting && this.vx > 0) this.vx += lost * 0.55;
    // hard limit on the slide angle: no spinning out by itself
    const maxVy = Math.tan(1.05) * Math.max(1, Math.abs(this.vx));
    if (Math.abs(this.vy) > maxVy) this.vy = Math.sign(this.vy) * maxVy;
    this.vy *= kin + (1 - kin) * Math.max(0, 1 - dt * 12);

    if (brake > 0 && !reversing && Math.abs(this.vx) < 0.6 && throttle < 0.05) this.vx *= Math.max(0, 1 - dt * 10);

    this.heading += this.yawRate * dt;
    if (this.heading > Math.PI) this.heading -= Math.PI * 2;
    else if (this.heading < -Math.PI) this.heading += Math.PI * 2;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading);
    this.x += (fx * this.vx + lx * this.vy) * dt;
    this.z += (fz * this.vx + lz * this.vy) * dt;

    // --- derived state ---
    const sp = this.speed;
    const b2 = Math.atan2(this.vy, Math.max(1, Math.abs(this.vx)));
    this.slip = Math.min(1, Math.max(Math.abs(b2) / 0.45, this.wheelspin, scrub / m / 3) * (sp > 4 ? 1 : 0));
    this.wheelSpin += (this.vx / 0.34) * dt;

    // gears: purely for HUD/audio (6 speeds, boundaries scale with top speed)
    const top = this.topSpeed * (this.nitroActive ? 1.12 : 1);
    const bounds = [0, 0.14, 0.26, 0.4, 0.56, 0.75, 1.02];
    let g = 1;
    for (let i = 1; i < 6; i++) if (v > bounds[i] * top) g = i + 1;
    if (this.vx < -0.5) g = 0;
    if (g !== this.lastGear) {
      if (g > this.lastGear && g > 1) this.shiftTimer = 0.14;
      this.lastGear = g;
    }
    this.gear = g;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const lo = bounds[Math.max(0, g - 1)] * top, hi = bounds[Math.min(6, g)] * top;
    const within = g === 0 ? Math.min(1, v / 10) : Math.max(0, Math.min(1, (v - lo) / Math.max(1, hi - lo)));
    const rpmTarget = 0.18 + within * 0.8 * (throttle > 0 || this.vx > 2 ? 1 : 0.4) + this.wheelspin * 0.3;
    const rpmClamped = Math.min(1, throttle < 0.05 && v < 2 ? 0.18 : rpmTarget);
    this.rpm += (rpmClamped - this.rpm) * Math.min(1, dt * (this.shiftTimer > 0 ? 30 : 9));

    // body motion: a hint of squat, dive and roll (lateral accel = v·ω). It was ~30° in a hard corner, which read
    // as the car leaning like a scooter instead of turning; a real car rolls 1–2° per g
    const latAcc = this.vx * this.yawRate;
    const pitchT = Math.max(-0.03, Math.min(0.03, -ax * 0.0025));
    const rollT = Math.max(-0.035, Math.min(0.035, -latAcc * 0.0018));
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 7);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 7);
  }

  /** wall contact along a lateral normal (lx,lz points from wall into the road). Returns impact strength (m/s). */
  hitWall(nx: number, nz: number): number {
    const fx = this.forwardX, fz = this.forwardZ, lx = this.leftX, lz = this.leftZ;
    const wx = fx * this.vx + lx * this.vy;
    const wz = fz * this.vx + lz * this.vy;
    const into = -(wx * nx + wz * nz);
    if (into <= 0) return 0;
    const speed = Math.hypot(wx, wz);
    // barriers absorb the impact instead of bouncing the car back into the road;
    // a glancing touch keeps most of the speed, a head-on hit kills it
    const rest = 0.12;
    let nwx = wx + nx * into * (1 + rest);
    let nwz = wz + nz * into * (1 + rest);
    const loss = Math.max(0.3, 1 - 0.75 * (into / Math.max(1, speed)));
    nwx *= loss;
    nwz *= loss;
    this.vx = nwx * fx + nwz * fz;
    this.vy = nwx * lx + nwz * lz;
    // turn the nose along the wall rather than spinning
    const tangent = Math.atan2(-nz, nx);
    let d = tangent - this.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > Math.PI / 2) d -= Math.sign(d) * Math.PI;
    this.heading += Math.sign(d) * Math.min(Math.abs(d), 0.04 + into * 0.01);
    this.yawRate *= 0.4;
    if (into > 6) this.drifting = false;
    return into;
  }

  /** elastic-ish push between two cars */
  static collide(a: CarPhysics, b: CarPhysics): number {
    // each car is a capsule along its length (radius = half width): nose-to-tail contact is real now,
    // the old circles of ~1.2 m let 5 m cars drive through each other end-on
    const reach = (a.length + b.length) * 0.5 + 0.2;
    if ((b.x - a.x) ** 2 + (b.z - a.z) ** 2 > reach * reach) return 0;
    const ra = a.width * 0.5, rb = b.width * 0.5;
    const ha = Math.max(0, a.length * 0.5 - ra), hb = Math.max(0, b.length * 0.5 - rb);
    const [pa, pb] = closestOnSegments(a.x, a.z, a.forwardX * ha, a.forwardZ * ha, b.x, b.z, b.forwardX * hb, b.forwardZ * hb);
    let dx = pb[0] - pa[0], dz = pb[1] - pa[1];
    let d = Math.hypot(dx, dz);
    const minD = ra + rb + 0.1;
    if (d >= minD) return 0;
    if (d < 1e-4) {
      dx = b.x - a.x;
      dz = b.z - a.z;
      d = Math.hypot(dx, dz) || 1;
    }
    const nx = dx / d, nz = dz / d;
    const overlap = minD - Math.min(d, minD);
    const wa = b.mass / (a.mass + b.mass), wb = a.mass / (a.mass + b.mass);
    a.x -= nx * overlap * wa;
    a.z -= nz * overlap * wa;
    b.x += nx * overlap * wb;
    b.z += nz * overlap * wb;
    const avx = a.forwardX * a.vx + a.leftX * a.vy, avz = a.forwardZ * a.vx + a.leftZ * a.vy;
    const bvx = b.forwardX * b.vx + b.leftX * b.vy, bvz = b.forwardZ * b.vx + b.leftZ * b.vy;
    const rel = (bvx - avx) * nx + (bvz - avz) * nz;
    if (rel >= 0) return 0;
    const j = -rel * 0.6;
    const navx = avx - nx * j * wa, navz = avz - nz * j * wa;
    const nbvx = bvx + nx * j * wb, nbvz = bvz + nz * j * wb;
    a.vx = navx * a.forwardX + navz * a.forwardZ;
    a.vy = navx * a.leftX + navz * a.leftZ;
    b.vx = nbvx * b.forwardX + nbvz * b.forwardZ;
    b.vy = nbvx * b.leftX + nbvz * b.leftZ;
    // side contact spins cars slightly
    const side = Math.abs(nx * a.leftX + nz * a.leftZ);
    a.yawRate += (nx * a.leftX + nz * a.leftZ) * -rel * 0.05 * side;
    b.yawRate += (nx * b.leftX + nz * b.leftZ) * rel * 0.05 * side;
    return -rel;
  }
}

/** closest points between segments centre ± half-vector (2D, x/z) */
function closestOnSegments(ax: number, az: number, ux: number, uz: number, bx: number, bz: number, vx: number, vz: number): [[number, number], [number, number]] {
  // segments P(s) = A + s·U, Q(t) = B + t·V with s, t in [−1, 1]
  const wx = ax - bx, wz = az - bz;
  const a = ux * ux + uz * uz, b = ux * vx + uz * vz, c = vx * vx + vz * vz, d = ux * wx + uz * wz, e = vx * wx + vz * wz;
  const den = a * c - b * b;
  const clamp = (x: number) => Math.max(-1, Math.min(1, x));
  let s = den > 1e-9 ? clamp((b * e - c * d) / den) : 0;
  let t = c > 1e-9 ? clamp((b * s + e) / c) : 0;
  s = a > 1e-9 ? clamp((b * t - d) / a) : 0;
  return [[ax + ux * s, az + uz * s], [bx + vx * t, bz + vz * t]];
}

