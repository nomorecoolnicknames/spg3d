import type { CarInput } from '../types';
import type { CarPhysics } from '../vehicle/CarPhysics';
import type { TrackData } from '../world/TrackData';

export interface AIOther {
  progress: number;
  lat: number;
  speed: number;
  isPlayer: boolean;
}

export interface AIContext {
  /** progress (samples) of this car */
  progress: number;
  /** lateral offset of this car (m, left positive) */
  lat: number;
  /** every car in the race (including this one, skipped via selfIndex) — reused between steps */
  others: readonly AIOther[];
  selfIndex: number;
  /** player progress, for rubber banding (undefined for the player's own autopilot) */
  playerProgress?: number;
  /** race started and this car may drive */
  canDrive: boolean;
}

/**
 * Pure-pursuit steering along the precomputed racing line + curvature speed profile,
 * simple avoidance and mild rubber banding. Uses the same CarPhysics as the player.
 */
export class RacerAI {
  private avoid = 0;
  private avoidT = 0;
  private stuckT = 0;
  private reverseT = 0;
  private nitroT = 0;
  private steerS = 0;
  private wobblePhase = Math.random() * 100;
  private throttleS = 0;
  /** lateral offset of a car right in front (for backing out of a lock-up) */
  private nose = 0;
  private stuckTries = 0;
  /** set when backing out failed repeatedly: the race puts the car back on the line */
  wantsRespawn = false;

  constructor(
    private track: TrackData,
    /** 0.85..1.1 — speed target scale */
    public skill: number,
    /** 0.85..1.15 — difficulty from the race setup */
    public difficulty: number,
    /** 0..1 how aggressively it uses nitro / overtakes */
    public aggression = 0.6,
  ) {}

  drive(car: CarPhysics, ctx: AIContext, dt: number): CarInput {
    const t = this.track;
    const n = t.count;
    const v = Math.max(0, car.vx);
    const idx = ((Math.floor(ctx.progress) % n) + n) % n;

    // --- avoidance: look for a car ahead within 14 m in roughly the same lane ---
    this.avoidT -= dt;
    let blockedSlow = false;
    for (let oi = 0; oi < ctx.others.length; oi++) {
      if (oi === ctx.selfIndex) continue;
      const o = ctx.others[oi];
      let ahead = o.progress - ctx.progress;
      if (ahead > n / 2) ahead -= n;
      if (ahead < -n / 2) ahead += n;
      const aheadM = ahead * t.spacing;
      if (aheadM > 0.5 && aheadM < 14 + v * 0.25) {
        const dLat = o.lat - ctx.lat;
        if (Math.abs(dLat) < 2.8) {
          if (this.avoidT <= 0) {
            // pass on the side with more room
            const room = t.halfW - 1.4;
            const side = dLat >= 0 ? -1 : 1; // other car is on our left → pass on the right
            this.avoid = Math.max(-room, Math.min(room, o.lat + side * 4.0));
            this.avoidT = 1.6;
          }
          if (o.speed < v - 2 && aheadM < 7) blockedSlow = true;
          if (aheadM < 4 && Math.abs(dLat) < 1.6) this.nose = o.lat - ctx.lat;
        }
      }
    }

    // --- target point on the racing line ---
    const look = Math.max(7, Math.min(42, 6 + v * 0.42));
    const lookIdx = (idx + Math.round(look / t.spacing)) % n;
    const s = t.samples[lookIdx];
    const wobble = Math.sin(this.wobblePhase + ctx.progress * 0.02) * 0.6;
    const lineOff = this.avoidT > 0 ? this.avoid : s.lineOffset + wobble;
    const tx = s.pos.x + s.left.x * lineOff - car.x;
    const tz = s.pos.z + s.left.z * lineOff - car.z;
    const desired = Math.atan2(tx, tz);
    let diff = desired - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // pure pursuit: curvature needed → steering angle → normalized input
    const dist = Math.hypot(tx, tz);
    const kappa = (2 * Math.sin(diff)) / Math.max(3, dist);
    const delta = Math.atan(kappa * car.wheelbase);
    let steer = delta / car.maxSteer(v);
    const wrongWay = Math.abs(diff) > 1.3;
    // slide control: catch the slide with the wheels (counter-steer is the same sign as the body slip angle),
    // ease off the pursuit term. The steering input is relative to maxSteer, so β is converted into it.
    const sliding = car.drifting || Math.abs(car.beta) > 0.12;
    const lockNow = Math.max(0.05, car.maxSteer(v));
    if (sliding && !wrongWay) steer = steer * 0.4 + (car.beta / lockNow) * 0.55 - car.yawRate * 0.22;
    if (wrongWay) steer = Math.sign(diff);
    // wall repulsion near the edges
    const edge = Math.abs(ctx.lat) - (t.halfW - 3.2);
    if (edge > 0 && !wrongWay) steer -= Math.sign(ctx.lat) * edge * 0.45;
    steer = Math.max(-1, Math.min(1, steer));
    this.steerS += (steer - this.steerS) * Math.min(1, dt * 14);

    // --- target speed: min of the profile over the braking horizon ---
    // the line speeds in TrackData are for a reference grip: each car scales them by what its chassis can hold
    // half the grip advantage of the car, so the AI keeps a margin on the loose ones
    const scale = this.skill * this.difficulty * (0.5 + 0.5 * car.corneringScale);
    let target = Infinity;
    const horizon = Math.round((8 + v * 0.55) / t.spacing);
    for (let k = 0; k <= horizon; k += 2) {
      const sp = t.samples[(idx + k) % n].lineSpeed * scale;
      if (sp < target) target = sp;
    }
    // rubber band vs the player
    if (ctx.playerProgress !== undefined) {
      let gap = (ctx.playerProgress - ctx.progress) * t.spacing;
      if (gap > (n * t.spacing) / 2) gap -= n * t.spacing;
      if (gap < -(n * t.spacing) / 2) gap += n * t.spacing;
      const band = Math.max(-0.08, Math.min(0.08, gap / 600));
      target *= 1 + band;
    }
    if (blockedSlow) target = Math.min(target, v - 1.5);
    if (Math.abs(diff) > 0.9) target *= 0.6;
    if (wrongWay) target = 6; // turn around slowly
    // sliding: back off, the more sideways the car is the more
    if (sliding) target = Math.min(target, v - 2 - 12 * Math.max(0, Math.abs(car.beta) - 0.12));

    let throttle = 0, brake = 0;
    if (v < target - 0.5) throttle = Math.min(1, (target - v) / 3 + 0.35);
    else if (v > target + 0.6) brake = Math.min(1, (v - target) / 4 + 0.2);
    if (sliding) brake = Math.min(brake, 0.35);
    // traction control: ease off as the tires saturate
    throttle *= 1 - 0.55 * car.slip;
    this.throttleS += (throttle - this.throttleS) * Math.min(1, dt * 10);

    // --- nitro on straights ---
    this.nitroT -= dt;
    let nitro = false;
    const straight = Math.abs(t.samples[lookIdx].curv) < 0.004 && Math.abs(diff) < 0.06;
    if (this.nitroT <= 0 && straight && car.nitro > 25 && v < target * 0.92 && Math.random() < dt * 0.35 * this.aggression) this.nitroT = 1.3 + Math.random();
    if (this.nitroT > 0 && straight) nitro = true;

    // --- stuck handling ---
    if (ctx.canDrive && v < 1.5 && this.reverseT <= 0) this.stuckT += dt;
    else if (v > 3) this.stuckT = 0;
    if (this.stuckT > 1.4) {
      this.reverseT = 1.0;
      this.stuckT = 0;
      // wedged against a car or a barrier for the third time: ask the race to set it back on the line
      if (++this.stuckTries >= 2) {
        this.wantsRespawn = true;
        this.stuckTries = 0;
      }
    }
    if (v > 8) this.stuckTries = 0;
    if (this.reverseT > 0) {
      // back out and turn the wheel away from whatever is in the way, then pull round it
      this.reverseT -= dt;
      const away = this.nose !== 0 ? -Math.sign(this.nose) : -Math.sign(this.steerS || 1);
      return { steer: away * 0.8, throttle: 0, brake: 1, handbrake: false, nitro: false };
    }

    return { steer: this.steerS, throttle: ctx.canDrive ? this.throttleS : 0, brake: ctx.canDrive ? brake : 0, handbrake: false, nitro };
  }
}
