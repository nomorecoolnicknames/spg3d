import * as THREE from 'three';
import type { CarPhysics } from '../vehicle/CarPhysics';

/**
 * Chase / hood / TV / heli cameras with spring lag, speed FOV kick and impact shake.
 */
export class RaceCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode = 0;
  shake = 0;
  fovKick = true;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov = 60;
  private tmpF = new THREE.Vector3();
  private tmpT = new THREE.Vector3();
  private tmpL = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.2, 4000);
  }

  snapTo(car: CarPhysics): void {
    this.initialized = false;
    this.update(car, 0.1, 0);
  }

  update(car: CarPhysics, dt: number, t: number): void {
    const f = this.tmpF.set(car.forwardX, 0, car.forwardZ);
    const speed = Math.max(0, car.vx);
    const ratio = Math.min(1, speed / Math.max(30, car.topSpeed));
    const base = new THREE.Vector3(car.x, car.y, car.z);
    let target: THREE.Vector3, look: THREE.Vector3, fovT: number, k: number, kl: number;
    switch (this.mode) {
      case 1: {
        // hood
        target = base.clone().addScaledVector(f, 0.9).add(new THREE.Vector3(0, 1.05, 0));
        look = base.clone().addScaledVector(f, 30).add(new THREE.Vector3(0, 0.9, 0));
        fovT = 68 + (this.fovKick ? ratio * 14 + (car.nitroActive ? 7 : 0) : 0);
        k = 30;
        kl = 30;
        break;
      }
      case 2: {
        // TV: high, far behind, wide
        target = base.clone().addScaledVector(f, -18).add(new THREE.Vector3(0, 9.5, 0));
        look = base.clone().addScaledVector(f, 20).add(new THREE.Vector3(0, 0.8, 0));
        fovT = 48;
        k = 3.2;
        kl = 5;
        break;
      }
      case 3: {
        // heli
        target = base.clone().add(new THREE.Vector3(0, 30 + speed * 0.15, 0)).addScaledVector(f, -6);
        look = base.clone().addScaledVector(f, 8).add(new THREE.Vector3(0, 0.5, 0));
        fovT = 46;
        k = 2.4;
        kl = 6;
        break;
      }
      default: {
        // chase: pull back with speed, lag on lateral velocity
        const dist = 6.8 + speed * 0.06 + (car.nitroActive ? 0.8 : 0);
        const height = 2.4 + speed * 0.012;
        // slide the camera to the outside of a drift
        const lateral = this.tmpL.set(car.leftX, 0, car.leftZ).multiplyScalar(-car.vy * 0.06);
        target = base.clone().addScaledVector(f, -dist).add(new THREE.Vector3(0, height, 0)).add(lateral);
        look = base.clone().addScaledVector(f, 6).add(new THREE.Vector3(0, 1.1, 0));
        fovT = 58 + (this.fovKick ? ratio * 16 + (car.nitroActive ? 9 : 0) : 0);
        k = 6.5;
        kl = 10;
      }
    }
    if (!this.initialized) {
      this.pos.copy(target);
      this.look.copy(look);
      this.fov = fovT;
      this.initialized = true;
    } else {
      this.pos.lerp(target, 1 - Math.exp(-dt * k));
      this.look.lerp(look, 1 - Math.exp(-dt * kl));
      this.fov += (fovT - this.fov) * (1 - Math.exp(-dt * 4));
    }
    // keep the chase camera above the ground line of the car
    if (this.mode === 0 && this.pos.y < car.y + 1.0) this.pos.y = car.y + 1.0;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * 0.25;
    this.camera.position.copy(this.pos).add(this.tmpT.set(Math.sin(t * 61) * sh, Math.sin(t * 47) * sh * 0.6, Math.cos(t * 53) * sh));
    this.camera.lookAt(this.look);
    if (this.mode === 0) this.camera.rotateZ(-car.vy * 0.004 + car.roll * 0.3);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
