import * as THREE from 'three';
import { softSpriteTexture } from '../world/textures';

/**
 * Glow sprites on every car's headlights and tail lights (night tracks): the halos that make traffic
 * read at a distance, even on phones without a bloom pass. One Points draw call for the whole grid.
 */
export class CarGlows {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private tex: THREE.Texture;
  private tmp = new THREE.Vector3();

  constructor(cars: number) {
    this.pos = new Float32Array(cars * 4 * 3);
    this.col = new Float32Array(cars * 4 * 3);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    this.tex = softSpriteTexture(1, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex }, scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: /* glsl */ `
        uniform float scale;
        varying vec3 vCol;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float z = max(0.5, -mv.z);
          gl_PointSize = clamp(0.42 * scale / z, 1.5, 36.0);
          gl_Position = projectionMatrix * mv;
          vCol = color;
          vFade = smoothstep(6.0, 16.0, z) * (1.0 - smoothstep(220.0, 450.0, z));
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vCol;
        varying float vFade;
        void main() {
          float a = texture2D(map, gl_PointCoord).a;
          gl_FragColor = vec4(vCol * a * a * vFade, 1.0);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'car-glows';
  }

  /** i = car slot; brake raises the tail lights; lamps = centres from the baked masks when the model has them */
  set(i: number, root: THREE.Object3D, length: number, brake: boolean, lamps?: { head: THREE.Vector3[] | null; tail: THREE.Vector3[] | null }): void {
    const half = length / 2;
    const local: [number, number, number][] = [
      [0.62, 0.65, half - 0.3],
      [-0.62, 0.65, half - 0.3],
      [0.66, 0.8, -half + 0.12],
      [-0.66, 0.8, -half + 0.12],
    ];
    // sit the sprite just in front of the lens so the body does not hide it
    if (lamps?.head) for (let k = 0; k < 2; k++) local[k] = [lamps.head[k].x, lamps.head[k].y, lamps.head[k].z + 0.12];
    if (lamps?.tail) for (let k = 0; k < 2; k++) local[k + 2] = [lamps.tail[k].x, lamps.tail[k].y, lamps.tail[k].z - 0.12];
    for (let k = 0; k < 4; k++) {
      this.tmp.set(...local[k]).applyMatrix4(root.matrixWorld);
      const o = (i * 4 + k) * 3;
      this.pos[o] = this.tmp.x;
      this.pos[o + 1] = this.tmp.y;
      this.pos[o + 2] = this.tmp.z;
      if (k < 2) this.col.set([1.0, 0.92, 0.78], o);
      else this.col.set(brake ? [1.0, 0.12, 0.08] : [0.55, 0.05, 0.04], o);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
