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
  readonly mass: number;
  private readonly a: number;
  private readonly b: number;
  private readonly iz: number;
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
    this.mass = spec.mass;
    this.a = this.wheelbase * 0.48;
    this.b = this.wheelbase * 0.52;
    this.iz = spec.mass * this.wheelbase * this.wheelbase * 0.42;
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

  /** max steering lock at the current speed */
  maxSteer(v: number): number {
    const base = 0.52 * this.handling;
    const s = base / (1 + (v / 24) * (v / 24) * 0.85);
    return Math.max(0.055 * this.handling, s) * (this.drifting ? 1.5 : 1);
  }

  step(inp: CarInput, dt: number, surf: Surface, canDrive: boolean): void {
    const m = this.mass;
    const v = Math.abs(this.vx);
    const throttle = canDrive ? inp.throttle : 0;
    const brake = canDrive ? inp.brake : 0;
    const handbrake = canDrive && inp.handbrake;

    // --- steering ---
    const lock = this.maxSteer(v);
    const targetSteer = inp.steer * lock;
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, dt * 16);
    const delta = this.steerAngle;

    // --- nitro ---
    const wantNitro = canDrive && inp.nitro && this.nitro > 0.5 && this.vx > 3;
    if (wantNitro) this.nitro = Math.max(0, this.nitro - 26 * dt);
    this.nitroActive = wantNitro && this.nitro > 0;

    // --- loads (with downforce) ---
    const down = 0.22 * v * v;
    const fzF = (m * G + down) * (this.b / this.wheelbase);
    const fzR = (m * G + down) * (this.a / this.wheelbase);
    const mu = this.muBase * surf.grip;
    const muF = mu * 1.0;
    let muR = mu;
    if (handbrake) muR *= 0.4 / this.driftiness;

    // --- longitudinal forces (rear wheel drive) ---
    const pEff = this.power * (this.nitroActive ? 1.55 * this.nitroMult : 1) * (this.shiftTimer > 0 ? 0.55 : 1);
    let fDrive = 0;
    // weight transfer under acceleration is not modelled: use a blended load for traction
    const tractionCap = muR * (fzR + 0.35 * fzF) * 1.05;
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
    // reverse
    let reversing = false;
    if (brake > 0 && this.vx < 0.8 && throttle === 0) {
      reversing = true;
      fDrive = -Math.min(brake * m * 5.5, this.vx > -12 ? m * 5.5 : 0);
    }
    const fBrake = reversing ? 0 : brake * mu * m * G * 0.95 * Math.sign(this.vx);
    const fDrag = this.dragK * this.vx * Math.abs(this.vx) + 0.013 * m * G * Math.sign(this.vx) * Math.min(1, v);
    const fSlope = -m * G * Math.sin(surf.slopeAlong);
    // engine braking / coasting
    const fCoast = throttle === 0 && !reversing ? -0.06 * m * this.vx : 0;

    // --- lateral tire model ---
    const vxEff = Math.max(1.2, v);
    const alphaF = Math.atan2(this.vy + this.a * this.yawRate, vxEff) - delta * Math.sign(this.vx || 1);
    const alphaR = Math.atan2(this.vy - this.b * this.yawRate, vxEff);
    const cF = 11 * fzF;
    const cR = 13.5 * fzR;
    // rear friction circle: driving hard eats lateral capacity (drift cars more so)
    const useR = Math.min(0.92, (Math.abs(fDrive + fBrake * 0.6) / Math.max(1, tractionCap)) * 0.7 * this.driftiness);
    const capR = muR * fzR * Math.sqrt(Math.max(0.2, 1 - useR * useR));
    const capF = muF * fzF * (brake > 0.9 ? 0.85 : 1);
    const fF = -capF * Math.tanh((cF * alphaF) / capF);
    const fR = -capR * Math.tanh((cR * alphaR) / capR);

    // --- integrate (car frame) ---
    const ax = (fDrive - fBrake - fDrag + fSlope + fCoast - fF * Math.sin(delta)) / m + this.vy * this.yawRate;
    const ay = (fF * Math.cos(delta) + fR) / m - this.vx * this.yawRate;
    let yawAcc = (this.a * fF * Math.cos(delta) - this.b * fR) / this.iz;
    // arcade stability: damp runaway spins beyond ~40° of rear slip
    const over = Math.max(0, Math.abs(alphaR) - 0.7);
    yawAcc -= this.yawRate * (0.35 + over * 6);
    this.accel = ax;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.yawRate += yawAcc * dt;

    // low-speed kinematic blend (keeps parking manoeuvres sane)
    const kin = Math.min(1, v / 5);
    const omegaKin = (this.vx * Math.tan(delta)) / this.wheelbase;
    this.yawRate = this.yawRate * kin + omegaKin * (1 - kin);
    this.vy *= kin + (1 - kin) * Math.max(0, 1 - dt * 12);

    // brake to a stop cleanly
    if (brake > 0 && !reversing && Math.abs(this.vx) < 0.6 && throttle === 0) this.vx *= Math.max(0, 1 - dt * 10);

    this.heading += this.yawRate * dt;
    if (this.heading > Math.PI) this.heading -= Math.PI * 2;
    else if (this.heading < -Math.PI) this.heading += Math.PI * 2;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading);
    this.x += (fx * this.vx + lx * this.vy) * dt;
    this.z += (fz * this.vx + lz * this.vy) * dt;

    // --- derived state ---
    const sp = this.speed;
    this.drifting = (Math.abs(alphaR) > 0.3 || (handbrake && Math.abs(alphaR) > 0.15)) && sp > 7 && this.vx > 0;
    this.slip = Math.min(1, Math.max(Math.abs(alphaR) / 0.5, Math.abs(alphaF) / 0.6, this.wheelspin) * (sp > 4 ? 1 : 0));
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

    // visual pitch / roll from accelerations
    this.pitch += ((-ax * 0.012) - this.pitch) * Math.min(1, dt * 6);
    this.roll += ((-ay * 0.02) - this.roll) * Math.min(1, dt * 6);
  }

  /** wall contact along a lateral normal (lx,lz points from wall into the road). Returns impact strength (m/s). */
  hitWall(nx: number, nz: number): number {
    const fx = this.forwardX, fz = this.forwardZ, lx = this.leftX, lz = this.leftZ;
    const wx = fx * this.vx + lx * this.vy;
    const wz = fz * this.vx + lz * this.vy;
    const into = -(wx * nx + wz * nz);
    if (into <= 0) return 0;
    const rest = 0.35;
    const nwx = wx + nx * into * (1 + rest);
    const nwz = wz + nz * into * (1 + rest);
    // friction along the wall + speed loss
    const loss = Math.max(0.55, 1 - into * 0.025);
    this.vx = (nwx * fx + nwz * fz) * loss;
    this.vy = nwx * lx + nwz * lz;
    // rotate the car a bit toward the wall tangent
    const tangentHeading = Math.atan2(-nz, nx);
    let d = tangentHeading - this.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // push heading away from pointing into the wall
    const facingIn = -(fx * nx + fz * nz);
    if (facingIn > 0.1) this.yawRate += Math.sign(d) * Math.min(1.2, into * 0.12);
    return into;
  }

  /** elastic-ish push between two cars */
  static collide(a: CarPhysics, b: CarPhysics): number {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d2 = dx * dx + dz * dz;
    const minD = (a.width + b.width) * 0.5 + 0.35;
    if (d2 >= minD * minD || d2 < 1e-6) return 0;
    const d = Math.sqrt(d2);
    const nx = dx / d, nz = dz / d;
    const overlap = minD - d;
    const wa = b.mass / (a.mass + b.mass), wb = a.mass / (a.mass + b.mass);
    a.x -= nx * overlap * wa;
    a.z -= nz * overlap * wa;
    b.x += nx * overlap * wb;
    b.z += nz * overlap * wb;
    const avx = a.forwardX * a.vx + a.leftX * a.vy, avz = a.forwardZ * a.vx + a.leftZ * a.vy;
    const bvx = b.forwardX * b.vx + b.leftX * b.vy, bvz = b.forwardZ * b.vx + b.leftZ * b.vy;
    const rel = (bvx - avx) * nx + (bvz - avz) * nz;
    if (rel >= 0) return 0;
    const j = -rel * 0.75;
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
