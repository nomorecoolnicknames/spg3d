// STUB — replaced by the showcase (owner: core).
import * as THREE from 'three';
import type { SceneController, Viewport } from '../Viewport';

export class ShowcaseScene implements SceneController {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  start(): void {}
  update(): void {}
  render(vp: Viewport): void { vp.renderer.render(this.scene, this.camera); }
  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose(): void {}
  /** which car to show and how (menu = far/cinematic, garage = close/turntable) */
  show(_carId: string, _color: string, _mode: 'menu' | 'garage'): void {}
}
