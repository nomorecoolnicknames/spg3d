// STUB — replaced by the race engine (owner: core). Keep the constructor signature.
import * as THREE from 'three';
import type { SceneController, Viewport } from '../Viewport';
import type { RaceParams, SceneCallbacks } from '../types';

export class RaceScene implements SceneController {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  constructor(public params: RaceParams, public cb: SceneCallbacks) {}
  start(): void {}
  update(): void {}
  render(vp: Viewport): void { vp.renderer.render(this.scene, this.camera); }
  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose(): void {}
  setCameraMode(_m: number): void {}
  setPaused(_p: boolean): void {}
  respawn(): void {}
}
