import type { CarInput, FootInput } from '../types';

/**
 * Unified input: keyboard, gamepad, and touch (the React HUD feeds touch via setTouch).
 * Steering/throttle are smoothed for keyboard so the car doesn't snap.
 */
export interface TouchState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
  handbrake: boolean;
  nitro: boolean;
  /** analog stick from the virtual joystick, -1..1 */
  stickX: number;
  stickY: number;
  fire: boolean;
  sprint: boolean;
  /** look delta accumulated by the touch look-pad (radians) */
  lookX: number;
  lookY: number;
}

export type InputAction = 'camera' | 'pause' | 'respawn';

export class Input {
  private keys = new Set<string>();
  private steerS = 0;
  private throttleS = 0;
  private brakeS = 0;
  private lookDX = 0;
  private lookDY = 0;
  private actions: ((a: InputAction) => void)[] = [];
  private mouseDown = false;
  private target: HTMLElement | null = null;
  touch: TouchState = { left: false, right: false, throttle: false, brake: false, handbrake: false, nitro: false, stickX: 0, stickY: 0, fire: false, sprint: false, lookX: 0, lookY: 0 };
  enabled = true;
  pointerLockWanted = false;
  invertY = false;
  sensitivity = 0.0022;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.repeat) {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    switch (e.code) {
      case 'KeyC':
        this.fire('camera');
        break;
      case 'Escape':
        this.fire('pause');
        break;
      case 'KeyR':
        this.fire('respawn');
        break;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onBlur = (): void => {
    this.keys.clear();
    this.mouseDown = false;
  };
  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (document.pointerLockElement === this.target || this.mouseDown) {
      this.lookDX -= e.movementX * this.sensitivity;
      this.lookDY += (this.invertY ? 1 : -1) * e.movementY * this.sensitivity;
    }
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (e.button === 0) {
      this.mouseDown = true;
      if (this.pointerLockWanted && this.target && document.pointerLockElement !== this.target) {
        this.target.requestPointerLock?.();
      }
    }
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };

  attach(target: HTMLElement): void {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.target?.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    if (document.pointerLockElement === this.target) document.exitPointerLock?.();
    this.target = null;
    this.keys.clear();
  }

  onAction(cb: (a: InputAction) => void): () => void {
    this.actions.push(cb);
    return () => {
      this.actions = this.actions.filter((x) => x !== cb);
    };
  }

  private fire(a: InputAction): void {
    for (const cb of this.actions) cb(a);
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Call once per physics step. */
  car(dt: number): CarInput {
    const k = this.keys;
    const t = this.touch;
    const pad = this.pad();
    let steerTarget = (k.has('KeyA') || k.has('ArrowLeft') || t.left ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') || t.right ? 1 : 0);
    let throttleT = k.has('KeyW') || k.has('ArrowUp') || t.throttle ? 1 : 0;
    let brakeT = k.has('KeyS') || k.has('ArrowDown') || t.brake ? 1 : 0;
    let handbrake = k.has('Space') || t.handbrake;
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight') || t.nitro;
    if (Math.abs(t.stickX) > 0.08) steerTarget = -t.stickX;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.1) steerTarget = -ax;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttleT = rt;
      if (lt > 0.05) brakeT = lt;
      if (pad.buttons[0]?.pressed) handbrake = true;
      if (pad.buttons[2]?.pressed || pad.buttons[5]?.pressed) nitro = true;
      if (pad.buttons[3]?.pressed && !this.padPrev.cam) this.fire('camera');
      this.padPrev.cam = !!pad.buttons[3]?.pressed;
      if (pad.buttons[9]?.pressed && !this.padPrev.pause) this.fire('pause');
      this.padPrev.pause = !!pad.buttons[9]?.pressed;
    }
    // smooth keyboard steering: fast return to center, slower ramp to full lock
    const analog = Math.abs(t.stickX) > 0.08 || (pad && Math.abs(pad.axes[0] ?? 0) > 0.1);
    if (analog) this.steerS = steerTarget;
    else {
      const rate = steerTarget === 0 ? 9 : 5.5;
      this.steerS += (steerTarget - this.steerS) * Math.min(1, rate * dt);
    }
    this.throttleS += (throttleT - this.throttleS) * Math.min(1, 12 * dt);
    this.brakeS += (brakeT - this.brakeS) * Math.min(1, 14 * dt);
    return { steer: this.steerS, throttle: this.throttleS, brake: this.brakeS, handbrake, nitro };
  }
  private padPrev = { cam: false, pause: false, fire: false };

  /** Call once per frame (look deltas are consumed). */
  foot(): FootInput {
    const k = this.keys;
    const t = this.touch;
    const pad = this.pad();
    let forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    let fire = k.has('Space') || this.mouseDown || t.fire;
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight') || t.sprint;
    if (Math.abs(t.stickY) > 0.1 || Math.abs(t.stickX) > 0.1) {
      forward = -t.stickY;
      strafe = -t.stickX;
    }
    let lookX = this.lookDX + t.lookX;
    let lookY = this.lookDY + t.lookY;
    if (pad) {
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0, rx = pad.axes[2] ?? 0, ry = pad.axes[3] ?? 0;
      if (Math.abs(ay) > 0.12) forward = -ay;
      if (Math.abs(ax) > 0.12) strafe = -ax;
      if (Math.abs(rx) > 0.12) lookX -= rx * 0.04;
      if (Math.abs(ry) > 0.12) lookY -= ry * 0.03 * (this.invertY ? -1 : 1);
      if ((pad.buttons[7]?.value ?? 0) > 0.3 || pad.buttons[0]?.pressed) fire = true;
      if (pad.buttons[10]?.pressed) sprint = true;
    }
    this.lookDX = 0;
    this.lookDY = 0;
    t.lookX = 0;
    t.lookY = 0;
    return { forward, strafe, lookX, lookY, fire, sprint };
  }

  setTouch<K extends keyof TouchState>(k: K, v: TouchState[K]): void {
    this.touch[k] = v;
  }

  addLook(dx: number, dy: number): void {
    this.touch.lookX += dx;
    this.touch.lookY += dy;
  }

  reset(): void {
    this.keys.clear();
    this.steerS = 0;
    this.throttleS = 0;
    this.brakeS = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    const t = this.touch;
    t.left = t.right = t.throttle = t.brake = t.handbrake = t.nitro = t.fire = t.sprint = false;
    t.stickX = t.stickY = t.lookX = t.lookY = 0;
  }
}

export const input = new Input();
