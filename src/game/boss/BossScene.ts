// STUB — replaced by the boss module (owner: boss fork). Keep the constructor signature.
import * as THREE from 'three';
import type { SceneController, Viewport } from '../Viewport';
import type { BossParams, SceneCallbacks } from '../types';

export class BossScene implements SceneController {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  constructor(public params: BossParams, public cb: SceneCallbacks) {}
  start(): void {}
  update(): void {}
  render(vp: Viewport): void { vp.renderer.render(this.scene, this.camera); }
  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose(): void {}
  setPaused(_p: boolean): void {}
  retry(): void {}
}
