import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export const wetStreetUniforms = {
  streetReflection: { value: null as THREE.Texture | null },
  streetReflectionMatrix: { value: new THREE.Matrix4() },
  streetReflectionTexel: { value: new THREE.Vector2(1 / 512, 1 / 288) },
  streetReflectionGain: { value: 0 },
};

/** One half-resolution reflected scene on the high tier. The ordinary road material masks it to puddles. */
export class WetStreetReflection {
  private mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 512, textureHeight: 288, multisample: 0, clipBias: 0.002 });
  private inverse = new THREE.Matrix4();
  enabled = true;

  constructor() {
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.position.y = -0.015;
    this.mirror.updateMatrixWorld(true);
    this.inverse.copy(this.mirror.matrixWorld).invert();
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, road: THREE.Mesh): void {
    const uniforms = wetStreetUniforms;
    uniforms.streetReflectionGain.value = 0;
    if (!this.enabled) return;
    const size = renderer.getSize(new THREE.Vector2());
    const width = Math.min(768, Math.max(256, Math.round(size.x / 2)));
    const height = Math.max(128, Math.round(width * size.y / Math.max(size.x, 1)));
    const target = this.mirror.getRenderTarget();
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    uniforms.streetReflectionTexel.value.set(1 / width, 1 / height);
    // Even a disabled shader branch may bind its sampler. Unbind the target to avoid a framebuffer feedback loop.
    uniforms.streetReflection.value = null;
    const visible = road.visible;
    road.visible = false;
    camera.updateMatrixWorld(true);
    try {
      this.mirror.onBeforeRender(renderer, scene, camera, this.mirror.geometry, this.mirror.material as THREE.Material, null!);
    } finally {
      road.visible = visible;
    }
    uniforms.streetReflectionMatrix.value.copy((this.mirror.material as THREE.ShaderMaterial).uniforms.textureMatrix.value).multiply(this.inverse);
    uniforms.streetReflection.value = target.texture;
    uniforms.streetReflectionGain.value = 1;
  }

  dispose(): void {
    wetStreetUniforms.streetReflectionGain.value = 0;
    wetStreetUniforms.streetReflection.value = null;
    this.mirror.geometry.dispose();
    this.mirror.dispose();
  }
}
