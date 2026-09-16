import type { CarDynamics, CarInput, CarSpec } from '../types';

/**
 * Arcade car on a slip-angle bicycle model. Pure math (no three.js) so it runs in node for tuning.
 * Frame: heading θ, forward = (sin θ, cos θ) in xz, left = (cos θ, −sin θ).
 * Velocity in car frame: vx forward, vy left. Positive yaw = turning left.
 *
 * Each axle makes lateral force from its slip angle through a saturating (Pacejka-like) curve, scaled by the
 * load on it — so weight transfer under braking and power, the friction ellipse (a driven or braked axle has
 * less grip left for cornering) and the balance between the axles all fall out of the model: turn-in bites,
 * trail braking rotates the car, power pushes the nose wide or steps the tail out, and the car carries a
 * visible slip angle. On top of that sits arcade forgiveness: a stability term that keeps pulling the yaw
 * towards where the wheels point, a cap on the slide angle and a counter-steer assist, all per car, so the
 * cars have character (the old model gave every car the same grip ceiling and the same response — wooden).
 */
export interface Surface {
  /** grip multiplier of the surface (ice < 1) */
  grip: number;
  /** slope along the car's forward direction (rad, positive uphill) */
  slopeAlong: number;
}

const G = 9.81;
/** reference lateral acceleration of TrackData.computeSpeedProfile (m/s²) — the AI scales its line speed by this */
export const LINE_ALAT = 10.5;

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
  /** last frame's longitudinal accel (for camera/FOV and load transfer) */
  accel = 0;
  /** slip angle of the body (rad, signed): how far the car is sideways */
  beta = 0;
  /** 0..1 how deep the car sits in the slipstream of the one ahead (the race sets it) */
  draft = 0;
  private shiftTimer = 0;
  private lastGear = 1;
  readonly wheelbase: number;
  readonly width: number;
  readonly length: number;
  readonly mass: number;
  /** front axle distance from the CG */
  private readonly a: number;
  private readonly b: number;
  private readonly izz: number;
  private readonly dragK: number;
  private readonly power: number;
  private readonly muF: number;
  private readonly muR: number;
  private readonly downforce: number;
  private readonly stability: number;
  private readonly lock: number;
  private readonly steerMargin: number;
  private readonly brakeBias: number;
  private readonly betaMax: number;
  private readonly betaHold: number;
  private readonly betaGrip: number;
  private readonly nitroMult: number;
  readonly topSpeed: number;
  /** peak lateral acceleration on dry asphalt, m/s² (no downforce) */
  readonly latAccel: number;
  /** AI: line speeds scale with the square root of the grip ratio to the track profile */
  readonly corneringScale: number;

  constructor(readonly spec: CarSpec) {
    const d: CarDynamics = spec.dyn ?? {};
    this.wheelbase = spec.length * 0.6;
    this.width = spec.length * 0.42;
    this.length = spec.length;
    this.mass = spec.mass;
    const wf = d.weightFront ?? 0.52;
    this.a = this.wheelbase * (1 - wf);
    this.b = this.wheelbase * wf;
    this.izz = spec.mass * Math.pow(0.3 * spec.length, 2) * (d.inertia ?? 1);
    this.power = spec.power * 1000 * 1.05;
    this.topSpeed = spec.topSpeed;
    // drag chosen so that P = k v^3 at top speed (with rolling resistance folded in)
    this.dragK = this.power / Math.pow(spec.topSpeed, 3);
    const latG = d.latG ?? 1.15 + 0.25 * (spec.grip - 1) * 4;
    const bal = d.balance ?? 0.05 * (spec.driftiness - 1) * 4;
    this.muF = latG * (1 + bal);
    this.muR = latG * (1 - bal);
    this.latAccel = latG * G;
    this.corneringScale = Math.sqrt((latG * G) / LINE_ALAT);
    this.downforce = d.downforce ?? 0.15;
    this.stability = d.stability ?? 5.5;
    this.lock = d.steerLock ?? 0.52 + 0.08 * (spec.handling - 1) * 4;
    this.steerMargin = d.steerMargin ?? 0.085 + 0.03 * (spec.driftiness - 0.9);
    this.brakeBias = d.brakeBias ?? 0.62;
    this.betaMax = d.betaMax ?? 0.55 + 0.35 * (spec.driftiness - 0.9);
    this.betaHold = d.betaHold ?? 0.09 + 0.05 * (spec.driftiness - 0.9);
    this.betaGrip = d.betaGrip ?? 7;
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
    this.steerIn = 0;
    this.pitch = this.roll = 0;
    this.gear = 1;
    this.rpm = 0.2;
    this.drifting = false;
    this.slip = 0;
    this.beta = 0;
    this.wheelspin = 0;
  }

  /** lateral grip budget (m/s²) at speed v on a unit-grip surface: tyres plus downforce */
  private latGrip(v: number): number {
    return this.latAccel + (this.downforce * v * v) / this.mass;
  }

  /**
   * Usable steering at this speed: the Ackermann angle for the tightest corner the tyres can hold, plus the
   * car's slip margin — full travel asks for a little more than the grip gives (a hint of understeer at the
   * stop) instead of the geometric lock, which at speed would just throw the car sideways.
   */
  private lockAt(v: number): number {
    const vv = Math.max(4, v);
    const kappa = (this.latGrip(vv) * 1.02) / (vv * vv);
    return Math.max(0.06, Math.min(this.lock, Math.atan(kappa * this.wheelbase) + this.steerMargin));
  }

  /**
   * Steering angle that puts the front tyres at their peak (used by the AI's pure pursuit and by the HUD).
   * Slightly past the grip limit so that the last part of the travel still asks for more than the car can hold.
   */
  maxSteer(v: number): number {
    const vv = Math.max(4, v);
    const kappa = this.latGrip(vv) / (vv * vv);
    return Math.min(this.lockAt(v), Math.atan(kappa * this.wheelbase) * 1.3 + 0.03);
  }

  /** half the car's footprint measured along the unit direction (nx, nz): the rotated rectangle, not a circle */
  extentAlong(nx: number, nz: number): number {
    return (this.length / 2) * Math.abs(this.forwardX * nx + this.forwardZ * nz) + (this.width / 2) * Math.abs(this.leftX * nx + this.leftZ * nz);
  }

  /** smoothed steering input −1..1: rate-limited so digital (touch/keyboard) steering is not twitchy */
  private steerIn = 0;
  private prevThrottle = 0;
  /** lift-off oversteer hint: seconds left of the loose rear after the throttle was dropped mid-corner */
  private liftT = 0;
  private handbrakeT = 0;

  /** lateral tyre force (N) for a slip angle and a grip budget: rises to the peak at ~8°, then holds */
  private static tyre(alpha: number, cap: number): number {
    return -cap * Math.sin(1.5 * Math.atan(12.5 * alpha));
  }

  step(inp: CarInput, dt: number, surf: Surface, canDrive: boolean): void {
    const m = this.mass;
    const v = Math.abs(this.vx);
    const throttle = canDrive ? inp.throttle : 0;
    const brake = canDrive ? inp.brake : 0;
    const handbrake = canDrive && !!inp.handbrake;
    const grip = surf.grip;
    const L = this.wheelbase;

    // --- steering rack: full travel in ~0.1 s, a touch slower to wind on at speed ---
    const target = Math.max(-1, Math.min(1, inp.steer));
    const returning = Math.abs(target) < Math.abs(this.steerIn) || Math.sign(target) !== Math.sign(this.steerIn);
    const rate = returning ? 14 : 10 / (1 + v / 100);
    this.steerIn += Math.max(-rate * dt, Math.min(rate * dt, target - this.steerIn));
    const lock = this.lockAt(v);
    let delta = this.steerIn * lock;
    // counter-steer assist: past the natural cornering slip the rack follows the slide a little, so a tail-out
    // moment is catchable on a keyboard too (the assist is weaker on the loose cars)
    const slide = Math.abs(this.beta) - 0.12;
    if (slide > 0 && !handbrake) delta += Math.sign(this.beta) * Math.min(lock * 0.7, slide * 0.55);
    delta = Math.max(-lock * 1.8, Math.min(lock * 1.8, delta));
    this.steerAngle = delta;

    // --- nitro ---
    const wantNitro = canDrive && inp.nitro && this.nitro > 0.5 && this.vx > 3;
    if (wantNitro) this.nitro = Math.max(0, this.nitro - 26 * dt);
    this.nitroActive = wantNitro && this.nitro > 0;

    // --- axle loads: static split, weight transfer from the last frame's acceleration, downforce ---
    const h = 0.52;
    const aero = this.downforce * v * v;
    const dFz = Math.max(-m * G * 0.35, Math.min(m * G * 0.35, (m * this.accel * h) / L));
    const fzF = Math.max(300, (m * G * this.b) / L - dFz + aero * 0.45);
    const fzR = Math.max(300, (m * G * this.a) / L + dFz + aero * 0.55);
    const hbT = handbrake ? (this.handbrakeT = 0.5) : (this.handbrakeT = Math.max(0, this.handbrakeT - dt));
    const capF = this.muF * grip * fzF;
    const capR = this.muR * grip * fzR * (1 - 0.55 * Math.min(1, hbT / 0.5));

    // --- longitudinal: engine on the rear axle, brakes split by bias ---
    const pEff = this.power * (this.nitroActive ? 1.55 * this.nitroMult : 1) * (this.shiftTimer > 0 ? 0.55 : 1);
    let fDrive = 0;
    if (throttle > 0 && !handbrake) {
      const raw = (throttle * pEff) / Math.max(6, Math.abs(this.vx));
      const tractionCap = capR;
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
    const sgnV = Math.sign(this.vx) || 1;
    const fBrakeTotal = reversing ? 0 : brake * grip * m * G * 1.15;
    const fBrakeF = fBrakeTotal * this.brakeBias;
    const fBrakeR = fBrakeTotal * (1 - this.brakeBias) + (handbrake ? m * G * 0.45 : 0);

    // --- slip angles and lateral forces (friction ellipse: longitudinal use eats cornering grip) ---
    const u = Math.max(2.5, Math.abs(this.vx));
    const dir = this.vx >= 0 ? 1 : -1;
    const alphaF = Math.atan2(this.vy + this.a * this.yawRate, u) - delta * dir;
    const alphaR = Math.atan2(this.vy - this.b * this.yawRate, u);
    const ellipse = (fx: number, cap: number) => Math.sqrt(Math.max(0.04, 1 - Math.pow(Math.min(1, Math.abs(fx) / Math.max(1, cap)), 2)));
    const kF = ellipse(fBrakeF, capF);
    const kR = ellipse(fDrive + fBrakeR, capR);
    // lift-off: dropping the throttle while turning hard lets the rear step out for a moment
    if (this.prevThrottle > 0.5 && throttle < 0.1 && Math.abs(this.steerIn) > 0.3 && v > 14 && !handbrake) this.liftT = 0.4;
    this.liftT = Math.max(0, this.liftT - dt);
    this.prevThrottle = throttle;
    const rearLift = this.liftT > 0 ? 1 - 0.18 * Math.min(1, this.liftT / 0.25) : 1;
    const fyF = CarPhysics.tyre(alphaF, capF * kF);
    const fyR = CarPhysics.tyre(alphaR, capR * kR * rearLift);

    // --- rigid-body equations in the car frame ---
    const fDrag = this.dragK * (1 - 0.42 * this.draft) * this.vx * Math.abs(this.vx) + 0.013 * m * G * sgnV * Math.min(1, v);
    const fSlope = -m * G * Math.sin(surf.slopeAlong);
    const fCoast = throttle < 0.05 && !reversing ? -0.05 * m * this.vx : 0;
    // the front tyre's force is turned by the steering angle: its drag component is the cost of understeer
    const fxSteer = -Math.abs(fyF * Math.sin(delta)) * sgnV;
    const ax = (fDrive - fBrakeF * sgnV - fBrakeR * sgnV - fDrag + fSlope + fCoast + fxSteer) / m + this.vy * this.yawRate;
    const ay = (fyF * Math.cos(delta) + fyR) / m - this.vx * this.yawRate;
    // a little yaw damping (tyre relaxation and the rest of the chassis) on top of the axle moments
    const mz = this.a * fyF * Math.cos(delta) - this.b * fyR - this.yawRate * this.izz * 0.35;
    this.accel = ax;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.yawRate += (mz / this.izz) * dt;

    // --- arcade forgiveness -------------------------------------------------------------------
    // keep pulling the yaw towards what the wheels ask for, so the car never spins on its own; the pull
    // fades out while the driver is deliberately sideways (handbrake or counter-steer held)
    const omegaKin = (this.vx * Math.tan(delta)) / L;
    // never ask for more yaw than the tyres can actually hold right now (otherwise the car keeps yawing while
    // the path cannot follow, and the slide grows on its own)
    const omegaCap = Math.min((this.latGrip(v) * grip) / Math.max(4, v), (Math.abs(fyF) + Math.abs(fyR)) / (m * Math.max(4, v)));
    const omegaRef = Math.max(-omegaCap, Math.min(omegaCap, omegaKin));
    const counter = Math.sign(this.steerIn) === Math.sign(this.beta) && Math.abs(this.steerIn) > 0.2 ? 1 : 0;
    const loose = Math.min(1, hbT / 0.5 + counter * 0.7);
    const kStab = this.stability * (1 - 0.5 * loose) * Math.min(1, v / 6);
    this.yawRate += (omegaRef - this.yawRate) * Math.min(1, dt * kStab);
    // below walking pace the car just follows its wheels
    const kin = Math.min(1, v / 3);
    this.yawRate = this.yawRate * kin + omegaKin * (1 - kin);
    this.vy *= kin + (1 - kin) * Math.max(0, 1 - dt * 12);
    // arcade grip assist: past the slip angle the car naturally carries, the tyres claw the slide back, unless
    // the driver is deliberately sideways (handbrake or counter-steer). Small angles are left alone — that is
    // the attitude the car takes in a corner
    this.beta = Math.atan2(this.vy, Math.max(2, Math.abs(this.vx)));
    const over = Math.abs(this.beta) - this.betaHold;
    if (over > 0 && v > 5) {
      const k = this.betaGrip * (1 - 0.8 * loose) * Math.min(1, over / 0.12);
      this.vy -= this.vy * Math.min(0.5, k * dt);
    }
    // cap the slide angle: drift, do not spin
    this.beta = Math.atan2(this.vy, Math.max(2, Math.abs(this.vx)));
    const bMax = this.betaMax * (handbrake || counter ? 1.25 : 1);
    if (Math.abs(this.beta) > bMax) {
      this.vy = Math.sign(this.vy) * Math.tan(bMax) * Math.max(2, Math.abs(this.vx));
      this.beta = Math.sign(this.beta) * bMax;
    }
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
    const peak = 0.14;
    this.drifting = Math.abs(this.beta) > 0.17 && sp > 8;
    this.slip = sp > 4 ? Math.min(1, Math.max(Math.abs(this.beta) / 0.45, Math.max(Math.abs(alphaF), Math.abs(alphaR)) / (peak * 2.2), this.wheelspin)) : 0;
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

    // body motion: squat, dive and roll (a real car rolls 1–2° per g; it used to lean like a scooter)
    const latAcc = this.vx * this.yawRate;
    const pitchT = Math.max(-0.035, Math.min(0.035, -ax * 0.003));
    const rollT = Math.max(-0.04, Math.min(0.04, -latAcc * 0.002));
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

